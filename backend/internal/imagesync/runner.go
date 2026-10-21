package imagesync

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/dockedapp/backend/graph/model"
	"github.com/dockedapp/backend/internal/db"
	"github.com/dockedapp/backend/internal/events"
	"github.com/dockedapp/backend/internal/registry"
	"github.com/dockedapp/backend/internal/runner"
)

// Service ports the runner half of the docker-hub-pull batch job:
// scan runner containers, check registry updates, persist, notify.
type Service struct {
	DB       *sql.DB
	Registry *registry.Manager
	Hub      *events.Hub
	notifier *notifier

	// OnScanComplete mirrors Node's BatchManager post-scan hook: after a
	// batch job completes and found updates, evaluate immediate intents.
	// Wired by main.go to the intents evaluator.
	OnScanComplete func(ctx context.Context, userID int64, itemsUpdated int)

	mu                sync.Mutex
	running           map[int64]bool // userID -> in-process docker-hub-pull run flag
	runningTracked    map[int64]bool // userID -> in-process tracked-apps-check run flag
	runningAppVersion map[int64]bool // userID -> in-process app-version-scan run flag
}

// JobType is the batch job this service executes.
const JobType = "docker-hub-pull"

// staleRunThreshold matches Node's STALE_JOB_THRESHOLD (5 minutes): a
// 'running' batch_run older than this is assumed dead and marked failed.
const staleRunThreshold = 5 * time.Minute

func NewService(database *sql.DB, hub *events.Hub) *Service {
	return &Service{
		DB:                database,
		Registry:          registry.NewManager(database),
		Hub:               hub,
		notifier:          newNotifier(database),
		running:           make(map[int64]bool),
		runningTracked:    make(map[int64]bool),
		runningAppVersion: make(map[int64]bool),
	}
}

// Acquire takes the run guard and creates the 'running' batch_run row,
// returning its id. Splitting this from the scan lets HTTP resolvers
// register the run synchronously (so clients polling batchRuns immediately
// see the new row) and then execute it in the background.
func (s *Service) Acquire(ctx context.Context, userID int64, isManual bool) (int64, error) {
	return s.acquireRun(ctx, s.running, userID, isManual, JobType)
}

// acquireRun implements the shared guard stack for every batch job type:
// an in-process fast path, stale-run reaping, and finally an atomic DB
// claim (CreateBatchRunIfNoneRunning) so the scheduler process and the
// GraphQL process can never both create a 'running' row for the same
// user+job — the old check-then-insert pair raced across processes.
func (s *Service) acquireRun(ctx context.Context, running map[int64]bool, userID int64, isManual bool, jobType string) (int64, error) {
	s.mu.Lock()
	if running[userID] {
		s.mu.Unlock()
		return 0, fmt.Errorf("job %s is already running for user %d", jobType, userID)
	}
	running[userID] = true
	s.mu.Unlock()

	release := func() {
		s.mu.Lock()
		delete(running, userID)
		s.mu.Unlock()
	}

	// Reap stale runs: a crashed process can leave a 'running' row behind.
	if existing, err := db.GetRunningBatchRun(ctx, s.DB, userID, jobType); err != nil {
		release()
		return 0, err
	} else if existing != nil {
		if startedAt, perr := parseSQLiteTime(existing.StartedAt); perr == nil && time.Since(startedAt) > staleRunThreshold {
			msg := "Job marked as failed: stale running job detected"
			_ = db.CompleteBatchRun(ctx, s.DB, existing.ID, "failed", 0, 0, &msg)
		}
	}

	runID, err := db.CreateBatchRunIfNoneRunning(ctx, s.DB, userID, jobType, isManual)
	if err != nil {
		release()
		if errors.Is(err, db.ErrBatchRunActive) {
			if existing, _ := db.GetRunningBatchRun(ctx, s.DB, userID, jobType); existing != nil {
				return 0, fmt.Errorf("job %s is already running for user %d (run ID: %d)", jobType, userID, existing.ID)
			}
			return 0, fmt.Errorf("job %s is already running for user %d", jobType, userID)
		}
		return 0, err
	}
	return runID, nil
}

