package imagesync

// App version scan — port of services/batch/handlers/AppVersionScanHandler:
// fetch the configured apps from every enabled runner, enrich github-sourced
// apps with the latest release tag, count updates, and queue tracked-app
// Discord notifications (dedup key runner-<id>-app-<name> semantics live in
// the tracked-image dedup: identifier = app name, key = latest version).

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"

	"github.com/dockedapp/backend/internal/db"
	"github.com/dockedapp/backend/internal/runner"
)

// AppVersionJobType is the batch job type for the runner app version scan.
const AppVersionJobType = "app-version-scan"

// appVersionSource mirrors app.versionSource from the runner /apps payload.
type appVersionSource struct {
	Type string `json:"type"`
	Repo string `json:"repo"`
}

// runnerApp mirrors an AppSummary from the runner /apps payload plus the
// latestVersion appended by enrichment.
type runnerApp struct {
	Name                     string            `json:"name"`
	CurrentVersion           string            `json:"currentVersion"`
	LatestVersion            *string           `json:"latestVersion"`
	VersionSource            *appVersionSource `json:"versionSource"`
	GithubRepo               string            `json:"githubRepo"`
	SourceType               string            `json:"sourceType"`
	SystemUpdatesAvailable   *bool             `json:"systemUpdatesAvailable"`
	LatestVersionPublishDate *string           `json:"latestVersionPublishDate"`
	ReleaseURL               *string           `json:"releaseUrl"`
}

// AppVersionAcquire takes the run guard and creates the 'running' batch_run
// row for the app-version-scan job (same guard stack as TrackedAcquire, its
// own in-process flag so the three job types can run side by side like Node).
func (s *Service) AppVersionAcquire(ctx context.Context, userID int64, isManual bool) (int64, error) {
	return s.acquireRun(ctx, s.runningAppVersion, userID, isManual, AppVersionJobType)
}

// AppVersionExecuteAndComplete performs the scan and finalizes the batch_run
// row created by AppVersionAcquire, then fires the post-scan immediate-intent
// hook (Node's BatchManager hook runs for every job type).
func (s *Service) AppVersionExecuteAndComplete(ctx context.Context, userID, runID int64) error {
	defer func() {
		s.mu.Lock()
		delete(s.runningAppVersion, userID)
		s.mu.Unlock()
	}()

	stopHeartbeat := s.heartbeatRun(ctx, runID)
	defer stopHeartbeat()

	checked, updated, err := s.ScanRunnerApps(ctx, userID)

	doneCtx := context.WithoutCancel(ctx)
	if err != nil {
		msg := err.Error()
		if cerr := db.CompleteBatchRun(doneCtx, s.DB, runID, "failed", checked, updated, &msg); cerr != nil {
			slog.Error("failed to mark app-version-scan batch run failed", "runId", runID, "error", cerr)
		}
		return err
	}
	if cerr := db.CompleteBatchRun(doneCtx, s.DB, runID, "completed", checked, updated, nil); cerr != nil {
		slog.Error("failed to mark app-version-scan batch run completed", "runId", runID, "error", cerr)
	}
	s.fireScanComplete(ctx, userID, updated)
	return nil
}

// RunWithLockAppVersion performs the scan with the same guard stack as Node's
// BatchManager.executeJob for the app-version-scan handler.
func (s *Service) RunWithLockAppVersion(ctx context.Context, userID int64, isManual bool) (int64, error) {
	runID, err := s.AppVersionAcquire(ctx, userID, isManual)
	if err != nil {
		return 0, err
	}
	return runID, s.AppVersionExecuteAndComplete(ctx, userID, runID)
}

