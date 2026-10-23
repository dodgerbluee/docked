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
	"github.com/dockedapp/backend/internal/domain"
	"github.com/dockedapp/backend/internal/events"
	"github.com/dockedapp/backend/internal/registry"
	"github.com/dockedapp/backend/internal/runner"
)

// pickCurrentDigest resolves the digest to persist for a scanned container,
// freshest signal first:
//  1. the inspect document's own repo digest - what is actually running now;
//  2. the runner list payload's digest for this container;
//  3. the stored baseline (info.CurrentDigestFull), which comes from an
//     earlier scan and goes stale the moment the container is recreated on a
//     newer image, so it is only a last resort.
//
// Persisting nil would blank the stored digest and containerHasUpdate then
// rejects the row (CurrentDigest NULL), suppressing the update notification
// forever - hence the fallbacks.
func pickCurrentDigest(info *UpdateInfo, ctr domain.Container) *string {
	if info.InspectDigest != nil && *info.InspectDigest != "" {
		return info.InspectDigest
	}
	if ctr.CurrentDigest != nil && *ctr.CurrentDigest != "" {
		return ctr.CurrentDigest
	}
	if info.CurrentDigestFull != nil && *info.CurrentDigestFull != "" {
		return info.CurrentDigestFull
	}
	return nil
}

