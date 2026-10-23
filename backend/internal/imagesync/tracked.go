package imagesync

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/dockedapp/backend/internal/db"
	"github.com/dockedapp/backend/internal/registry"
)

// TrackedJobType is the batch job type for the tracked-apps update scan
// (Node: services/batch/handlers/TrackedAppsCheckHandler).
const TrackedJobType = "tracked-apps-check"

// ErrRateLimited aborts a tracked-apps scan when Docker Hub returns 429
// (Node: error.isRateLimitExceeded -> stop processing, propagate).
var ErrRateLimited = errors.New("rate limited by Docker Hub")

// dockerHubTagsBase is exported-as-var for tests (mirrors runner.GitHubAPIBase).
var dockerHubTagsBase = "https://hub.docker.com"

// githubAPIBase and gitlabAPIBaseOverride exist for tests; production uses
// api.github.com and the per-repo baseUrl from parsing.
var githubAPIBase = "https://api.github.com"

// trackedHTTPClient is the shared client for the tracked-app registry calls
// (Docker Hub tags, GitHub, GitLab). Tests swap it for an httptest client.
var trackedHTTPClient = &http.Client{Timeout: 10 * time.Second}

// SetTrackedHTTPTransport installs a transport for the tracked-app registry
// calls (nil restores the default). It exists so callers outside this
// package — e.g. graph tests exercising the release cache — can intercept
// the outbound HTTPS calls without reaching the unexported client.
func SetTrackedHTTPTransport(rt http.RoundTripper) {
	trackedHTTPClient.Transport = rt
}

// trackedCheckResult mirrors the object Node's checkTrackedApp returns.
type trackedCheckResult struct {
	ID                        int64
	Name                      string
	ImageName                 *string
	GithubRepo                *string
	SourceType                string
	CurrentVersion            string
	CurrentDigest             *string
	LatestVersion             string
	LatestDigest              *string
	HasUpdate                 bool
	LatestPublishDate         *string
	CurrentVersionPublishDate *string
	ReleaseURL                *string
}

// TrackedAcquire takes the tracked-apps run guard and creates the 'running'
// batch_run row. Same guard stack as Acquire, separate in-process flag so a
// container sync and a tracked-apps scan can run concurrently (Node runs both
// job types side by side).
func (s *Service) TrackedAcquire(ctx context.Context, userID int64, isManual bool) (int64, error) {
	return s.acquireRun(ctx, s.runningTracked, userID, isManual, TrackedJobType)
}

// TrackedExecuteAndComplete performs the tracked-apps scan and finalizes the
// batch_run row created by TrackedAcquire. It always releases the in-process
// flag.
func (s *Service) TrackedExecuteAndComplete(ctx context.Context, userID, runID int64) error {
	defer func() {
		s.mu.Lock()
		delete(s.runningTracked, userID)
		s.mu.Unlock()
	}()

	stopHeartbeat := s.heartbeatRun(ctx, runID)
	defer stopHeartbeat()

	checked, updated, runErr := s.CheckAllTrackedApps(ctx, userID)

	doneCtx := context.WithoutCancel(ctx)
	if runErr != nil {
		msg := runErr.Error()
		if cerr := db.CompleteBatchRun(doneCtx, s.DB, runID, "failed", checked, updated, &msg); cerr != nil {
			slog.Error("failed to mark tracked-apps batch run failed", "runId", runID, "error", cerr)
		}
		return runErr
	}
	if cerr := db.CompleteBatchRun(doneCtx, s.DB, runID, "completed", checked, updated, nil); cerr != nil {
		slog.Error("failed to mark tracked-apps batch run completed", "runId", runID, "error", cerr)
	}
	s.fireScanComplete(ctx, userID, updated)
	return nil
}

// RunWithLockTracked performs a tracked-apps scan with the same guard stack
// as Node's BatchManager.executeJob for the tracked-apps-check handler.
func (s *Service) RunWithLockTracked(ctx context.Context, userID int64, isManual bool) (int64, error) {
	runID, err := s.TrackedAcquire(ctx, userID, isManual)
	if err != nil {
		return 0, err
	}
	return runID, s.TrackedExecuteAndComplete(ctx, userID, runID)
}