// ScanRunnerApps ports AppVersionScanHandler.execute: every enabled runner
// is fetched in parallel (Node's Promise.allSettled); an unreachable runner
// is skipped, per-app notification failures are swallowed.
// Returns (itemsChecked, itemsUpdated).
func (s *Service) ScanRunnerApps(ctx context.Context, userID int64) (int, int, error) {
	runners, err := db.GetEnabledRunners(ctx, s.DB, userID)
	if err != nil {
		return 0, 0, fmt.Errorf("get enabled runners: %w", err)
	}
	if len(runners) == 0 {
		slog.Info("no enabled runners found for user, skipping app version scan", "userId", userID)
		return 0, 0, nil
	}

	slog.Info("starting app version scan", "userId", userID, "runnerCount", len(runners))

	var mu sync.Mutex
	checked, updated, runnersSkipped := 0, 0, 0
	var wg sync.WaitGroup

	for i := range runners {
		rr := runners[i]
		wg.Add(1)
		go func() {
			defer wg.Done()
			defer func() {
				if r := recover(); r != nil {
					slog.Error("panic during app version scan", "runnerId", rr.ID, "error", r)
				}
			}()

			c, u, skipped := s.scanRunnerApps(ctx, userID, rr)
			mu.Lock()
			checked += c
			updated += u
			runnersSkipped += skipped
			mu.Unlock()
		}()
	}
	wg.Wait()

	slog.Info("app version scan completed", "userId", userID,
		"itemsChecked", checked, "itemsUpdated", updated, "runnersSkipped", runnersSkipped)
	return checked, updated, nil
}

// scanRunnerApps processes one runner: fetch + enrich + notify.
// Mirrors the per-runner branch of Node's Promise.allSettled map callback.
func (s *Service) scanRunnerApps(ctx context.Context, userID int64, rr db.RunnerRow) (checked, updated, skipped int) {
	data, err := runner.FetchJSON(ctx, rr, "/apps", nil)
	if err != nil {
		slog.Warn("runner unreachable during app version scan, skipping",
			"runnerId", rr.ID, "runnerName", rr.Name, "error", err.Error())
		return 0, 0, 1
	}

	apps := decodeRunnerApps(data["apps"])
	enrichAppsWithVersions(ctx, apps)

	var updatedApps []*runnerApp
	for i := range apps {
		if appHasUpdate(apps[i]) {
			updatedApps = append(updatedApps, apps[i])
		}
	}

	// Queue Discord notifications for newly-detected app updates
	// (notificationType tracked-app; best-effort).
	for _, app := range updatedApps {
		latest := derefStr(app.LatestVersion)
		s.notifier.queueTrackedNotification(ctx, trackedNotification{
			Name:                     app.Name,
			ImageName:                app.Name,
			GithubRepo:               app.GithubRepo,
			SourceType:               jsFallback(app.SourceType, "app"),
			CurrentVersion:           jsFallback(app.CurrentVersion, "unknown"),
			LatestVersion:            jsFallback(latest, "unknown"),
			LatestVersionPublishDate: app.LatestVersionPublishDate,
			ReleaseURL:               app.ReleaseURL,
		}, userID)
	}

	return len(apps), len(updatedApps), 0
}

// decodeRunnerApps re-decodes the raw /apps payload list into typed apps
// (Node: data.apps || []).
func decodeRunnerApps(raw any) []*runnerApp {
	if raw == nil {
		return nil
	}
	buf, err := json.Marshal(raw)
	if err != nil {
		return nil
	}
	var apps []*runnerApp
	if err := json.Unmarshal(buf, &apps); err != nil {
		return nil
	}
	return apps
}

// enrichAppsWithVersions ports runnerService.enrichAppsWithVersions: only
// github-sourced apps get latestVersion overwritten (tag_name or null);
// command-sourced and untyped apps keep whatever the runner reported.
func enrichAppsWithVersions(ctx context.Context, apps []*runnerApp) {
	for _, app := range apps {
		if app == nil {
			continue
		}
		if app.VersionSource == nil || app.VersionSource.Type == "command" {
			continue
		}
		if app.VersionSource.Type != "github" || app.VersionSource.Repo == "" {
			continue
		}
		tag, ok := runner.LatestReleaseTag(ctx, app.VersionSource.Repo, false)
		if !ok {
			app.LatestVersion = nil
		} else {
			v := tag
			app.LatestVersion = &v
		}
	}
}

// appHasUpdate ports the handler's updated filter, including JS truthiness:
// (latestVersion && currentVersion && latestVersion !== currentVersion) ||
// systemUpdatesAvailable === true.
func appHasUpdate(a *runnerApp) bool {
	if a == nil {
		return false
	}
	latest := derefStr(a.LatestVersion)
	if latest != "" && a.CurrentVersion != "" && latest != a.CurrentVersion {
		return true
	}
	return a.SystemUpdatesAvailable != nil && *a.SystemUpdatesAvailable
}

// jsFallback ports `value || fallback` (empty string is falsy in JS).
func jsFallback(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}