// cleanDigests converts raw repository digest references ("repo@sha256:x") to
// the bare "sha256:x" form the deployed_images columns store. Bare entries pass
// through unchanged.
func cleanDigests(raw []string) []string {
	if len(raw) == 0 {
		return nil
	}
	out := make([]string, 0, len(raw))
	for _, rd := range raw {
		if digest := digestFromReference(rd); digest != "" {
			out = append(out, digest)
			continue
		}
		if strings.HasPrefix(rd, "sha256:") && len(rd) > len("sha256:") {
			out = append(out, strings.TrimSpace(rd))
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// buildVersionData decides what registry observation to persist alongside a
// container. Every CONFIRMED observation is stored, not just "update
// available" ones: keeping a stale latest_digest after an up-to-date scan lets
// a later comparison re-flag a phantom update. A failed lookup deliberately
// does NOT overwrite stored data - provider failures surface as non-nil,
// digest-less placeholders (processProviderResult/ensureProvider) and writing
// those would NULL out a previously known latest digest. A version-only
// success (GitHub releases report a version, no digest) is still a confirmed
// observation and must be stored.
func buildVersionData(info *UpdateInfo, fallbackTag string) *db.VersionData {
	if !info.ExistsInRegistry || (info.LatestDigestFull == nil && info.LatestVersion == nil) {
		return nil
	}
	latestTag := info.LatestTag
	if latestTag == "" {
		latestTag = fallbackTag
	}
	return &db.VersionData{
		CurrentTag:        info.CurrentTag,
		LatestTag:         latestTag,
		LatestDigest:      info.LatestDigestFull,
		LatestVersion:     info.LatestVersion,
		LatestPublishDate: info.LatestPublishDate,
		Provider:          info.Provider,
	}
}

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

	// OnBatchRun reports every batch run this service finalizes so the GraphQL
	// layer can fan it out to the batchJobProgress / operationProgress
	// subscribers. These jobs are started here and by the cron scheduler, not
	// by a mutation, so nothing else publishes them - and the client's
	// batchJobProgress handler is written for exactly these job types.
	OnBatchRun func(ctx context.Context, userID, runID int64)

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
	// The reap is a single conditional UPDATE that re-checks lease staleness
	// atomically, so a heartbeat landing at the last moment still protects
	// the run (the read-check-write pair it replaces could mark a freshly
	// heartbeated run failed).
	if existing, err := db.GetRunningBatchRun(ctx, s.DB, userID, jobType); err != nil {
		release()
		return 0, err
	} else if existing != nil {
		_, _ = db.ReapStaleBatchRun(ctx, s.DB, existing.ID, int(staleRunThreshold.Seconds()))
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

// PartialScanError reports a fleet scan that did real work but could not reach
// part of the fleet. Every per-runner failure used to collapse into a count of
// zero, so an entirely unreachable fleet finished as a clean "0 containers,
// 0 updates" success - indistinguishable from a healthy scan of an empty fleet.
// Callers record it as completed-with-message (the run is not falsely claimed
// to have failed) and still return it so the mutation can report it.
type PartialScanError struct {
	Scanned int
	Failed  int
	Details []string
}

func (e *PartialScanError) Error() string {
	return fmt.Sprintf("partial scan: %d of %d runner(s) could not be scanned: %s",
		e.Failed, e.Failed+e.Scanned, strings.Join(e.Details, "; "))
}

// isPartialScan reports whether runErr is a PartialScanError.
func isPartialScan(runErr error) bool {
	var partial *PartialScanError
	return errors.As(runErr, &partial)
}

// completeRun finalizes runID with the scan's outcome. A hard failure is
// recorded as failed; a PartialScanError keeps the completed status but
// attaches the reason, so the run is not reported as a clean pass. The write
// is detached from ctx: a scan reaching this point on a dead context is
// normal (client disconnect), and losing the terminal write would leave the
// row showing "running" forever.
//
// Returns the completion error when the scan itself succeeded, because then
// the lost write is the only failure the caller has.
func (s *Service) completeRun(ctx context.Context, userID, runID int64, checked, updated int, runErr error) error {
	doneCtx := context.WithoutCancel(ctx)
	defer s.reportRun(doneCtx, userID, runID)
	if runErr != nil {
		msg := runErr.Error()
		status := "failed"
		if isPartialScan(runErr) {
			status = "completed"
		}
		if cerr := db.CompleteBatchRun(doneCtx, s.DB, runID, status, checked, updated, &msg); cerr != nil {
			slog.Error("failed to record batch run outcome", "runId", runID, "status", status, "error", cerr)
		}
		return runErr
	}
	if cerr := db.CompleteBatchRun(doneCtx, s.DB, runID, "completed", checked, updated, nil); cerr != nil {
		slog.Error("failed to mark batch run completed", "runId", runID, "error", cerr)
		// The scan succeeded but the run row is still "running", so anything
		// following this run waits on a state that will never arrive. Report
		// the loss instead of answering nil.
		return fmt.Errorf("record batch run outcome: %w", cerr)
	}
	return nil
}

// reportRun hands the finalized run to the GraphQL layer for fan-out. Deferred
// from completeRun so subscribers see the terminal state whatever the scan
// answered, and it runs after the write so the re-read cannot see a stale row.
func (s *Service) reportRun(ctx context.Context, userID, runID int64) {
	if s.OnBatchRun == nil {
		return
	}
	defer func() {
		if rec := recover(); rec != nil {
			slog.Error("panic in batch-run report hook", "recover", rec, "runId", runID)
		}
	}()
	s.OnBatchRun(ctx, userID, runID)
}

// ExecuteAndComplete performs the scan and finalizes the batch_run row
// created by Acquire. It always releases the in-process flag. Optional
// runnerIDs restrict the scan to specific runners; callers that want the
// whole user's fleet pass none.
func (s *Service) ExecuteAndComplete(ctx context.Context, userID, runID int64, runnerIDs ...int64) error {
	defer func() {
		s.mu.Lock()
		delete(s.running, userID)
		s.mu.Unlock()
	}()

	// Lease heartbeat: keep the batch_runs row fresh while the scan runs so
	// another process's stale-run reaper leaves it alone.
	stopHeartbeat := s.heartbeatRun(ctx, runID)
	defer stopHeartbeat()

	checked, updated, runErr := s.RunDockerHubPull(ctx, userID, runnerIDs...)
	completeErr := s.completeRun(ctx, userID, runID, checked, updated, runErr)
	if runErr == nil || isPartialScan(runErr) {
		// Immediate intents key off what the scan found, so they must still
		// fire when the scan finished but could not reach part of the fleet.
		s.fireScanComplete(context.WithoutCancel(ctx), userID, updated)
	}
	if runErr != nil {
		return runErr
	}
	return completeErr
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

// heartbeatRun ticks a lease heartbeat against the batch_runs row until the
// returned stop func runs. Beat well inside staleRunThreshold so a live run
// is never reaped by a peer process.
func (s *Service) heartbeatRun(ctx context.Context, runID int64) func() {
	done := make(chan struct{})
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := db.HeartbeatBatchRun(ctx, s.DB, runID); err != nil {
					slog.Warn("batch run heartbeat failed", "runId", runID, "error", err)
				}
			}
		}
	}()
	return func() { close(done) }
}

// ScanRunnerContainers ports DockerHubPullHandler.scanRunnerContainers.
// Unreachable runners are skipped; per-container failures are logged and
// skipped (including rate-limit errors, matching Node's per-container catch).
// ScanRunnerContainers scans one runner's containers. The error is non-nil
// only when the whole runner could not be scanned: the caller must know, or an
// unreachable host contributes zero and the run reads as a clean pass over an
// empty fleet.
func (s *Service) ScanRunnerContainers(ctx context.Context, rr db.RunnerRow, userID int64) (int, int, error) {
	checked, updated := 0, 0

	containers, err := runner.FetchContainers(ctx, rr)
	if err != nil {
		slog.Warn("runner unreachable during image scan, skipping",
			"runnerId", rr.ID, "runnerName", rr.Name, "error", err)
		return 0, 0, fmt.Errorf("%s: %w", rr.Name, err)
	}

	// The full snapshot (not just the containers we managed to persist) is
	// what the post-scan reconcile keeps: a container whose registry lookup or
	// inspect failed is still present on the runner.
	snapshotIDs := make([]string, 0, len(containers))
	for _, ctr := range containers {
		snapshotIDs = append(snapshotIDs, ctr.ID)
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
		// A dependent recreated by the upgrade pipeline is pinned to an image
		// ID, so Config.Image becomes "sha256:<id>" — SplitRepoTag would parse
		// that as a bogus "sha256" repo and silently break the container's
		// update tracking. Recover the original reference: the label the
		// pipeline stamped first (authoritative), then any repository digest
		// reference. A bare image ID is not a reference and never qualifies.
		pinned := strings.HasPrefix(imageName, "sha256:")
		if pinned {
			imageName = originalImageReference(details)
			if imageName == "" {
				imageName = firstRepoDigest(details, ctr.RepoDigests)
			}
			if imageName == "" {
				slog.Debug("container pinned to an image ID with no recoverable reference, skipping",
					"runnerId", rr.ID, "containerId", ctr.ID)
				continue
			}
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
		// The recovered reference carries the running image's digest; the
		// inspect document reported nothing usable for a pinned container, so
		// seed the digest from the reference instead of losing the baseline.
		if pinned && info.InspectDigest == nil {
			if digest := digestFromReference(imageName); digest != "" {
				info.InspectDigest = &digest
			}
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
		if stackName == "" {
			stackName = configLabel(details, "com.docker.stack.namespace")
		}
		if stackName == "" && ctr.StackName != nil {
			stackName = *ctr.StackName
		}
		var stackPtr *string
		if stackName != "" {
			stackPtr = &stackName
		}

		// hasUpdate is NOT computed here. The authoritative rule lives in
		// db.ContainerHasUpdate and is evaluated against the row that was just
		// persisted; an independent local calculation drifted from it (it
		// ignored the github-releases provider branch and the current-digest
		// fallback), so a container could be stored as updatable while the scan
		// reported it as current and suppressed its intent.

		currentDigest := pickCurrentDigest(info, ctr)

		cleanRepoDigests := cleanDigests(ctr.RepoDigests)

		data := &db.ContainerVersionUpsert{
			ContainerID:     ctr.ID,
			ContainerName:   containerName,
			ImageName:       imageName,
			ImageRepo:       parsed.ImageRepo,
			ImageTag:        parsed.Tag,
			Status:          nullIfEmpty(ctr.Status),
			State:           nullIfEmpty(ctr.State),
			StackName:       stackPtr,
			CurrentDigest:   currentDigest,
			Registry:        parsed.Registry,
			Namespace:       parsed.Namespace,
			Repository:      parsed.Repository,
			RepoDigests:     cleanRepoDigests,
			UsesNetworkMode: ctr.UsesNetworkMode,
			ProvidesNetwork: ctr.ProvidesNetwork,
		}

		version := buildVersionData(info, parsed.Tag)

		if _, err := db.UpsertContainerWithVersion(ctx, s.DB, userID, data, version, rr.ID); err != nil {
			if errors.Is(err, db.ErrRunnerGone) {
				// The runner was deleted mid-scan and DeleteRunner already
				// removed its rows; nothing else will clean up after us.
				slog.Info("runner deleted during image scan, stopping", "runnerId", rr.ID)
				return checked, updated, nil
			}
			slog.Debug("failed to upsert runner container",
				"runnerId", rr.ID, "containerId", ctr.ID, "error", err)
			continue
		}

		checked++
	}

	// The snapshot is authoritative for this runner: anything stored that the
	// snapshot does not list has been removed. Containers that were listed but
	// failed to process are still in the snapshot, so they survive.
	if _, err := db.ReconcileRunnerSnapshot(ctx, s.DB, userID, rr.ID, snapshotIDs); err != nil {
		slog.Warn("failed to reconcile runner container inventory", "runnerId", rr.ID, "error", err)
	}

	// Count updates from the rows we just persisted, using the one authoritative
	// helper the GraphQL layer also uses. Counting from the scan's own inputs
	// under-reported updates, which suppressed the intents that fire on
	// "containers became updatable".
	rows, err := db.GetContainersByRunner(ctx, s.DB, userID, rr.ID)
	if err != nil {
		slog.Warn("could not re-read containers to count updates", "runnerId", rr.ID, "error", err.Error())
	} else {
		updated = 0
		for i := range rows {
			if db.ContainerHasUpdate(rows[i]) {
				updated++
			}
		}
	}

	slog.Info("runner image scan complete", "runnerId", rr.ID, "runnerName", rr.Name,
		"checked", checked, "updated", updated)
	return checked, updated, nil
}

// RunDockerHubPull ports DockerHubPullHandler.execute for the runner-only
// world: snapshot containers, scan every docker-enabled runner, re-read,
// send Discord notifications, and fan out a ContainersUpdated event.
// Optional runnerIDs restrict the scan to specific runners — a request that
// names one runner must not pay for (or rewrite) the whole fleet.
func (s *Service) RunDockerHubPull(ctx context.Context, userID int64, runnerIDs ...int64) (int, int, error) {
	previous, err := db.GetContainers(ctx, s.DB, userID)
	if err != nil {
		return 0, 0, err
	}

	runners, err := db.GetEnabledRunners(ctx, s.DB, userID)
	if err != nil {
		return 0, 0, err
	}

	var only map[int64]bool
	if len(runnerIDs) > 0 {
		only = make(map[int64]bool, len(runnerIDs))
		for _, id := range runnerIDs {
			only[id] = true
		}
	}

	checked, updated := 0, 0
	var failed []string
	scanned := 0
	for _, rr := range runners {
		if rr.DockerEnabled.Int64 != 1 {
			continue
		}
		if only != nil && !only[rr.ID] {
			continue
		}
		c, u, serr := s.ScanRunnerContainers(ctx, rr, userID)
		if serr != nil {
			failed = append(failed, serr.Error())
			continue
		}
		scanned++
		checked += c
		updated += u
	}
	// A fleet that could not be reached at all is not a clean scan that found
	// nothing, and a fleet only partly reached must not hide the hosts that
	// were skipped. Both are reported; the partial case still finishes the
	// pass so the runners that DID answer get their notifications and event.
	var partialErr error
	if len(failed) > 0 {
		if scanned == 0 {
			return checked, updated, fmt.Errorf("no runner could be scanned: %s",
				strings.Join(failed, "; "))
		}
		partialErr = &PartialScanError{Scanned: scanned, Failed: len(failed), Details: failed}
	}

	current, err := db.GetContainers(ctx, s.DB, userID)
	if err != nil {
		return checked, updated, err
	}

	s.notifier.SendContainerUpdateNotifications(ctx, current, previous, userID)

	if s.Hub != nil {
		// Per-user channel: len(current) is this user's container count, so
		// broadcasting globally would leak one tenant's inventory size to
		// every other connected user.
		s.Hub.PublishContainersUpdated(userID, model.ContainersUpdatedEvent{
			ContainerCount: len(current),
		})
	}

	slog.Info("docker hub pull completed", "userId", userID,
		"containersChecked", checked, "containersUpdated", updated,
		"runnersFailed", len(failed))
	return checked, updated, partialErr
}

func nullIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