// CheckAllTrackedApps ports checkAllTrackedApps: iterate every tracked app,
// check each one, abort the whole scan on Docker Hub rate limiting, log and
// continue on other per-app errors. Returns (checked, updated).
func (s *Service) CheckAllTrackedApps(ctx context.Context, userID int64) (int, int, error) {
	apps, err := db.GetAllTrackedApps(ctx, s.DB, userID)
	if err != nil {
		return 0, 0, fmt.Errorf("get tracked apps: %w", err)
	}

	checked, updated := 0, 0
	for i := range apps {
		app := apps[i]
		res, cerr := s.CheckTrackedApp(ctx, &app)
		if cerr != nil {
			if errors.Is(cerr, ErrRateLimited) {
				return checked, updated, cerr
			}
			slog.Error("error checking tracked image", "name", app.Name, "error", cerr)
			checked++
			continue
		}
		checked++
		if res.HasUpdate {
			updated++
		}
	}
	return checked, updated, nil
}

// CheckTrackedApp ports checkTrackedApp: dispatch by source_type.
func (s *Service) CheckTrackedApp(ctx context.Context, app *db.TrackedAppRow) (*trackedCheckResult, error) {
	sourceType := app.SourceType
	if sourceType == "" {
		sourceType = "docker"
	}

	if sourceType == "github" && app.GithubRepo.Valid && app.GithubRepo.String != "" {
		return s.checkGitHubTrackedApp(ctx, app)
	}
	if sourceType == "gitlab" && app.GithubRepo.Valid && app.GithubRepo.String != "" {
		return s.checkGitLabTrackedApp(ctx, app)
	}
	return s.checkDockerTrackedApp(ctx, app)
}

// dockerHubRepoKey maps an image reference's repository part onto the
// "namespace/repository" key the Docker Hub tags API serves. ok=false means
// the reference points at some other registry, where the Hub API can never
// resolve it: a host-qualified first segment (ghcr.io, gcr.io, quay.io,
// registry.gitlab.com, lscr.io, a private host) or a port-qualified host
// (localhost:5000/app). Deep paths (three or more segments) are always
// host-qualified, since a Hub repository is only ever namespace/name.
func dockerHubRepoKey(repo string) (string, bool) {
	repo = strings.TrimSpace(repo)
	if repo == "" {
		return "", false
	}
	repo = strings.TrimPrefix(repo, "docker.io/")
	repo = strings.TrimPrefix(repo, "registry-1.docker.io/")
	if repo == "" {
		return "", false
	}

	first, rest, deep := strings.Cut(repo, "/")
	if strings.ContainsAny(first, ".:") {
		return "", false
	}
	if !deep {
		// Bare official image: nginx -> library/nginx
		return "library/" + first, true
	}
	if strings.Contains(rest, "/") {
		return "", false
	}
	return repo, true
}