// ExecuteAndComplete performs the scan and finalizes the batch_run row
// created by Acquire. It always releases the in-process flag.
func (s *Service) ExecuteAndComplete(ctx context.Context, userID, runID int64) error {
	defer func() {
		s.mu.Lock()
		delete(s.running, userID)
		s.mu.Unlock()
	}()

	checked, updated, runErr := s.RunDockerHubPull(ctx, userID)

	doneCtx := context.WithoutCancel(ctx)
	if runErr != nil {
		msg := runErr.Error()
		if cerr := db.CompleteBatchRun(doneCtx, s.DB, runID, "failed", checked, updated, &msg); cerr != nil {
			slog.Error("failed to mark batch run failed", "runId", runID, "error", cerr)
		}
		return runErr
	}
	if cerr := db.CompleteBatchRun(doneCtx, s.DB, runID, "completed", checked, updated, nil); cerr != nil {
		slog.Error("failed to mark batch run completed", "runId", runID, "error", cerr)
	}
	s.fireScanComplete(ctx, userID, updated)
	return nil
}

// fireScanComplete dispatches the post-scan immediate-intents hook
// fire-and-forget (Node's BatchManager does the same after updateBatchRun).
func (s *Service) fireScanComplete(ctx context.Context, userID int64, itemsUpdated int) {
	if s.OnScanComplete == nil || itemsUpdated <= 0 {
		return
	}
	go func() {
		defer func() {
			if rec := recover(); rec != nil {
				slog.Error("panic in scan-complete hook", "recover", rec)
			}
		}()
		s.OnScanComplete(context.WithoutCancel(ctx), userID, itemsUpdated)
	}()
}

// RunWithLock performs a docker-hub-pull run with the same guard stack as
// Node's BatchManager.executeJob: in-process flag, DB 'running' row check
// (with stale-run recovery), batch_runs bookkeeping around the scan.
func (s *Service) RunWithLock(ctx context.Context, userID int64, isManual bool) (int64, error) {
	runID, err := s.Acquire(ctx, userID, isManual)
	if err != nil {
		return 0, err
	}
	return runID, s.ExecuteAndComplete(ctx, userID, runID)
}

// parseSQLiteTime parses timestamp strings from SQLite (see db.ParseSQLiteTime).
func parseSQLiteTime(s string) (time.Time, error) {
	return db.ParseSQLiteTime(s)
}

