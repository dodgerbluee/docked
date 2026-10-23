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
	"strconv"
	"strings"
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

	checked, updated, runErr := s.ScanRunnerApps(ctx, userID)
	completeErr := s.completeRun(ctx, runID, checked, updated, runErr)
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
	checked, updated := 0, 0
	var failed []string
	scanned := 0
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

			c, u, serr := s.scanRunnerApps(ctx, userID, rr)
			mu.Lock()
			if serr != nil {
				failed = append(failed, serr.Error())
			} else {
				scanned++
				checked += c
				updated += u
			}
			mu.Unlock()
		}()
	}
	wg.Wait()

	// Runners that could not answer used to be counted as "skipped" and
	// dropped, so an unreachable fleet finished as a clean 0/0 success.
	var runErr error
	if len(failed) > 0 {
		if scanned == 0 {
			runErr = fmt.Errorf("no runner could be scanned: %s", strings.Join(failed, "; "))
		} else {
			runErr = &PartialScanError{Scanned: scanned, Failed: len(failed), Details: failed}
		}
	}

	slog.Info("app version scan completed", "userId", userID,
		"itemsChecked", checked, "itemsUpdated", updated, "runnersFailed", len(failed))
	return checked, updated, runErr
}

// scanRunnerApps processes one runner: fetch + enrich + notify.
// Mirrors the per-runner branch of Node's Promise.allSettled map callback.
// The error is non-nil only when the whole runner could not be scanned.
func (s *Service) scanRunnerApps(ctx context.Context, userID int64, rr db.RunnerRow) (checked, updated int, err error) {
	data, err := runner.FetchJSON(ctx, rr, "/apps", nil)
	if err != nil {
		slog.Warn("runner unreachable during app version scan, skipping",
			"runnerId", rr.ID, "runnerName", rr.Name, "error", err.Error())
		return 0, 0, fmt.Errorf("%s: %w", rr.Name, err)
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
			Name:       app.Name,
			ImageName:  app.Name,
			GithubRepo: app.GithubRepo,
			SourceType: jsFallback(app.SourceType, "app"),
			// Raw versions: the formatter already renders an empty version as
			// "Unknown", and putting that word in the dedup key would make the
			// key the same for every version-less update of this app.
			CurrentVersion:           app.CurrentVersion,
			LatestVersion:            latest,
			LatestVersionPublishDate: app.LatestVersionPublishDate,
			ReleaseURL:               app.ReleaseURL,
			Host:                     strconv.FormatInt(rr.ID, 10),
		}, userID)
	}

	return len(apps), len(updatedApps), nil
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
	// Compare normalized versions: GitHub tags are usually "v1.2.3" while the
	// runner reports the app's own "1.2.3", and a raw compare calls every one
	// of those an available update.
	if latest != "" && a.CurrentVersion != "" &&
		normalizeVersion(latest) != normalizeVersion(a.CurrentVersion) {
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