// checkDockerTrackedApp ports the Docker-Hub tags branch of checkTrackedApp.
//
// Note: Node's version of this path is latently broken — it references an
// undefined `creds` variable before the request, so every docker tracked app
// threw and returned "Could not fetch". The tags endpoint is public, so this
// port deliberately drops the credential block and works.
func (s *Service) checkDockerTrackedApp(ctx context.Context, app *db.TrackedAppRow) (*trackedCheckResult, error) {
	imageName := app.ImageName.String
	if !app.ImageName.Valid || imageName == "" {
		return nil, errors.New("No image name found — app may be a GitHub/GitLab repo missing source_type column")
	}

	repo, currentTag := registry.SplitRepoTag(imageName)

	// Only Docker Hub images can be resolved through the Hub tags API.
	// Non-Hub references (ghcr.io, gcr.io, private registries) would query
	// the Hub with a bogus namespace, so they count as "no observation"
	// and the existing state is preserved below.
	var info *dockerTagsInfo
	if hubRepo, ok := dockerHubRepoKey(repo); ok {
		var err error
		info, err = getLatestVersionFromDockerHubTags(ctx, hubRepo)
		if err != nil && !errors.Is(err, ErrRateLimited) {
			info = nil
		}
		if errors.Is(err, ErrRateLimited) {
			return nil, err
		}
	}
	observed := info != nil

	hasUpdate := false
	var latestDigest *string
	latestTag := currentTag
	var latestVersion *string

	if info != nil {
		latestDigest = &info.latestDigest
		latestTag = info.latestTag
		latestVersion = &info.latestVersion

		if app.CurrentDigest.Valid && app.CurrentDigest.String != "" {
			hasUpdate = app.CurrentDigest.String != info.latestDigest
		} else if app.CurrentVersion.Valid && app.CurrentVersion.String != "" && info.latestVersion != "" {
			nc := normalizeVersion(app.CurrentVersion.String)
			nl := normalizeVersion(info.latestVersion)
			if nc != "" && nl != "" {
				hasUpdate = nc != nl
			} else {
				hasUpdate = app.CurrentVersion.String != info.latestVersion
			}
		}
		// else: no stored current version/digest -> first check, no update.
	}

	// Publish dates.
	var latestPublishDate *string
	if info != nil && info.latestPublishDate != "" {
		pd := info.latestPublishDate
		latestPublishDate = &pd
	}
	var currentVersionPublishDate *string

	if latestPublishDate == nil && latestVersion != nil && *latestVersion != "" && hasUpdate {
		tagForPublishDate := *latestVersion
		if tagForPublishDate == "latest" {
			tagForPublishDate = latestTag
		}
		if tagForPublishDate != "" {
			opts := registryOptions(app)
			if pd, perr := s.Registry.GetTagPublishDate(ctx, repo, tagForPublishDate, opts); perr == nil {
				latestPublishDate = pd
			}
		}
	}

	if app.CurrentVersion.Valid && app.CurrentVersion.String != "" && app.CurrentVersion.String != "latest" {
		opts := registryOptions(app)
		if pd, perr := s.Registry.GetTagPublishDate(ctx, repo, app.CurrentVersion.String, opts); perr == nil {
			currentVersionPublishDate = pd
		}
	} else if (!app.CurrentVersion.Valid || app.CurrentVersion.String == "") && latestVersion != nil && *latestVersion != "" && *latestVersion != "latest" {
		currentVersionPublishDate = latestPublishDate
	}

	// Backfill current version/digest (first check or "latest" placeholder).
	currentVersionToStore := app.CurrentVersion
	currentDigestToStore := app.CurrentDigest
	versionBackfilled := false

	if latestVersion != nil && *latestVersion != "" && *latestVersion != "latest" {
		if !currentVersionToStore.Valid || currentVersionToStore.String == "" || currentVersionToStore.String == "latest" {
			currentVersionToStore = sql.NullString{String: *latestVersion, Valid: true}
			versionBackfilled = true
		}
	} else if (!currentVersionToStore.Valid || currentVersionToStore.String == "") && latestVersion != nil && *latestVersion != "" {
		currentVersionToStore = sql.NullString{String: *latestVersion, Valid: true}
		versionBackfilled = true
	}

	if !currentDigestToStore.Valid || currentDigestToStore.String == "" {
		if versionBackfilled {
			// We just claimed latest IS the current version, so the latest
			// digest is the right baseline.
			if latestDigest != nil {
				currentDigestToStore = sql.NullString{String: *latestDigest, Valid: true}
			}
		} else if observed && app.CurrentVersion.Valid && app.CurrentVersion.String != "" &&
			app.CurrentVersion.String != "latest" {
			// current_version already existed: seed the digest baseline with
			// the digest of THAT tag, not the newest tag's digest. Seeding
			// the latest digest here would make the digest-first comparison
			// (current_digest != latest_digest) mask every future update.
			if d, ok := info.tagDigests[normalizeVersion(app.CurrentVersion.String)]; ok {
				currentDigestToStore = sql.NullString{String: d, Valid: true}
			}
		}
	}

	// Persist (Node updateTrackedApp field mapping). A failed lookup is NOT
	// an observation: has_update and the cleared publish-date must not
	// overwrite state confirmed by an earlier successful check.
	updateData := map[string]any{
		"last_checked": time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
	}
	if observed {
		updateData["has_update"] = boolToInt(hasUpdate)
	}
	if latestVersion != nil {
		if v := jsStoreableString(*latestVersion); v != "" {
			updateData["latest_version"] = v
		}
	}
	if latestDigest != nil {
		if v := jsStoreableString(*latestDigest); v != "" {
			updateData["latest_digest"] = v
		}
	}
	if currentVersionToStore.Valid && currentVersionToStore.String != "" &&
		(!app.CurrentVersion.Valid || currentVersionToStore.String != app.CurrentVersion.String) {
		updateData["current_version"] = currentVersionToStore.String
	}
	if currentDigestToStore.Valid && currentDigestToStore.String != "" &&
		(!app.CurrentDigest.Valid || currentDigestToStore.String != app.CurrentDigest.String) {
		updateData["current_digest"] = currentDigestToStore.String
	}

	if currentVersionPublishDate != nil && *currentVersionPublishDate != "" {
		updateData["current_version_publish_date"] = *currentVersionPublishDate
	}
	if latestPublishDate != nil && *latestPublishDate != "" {
		if hasUpdate {
			updateData["latest_version_publish_date"] = *latestPublishDate
		} else if app.LatestVersionPublishDate.Valid && app.LatestVersionPublishDate.String != "" {
			updateData["latest_version_publish_date"] = nil
		}
	} else if !hasUpdate && app.LatestVersionPublishDate.Valid && app.LatestVersionPublishDate.String != "" {
		updateData["latest_version_publish_date"] = nil
	}

	applied, err := db.UpdateTrackedAppFields(ctx, s.DB, app.ID, app.UserID, updateData, app.ObservedSnapshot())
	if err != nil {
		return nil, fmt.Errorf("update tracked app: %w", err)
	}
	if !applied {
		// The row moved underneath this check — the user acknowledged an
		// upgrade, or a parallel scan wrote first. Skip instead of clobbering
		// that newer baseline; the next check recomputes from it.
		slog.Info("tracked-app check skipped: baseline changed during the check",
			"appId", app.ID, "sourceType", app.SourceType)
		s.reloadAfterRejectedWrite(ctx, app)
	}
	if !applied || !observed {
		// Nothing this check produced is in the database (either the write was
		// rejected or the registry lookup failed), so it must not be reported
		// either: report what the row actually holds.
		hasUpdate, currentVersionToStore, latestVersion, currentVersionPublishDate = observedStateFromRow(app)
		latestDigest = nil
		if app.LatestDigest.Valid && app.LatestDigest.String != "" {
			d := app.LatestDigest.String
			latestDigest = &d
		}
	}

	// Display values.
	displayCurrentVersion := jsString(currentVersionToStore)
	if displayCurrentVersion == "" {
		displayCurrentVersion = jsString(app.CurrentVersion)
	}
	if displayCurrentVersion == "" {
		displayCurrentVersion = currentTag
	}

	displayLatestVersion := currentTag
	if latestVersion != nil && *latestVersion != "" && *latestVersion != "latest" {
		displayLatestVersion = *latestVersion
	} else if app.LatestVersion.Valid && app.LatestVersion.String != "" && app.LatestVersion.String != "latest" {
		displayLatestVersion = app.LatestVersion.String
	} else if app.LatestVersion.Valid && app.LatestVersion.String != "" {
		displayLatestVersion = app.LatestVersion.String
	}

	newly := newlyDetectedDocker(hasUpdate, app, latestDigest, latestVersion)
	if newly {
		slog.Info("new tracked app update detected",
			"trackedAppId", app.ID, "name", app.Name, "image", imageName,
			"currentVersion", displayCurrentVersion, "latestVersion", displayLatestVersion)
		s.notifier.queueTrackedNotification(ctx, trackedNotification{
			Name:                     app.Name,
			ImageName:                imageName,
			SourceType:               "docker",
			CurrentVersion:           displayCurrentVersion,
			LatestVersion:            displayLatestVersion,
			LatestDigest:             latestDigest,
			LatestVersionPublishDate: latestPublishDate,
		}, app.UserID)
	}

	return &trackedCheckResult{
		ID:                app.ID,
		Name:              app.Name,
		ImageName:         &imageName,
		SourceType:        "docker",
		CurrentVersion:    displayCurrentVersion,
		CurrentDigest:     formatDigest(firstNonNil(jsString(currentDigestToStore), jsString(app.CurrentDigest))),
		LatestVersion:     displayLatestVersion,
		LatestDigest:      formatDigest(firstNonNil(derefStr(latestDigest), jsString(app.LatestDigest))),
		HasUpdate:         hasUpdate,
		LatestPublishDate: latestPublishDate,
	}, nil
}