// ScanRunnerContainers ports DockerHubPullHandler.scanRunnerContainers.
// Unreachable runners are skipped; per-container failures are logged and
// skipped (including rate-limit errors, matching Node's per-container catch).
func (s *Service) ScanRunnerContainers(ctx context.Context, rr db.RunnerRow, userID int64) (int, int) {
	checked, updated := 0, 0

	containers, err := runner.FetchContainers(ctx, rr)
	if err != nil {
		slog.Warn("runner unreachable during image scan, skipping",
			"runnerId", rr.ID, "runnerName", rr.Name, "error", err)
		return 0, 0
	}

	for _, ctr := range containers {
		details, derr := runner.InspectContainer(ctx, rr, ctr.ID)
		imageName := ""
		if derr == nil {
			imageName = configImage(details)
		}
		if imageName == "" {
			imageName = ctr.Image
		}
		if imageName == "" {
			continue
		}

		info, err := CheckImageUpdates(ctx, s.Registry, s.DB, imageName, details, userID)
		if err != nil {
			slog.Debug("failed to scan runner container",
				"runnerId", rr.ID, "containerId", ctr.ID, "error", err)
			continue
		}

		parsed, err := registry.ParseImageName(imageName)
		if err != nil {
			slog.Debug("unparseable image name, skipping", "containerId", ctr.ID, "image", imageName, "error", err)
			continue
		}

		containerName := strings.TrimPrefix(ctr.Name, "/")
		if containerName == "" {
			containerName = ctr.ID
			if len(containerName) > 12 {
				containerName = containerName[:12]
			}
		}

		stackName := configLabel(details, "com.docker.compose.project")
		var stackPtr *string
		if stackName != "" {
			stackPtr = &stackName
		}

		// Recalculate hasUpdate using repoDigests when available, to avoid
		// false positives on multi-arch images (same as Node).
		hasUpdate := info.HasUpdate
		cleanRepoDigests := ctr.RepoDigests
		if len(cleanRepoDigests) > 0 && info.LatestDigestFull != nil {
			latestHash := strings.TrimPrefix(*info.LatestDigestFull, "sha256:")
			hasUpdate = true
			for _, rd := range cleanRepoDigests {
				if strings.TrimPrefix(rd, "sha256:") == latestHash {
					hasUpdate = false
					break
				}
			}
		}

		data := &db.ContainerVersionUpsert{
			ContainerID:   ctr.ID,
			ContainerName: containerName,
			ImageName:     imageName,
			ImageRepo:     parsed.ImageRepo,
			ImageTag:      parsed.Tag,
			Status:        nullIfEmpty(ctr.Status),
			State:         nullIfEmpty(ctr.State),
			StackName:     stackPtr,
			CurrentDigest: info.CurrentDigestFull,
			Registry:      parsed.Registry,
			Namespace:     parsed.Namespace,
			Repository:    parsed.Repository,
			RepoDigests:   cleanRepoDigests,
		}

		var version *db.VersionData
		if hasUpdate {
			latestTag := info.LatestTag
			if latestTag == "" {
				latestTag = parsed.Tag
			}
			version = &db.VersionData{
				CurrentTag: info.CurrentTag,
				LatestTag:  latestTag,
				// Node passes latestVersion: null and latestDigest from the check.
				LatestDigest: info.LatestDigestFull,
			}
		}

		if _, err := db.UpsertContainerWithVersion(ctx, s.DB, userID, data, version, rr.ID); err != nil {
			slog.Debug("failed to upsert runner container",
				"runnerId", rr.ID, "containerId", ctr.ID, "error", err)
			continue
		}

		checked++
		if hasUpdate {
			updated++
		}
	}

	slog.Info("runner image scan complete", "runnerId", rr.ID, "runnerName", rr.Name,
		"checked", checked, "updated", updated)
	return checked, updated
}

// RunDockerHubPull ports DockerHubPullHandler.execute for the runner-only
// world: snapshot containers, scan every docker-enabled runner, re-read,
// send Discord notifications, and fan out a ContainersUpdated event.
func (s *Service) RunDockerHubPull(ctx context.Context, userID int64) (int, int, error) {
	previous, err := db.GetContainers(ctx, s.DB, userID)
	if err != nil {
		return 0, 0, err
	}

	runners, err := db.GetEnabledRunners(ctx, s.DB, userID)
	if err != nil {
		return 0, 0, err
	}

	checked, updated := 0, 0
	for _, rr := range runners {
		if rr.DockerEnabled.Int64 != 1 {
			continue
		}
		c, u := s.ScanRunnerContainers(ctx, rr, userID)
		checked += c
		updated += u
	}

	current, err := db.GetContainers(ctx, s.DB, userID)
	if err != nil {
		return checked, updated, err
	}

	s.notifier.SendContainerUpdateNotifications(ctx, current, previous, userID)

	if s.Hub != nil {
		s.Hub.PublishContainersUpdated(events.BroadcastUserID, model.ContainersUpdatedEvent{
			ContainerCount: len(current),
		})
	}

	slog.Info("docker hub pull completed", "userId", userID,
		"containersChecked", checked, "containersUpdated", updated)
	return checked, updated, nil
}

func nullIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