// registryOptions builds the publish-date lookup options for a tracked app.
func registryOptions(app *db.TrackedAppRow) registry.Options {
	opts := registry.Options{UserID: app.UserID}
	if app.GithubRepo.Valid {
		opts.GithubRepo = app.GithubRepo.String
	}
	return opts
}

// newlyDetectedDocker ports the docker isNewlyDetectedUpdate expression.
func newlyDetectedDocker(hasUpdate bool, app *db.TrackedAppRow, latestDigest, latestVersion *string) bool {
	if !hasUpdate {
		return false
	}
	if app.HasUpdate != 1 {
		return true
	}
	if latestDigest != nil && *latestDigest != "" && app.LatestDigest.Valid && app.LatestDigest.String != "" &&
		normalizeDigestForComparison(*latestDigest) != normalizeDigestForComparison(app.LatestDigest.String) {
		return true
	}
	if latestVersion != nil && *latestVersion != "" && app.LatestVersion.Valid && app.LatestVersion.String != "" &&
		normalizeVersion(*latestVersion) != normalizeVersion(app.LatestVersion.String) {
		return true
	}
	return false
}

// newlyDetectedVersion ports the GitHub/GitLab isNewlyDetectedUpdate
// expression (version comparison only).
// reloadAfterRejectedWrite re-reads the row after the snapshot guard rejected
// this check's write. Nothing the check computed reached the database, so the
// caller must neither queue a notification for an update that was never
// recorded nor return state the row does not hold: the caller recomputes its
// report from the fresh row instead.
func (s *Service) reloadAfterRejectedWrite(ctx context.Context, app *db.TrackedAppRow) {
	fresh, err := db.GetTrackedAppByID(ctx, s.DB, app.ID, app.UserID)
	if err != nil || fresh == nil {
		slog.Warn("tracked-app check: could not re-read row after a rejected write",
			"appId", app.ID, "error", err)
		return
	}
	*app = *fresh
}

// observedStateFromRow copies the row's stored observation into the local
// variables a check reports, for the two paths where the check's own conclusion
// must not be reported: a rejected write (nothing was stored) and a failed
// upstream lookup (nothing was observed).
func observedStateFromRow(app *db.TrackedAppRow) (bool, sql.NullString, *string, *string) {
	hasUpdate := app.HasUpdate == 1
	var latestVersion, currentPublishDate *string
	if app.LatestVersion.Valid && app.LatestVersion.String != "" {
		v := app.LatestVersion.String
		latestVersion = &v
	}
	if app.CurrentVersionPublishDate.Valid && app.CurrentVersionPublishDate.String != "" {
		v := app.CurrentVersionPublishDate.String
		currentPublishDate = &v
	}
	return hasUpdate, app.CurrentVersion, latestVersion, currentPublishDate
}

func newlyDetectedVersion(hasUpdate bool, app *db.TrackedAppRow, latestVersion *string) bool {
	if !hasUpdate {
		return false
	}
	if app.HasUpdate != 1 {
		return true
	}
	return latestVersion != nil && *latestVersion != "" &&
		app.LatestVersion.Valid && app.LatestVersion.String != "" &&
		normalizeVersion(*latestVersion) != normalizeVersion(app.LatestVersion.String)
}

// normalizeVersion ports the repeated `(v) => String(v).replace(/^v/i, "").trim().toLowerCase()`.
// Faithful order: the v-strip is anchored on the UNTRIMMED string, so a
// leading space protects the v (Node quirk preserved).
func normalizeVersion(v string) string {
	s := v
	if len(s) > 0 && (s[0] == 'v' || s[0] == 'V') {
		s = s[1:]
	}
	return strings.ToLower(strings.TrimSpace(s))
}

var shaPrefixRe = regexp.MustCompile(`(?i)^sha256:`)

// normalizeDigestForComparison ports normalizeDigestForComparison.
func normalizeDigestForComparison(digest string) string {
	if digest == "" {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(shaPrefixRe.ReplaceAllString(digest, "")))
}

// formatDigest ports formatDigest: strip the first "sha256:" and keep 12 chars.
func formatDigest(digest string) *string {
	if digest == "" {
		return nil
	}
	short := strings.Replace(digest, "sha256:", "", 1)
	if len(short) > 12 {
		short = short[:12]
	}
	return &short
}

// jsStoreableString mirrors the `versionStr !== "" && !== "null" && !== "undefined"` guard.
func jsStoreableString(s string) string {
	s = strings.TrimSpace(s)
	if s == "" || s == "null" || s == "undefined" {
		return ""
	}
	return s
}

// jsString renders a NullString as its value or "" (empty string is falsy in JS).
func jsString(s sql.NullString) string {
	if !s.Valid {
		return ""
	}
	return s.String
}

// derefStr renders a *string as its value or "".
func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

func firstNonNil(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}
