package imagesync

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/dockedapp/backend/internal/db"
)

// ghRelease mirrors the subset of the GitHub releases API payload used here.
type ghRelease struct {
	TagName     string `json:"tag_name"`
	Name        string `json:"name"`
	PublishedAt string `json:"published_at"`
	HTMLURL     string `json:"html_url"`
	Prerelease  bool   `json:"prerelease"`
	Draft       bool   `json:"draft"`
}

// releaseCache ports the shared utils/cache used by githubService/gitlabService:
// 1h TTL, falsy values (null) never hit.
type releaseCacheEntry struct {
	value   any
	expires time.Time
}

var (
	releaseCacheMu sync.Mutex
	releaseCache   = map[string]releaseCacheEntry{}
)

const releaseCacheTTL = time.Hour

func cacheGet(key string) (any, bool) {
	releaseCacheMu.Lock()
	defer releaseCacheMu.Unlock()
	e, ok := releaseCache[key]
	if !ok || time.Now().After(e.expires) {
		return nil, false
	}
	return e.value, true
}

func cacheSet(key string, value any) {
	releaseCacheMu.Lock()
	defer releaseCacheMu.Unlock()
	releaseCache[key] = releaseCacheEntry{value: value, expires: time.Now().Add(releaseCacheTTL)}
}

// ClearReleaseCache empties the shared GitHub/GitLab release cache (used by
// tests and parity with Node's clearReleaseCache).
func ClearReleaseCache() {
	releaseCacheMu.Lock()
	defer releaseCacheMu.Unlock()
	releaseCache = map[string]releaseCacheEntry{}
}

// ReleaseCacheSize reports the live entry count for debug introspection.
func ReleaseCacheSize() int {
	releaseCacheMu.Lock()
	defer releaseCacheMu.Unlock()
	return len(releaseCache)
}

// parseGitHubRepo ports parseGitHubRepo.
func parseGitHubRepo(repoInput string) (owner, repo string, ok bool) {
	trimmed := strings.TrimSpace(repoInput)
	if trimmed == "" {
		return "", "", false
	}

	switch {
	case strings.HasPrefix(trimmed, "https://github.com/"):
		parts := strings.Split(strings.Replace(trimmed, "https://github.com/", "", 1), "/")
		var kept []string
		for _, p := range parts {
			if p != "" {
				kept = append(kept, p)
			}
		}
		if len(kept) >= 2 {
			owner, repo = kept[0], strings.Replace(kept[1], ".git", "", 1)
		}
	case strings.HasPrefix(trimmed, "git@github.com:"):
		// Faithful: Node strips ".git" from the whole remainder BEFORE
		// splitting (first occurrence anywhere), not from the repo part.
		rest := strings.Replace(strings.Replace(trimmed, "git@github.com:", "", 1), ".git", "", 1)
		parts := strings.Split(rest, "/")
		if len(parts) >= 2 {
			owner, repo = parts[0], parts[1]
		}
	case strings.Contains(trimmed, "/"):
		parts := strings.Split(trimmed, "/")
		var kept []string
		for _, p := range parts {
			if p != "" {
				kept = append(kept, p)
			}
		}
		if len(kept) >= 2 {
			owner, repo = kept[0], strings.Replace(kept[1], ".git", "", 1)
		}
	}

	if owner != "" && repo != "" {
		return strings.TrimSpace(owner), strings.TrimSpace(repo), true
	}
	return "", "", false
}

// githubGet ports githubGet: token headers + org-policy 403 retry without token.
// Returns status + decoded body; only transport/5xx errors return err.
func githubGet(ctx context.Context, url string) (int, []byte, error) {
	do := func(withToken bool) (int, []byte, error) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return 0, nil, err
		}
		req.Header.Set("Accept", "application/vnd.github.v3+json")
		req.Header.Set("User-Agent", "Docked/1.0")
		if withToken {
			if tok := os.Getenv("GITHUB_TOKEN"); tok != "" {
				req.Header.Set("Authorization", "token "+tok)
			}
		}
		client := trackedHTTPClient
		resp, err := client.Do(req)
		if err != nil {
			return 0, nil, err
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
		return resp.StatusCode, body, nil
	}

	status, body, err := do(true)
	if err != nil || status < 500 {
		return status, body, err
	}
	// 5xx: axios validateStatus(<500) would have thrown; caller handles via handleGitHubError.
	return status, body, fmt.Errorf("github api error: status %d", status)
}

// isOrgPolicyRejection ports isOrgPolicyRejection.
func isOrgPolicyRejection(status int, body []byte) bool {
	if status != 403 {
		return false
	}
	var payload struct {
		Message string `json:"message"`
	}
	_ = json.Unmarshal(body, &payload)
	msg := payload.Message
	return strings.Contains(msg, "organization") &&
		(strings.Contains(msg, "forbids") || strings.Contains(msg, "fine-grained"))
}

// githubGetWithRetry combines githubGet's org-policy retry.
func githubGetWithRetry(ctx context.Context, url string) (int, []byte, error) {
	status, body, err := githubGet(ctx, url)
	if err != nil {
		return status, body, err
	}
	if isOrgPolicyRejection(status, body) && os.Getenv("GITHUB_TOKEN") != "" {
		return githubGetNoToken(ctx, url)
	}
	return status, body, nil
}

func githubGetNoToken(ctx context.Context, url string) (int, []byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Accept", "application/vnd.github.v3+json")
	req.Header.Set("User-Agent", "Docked/1.0")
	client := trackedHTTPClient
	resp, err := client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	return resp.StatusCode, body, nil
}

// handleGitHubError ports handleGitHubError (only reachable for transport/5xx
// errors given the <500 validateStatus port).
func handleGitHubError(err error, owner, repo string) error {
	if strings.Contains(err.Error(), "status 404") {
		return fmt.Errorf("Repository %s/%s not found or has no releases", owner, repo)
	}
	if strings.Contains(err.Error(), "status 403") {
		return fmt.Errorf("GitHub API rate limit or access restriction. Consider checking your GITHUB_TOKEN.")
	}
	return fmt.Errorf("Failed to fetch GitHub releases: %v", err)
}

// ghGetLatestRelease ports getLatestRelease + fetchLatestRelease.
func ghGetLatestRelease(ctx context.Context, repoInput string) (*ghRelease, error) {
	owner, repo, ok := parseGitHubRepo(repoInput)
	if !ok {
		return nil, fmt.Errorf("Invalid GitHub repository format. Use owner/repo or full GitHub URL.")
	}
	cacheKey := fmt.Sprintf("github:%s/%s", owner, repo)

	if cached, ok := cacheGet(cacheKey); ok {
		if list, ok := cached.([]*ghRelease); ok && len(list) > 0 {
			return list[0], nil
		}
	}

	status, body, err := githubGetWithRetry(ctx, fmt.Sprintf("%s/repos/%s/%s/releases/latest", githubAPIBase, owner, repo))
	if err != nil {
		return nil, handleGitHubError(err, owner, repo)
	}
	if status == 200 && len(body) > 0 {
		var rel ghRelease
		if err := json.Unmarshal(body, &rel); err == nil {
			cacheSet(cacheKey, []*ghRelease{&rel})
			return &rel, nil
		}
	}
	// Non-200 (<500): Node returns null here; the all-releases fallback in
	// fetchLatestRelease only fires on axios-thrown 404s, which cannot happen
	// with validateStatus<500 — ported faithfully.
	return nil, nil
}

// ghGetAllReleases ports getAllReleases.
func ghGetAllReleases(ctx context.Context, repoInput string, limit int) ([]*ghRelease, error) {
	owner, repo, ok := parseGitHubRepo(repoInput)
	if !ok {
		return nil, fmt.Errorf("Invalid GitHub repository format. Use owner/repo or full GitHub URL.")
	}
	cacheKey := fmt.Sprintf("github:%s/%s:all", owner, repo)

	if cached, ok := cacheGet(cacheKey); ok {
		if list, ok := cached.([]*ghRelease); ok {
			if len(list) > limit {
				list = list[:limit]
			}
			return list, nil
		}
	}

	status, body, err := githubGetWithRetry(ctx, fmt.Sprintf("%s/repos/%s/%s/releases?per_page=%d", githubAPIBase, owner, repo, limit))
	if err != nil {
		return nil, handleGitHubError(err, owner, repo)
	}
	if status != 200 {
		return nil, nil
	}
	var raw []*ghRelease
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, nil
	}
	filtered := make([]*ghRelease, 0, len(raw))
	for _, r := range raw {
		if !r.Prerelease && !r.Draft {
			filtered = append(filtered, r)
		}
	}
	if len(filtered) > limit {
		filtered = filtered[:limit]
	}
	cacheSet(cacheKey, filtered)
	return filtered, nil
}

// ghGetReleaseByTag ports getReleaseByTag.
func ghGetReleaseByTag(ctx context.Context, repoInput, tagName string) (*ghRelease, error) {
	owner, repo, ok := parseGitHubRepo(repoInput)
	if !ok {
		return nil, fmt.Errorf("Invalid GitHub repository format. Use owner/repo or full GitHub URL.")
	}
	if tagName == "" {
		return nil, nil
	}
	cacheKey := fmt.Sprintf("github:%s/%s:%s", owner, repo, tagName)
	if cached, ok := cacheGet(cacheKey); ok {
		if rel, ok := cached.(*ghRelease); ok {
			return rel, nil
		}
		return nil, nil // negative cache entry (never hits in JS either: null is falsy)
	}

	status, body, err := githubGetWithRetry(ctx, fmt.Sprintf("%s/repos/%s/%s/releases/tags/%s", githubAPIBase, owner, repo, tagName))
	if err != nil {
		// handleReleaseByTagError: 404 -> null (unreachable here), 403 -> throw.
		if strings.Contains(err.Error(), "status 403") {
			return nil, fmt.Errorf("GitHub API rate limit or access restriction. Consider checking your GITHUB_TOKEN.")
		}
		return nil, nil
	}
	if status == 200 && len(body) > 0 {
		var rel ghRelease
		if err := json.Unmarshal(body, &rel); err == nil {
			cacheSet(cacheKey, &rel)
			return &rel, nil
		}
	}
	return nil, nil
}

// ghFindReleaseByTag ports findReleaseByTag: per-tag cache variants, all-releases
// match, direct lookup with v-prefix variants, negative cache.
func ghFindReleaseByTag(ctx context.Context, repoInput, tagName string) (*ghRelease, error) {
	if tagName == "" {
		return nil, nil
	}

	normalizedTarget := strings.ToLower(strings.TrimSpace(tagName))
	withV := normalizedTarget
	if !strings.HasPrefix(normalizedTarget, "v") {
		withV = "v" + normalizedTarget
	}
	withoutV := normalizedTarget
	if strings.HasPrefix(normalizedTarget, "v") {
		withoutV = normalizedTarget[1:]
	}

	owner, repo, ok := parseGitHubRepo(repoInput)
	if !ok {
		return nil, nil
	}

	for _, variant := range []string{normalizedTarget, withV, withoutV} {
		if cached, ok := cacheGet(fmt.Sprintf("github:%s/%s:%s", owner, repo, variant)); ok {
			// Typed-nil entries are negative hits (approved fix over Node's
			// dead `if (cached)` falsy check): short-circuit without HTTP.
			if rel, isRel := cached.(*ghRelease); isRel {
				return rel, nil
			}
		}
	}

	all, err := ghGetAllReleases(ctx, repoInput, 10)
	if err == nil {
		for _, r := range all {
			rTag := strings.ToLower(strings.TrimSpace(r.TagName))
			if rTag == normalizedTarget || rTag == withV || rTag == withoutV {
				cacheSet(fmt.Sprintf("github:%s/%s:%s", owner, repo, tagName), r)
				return r, nil
			}
		}
	}

	rel, err := ghGetReleaseByTag(ctx, repoInput, tagName)
	if err != nil {
		return nil, err
	}
	if rel != nil {
		return rel, nil
	}

	if !strings.HasPrefix(tagName, "v") {
		rel, err = ghGetReleaseByTag(ctx, repoInput, "v"+tagName)
	} else {
		rel, err = ghGetReleaseByTag(ctx, repoInput, tagName[1:])
	}
	if err != nil {
		return nil, err
	}
	if rel == nil {
		// Negative cache under every variant key so repeat lookups short-circuit.
		for _, variant := range []string{normalizedTarget, withV, withoutV} {
			cacheSet(fmt.Sprintf("github:%s/%s:%s", owner, repo, variant), (*ghRelease)(nil))
		}
	}
	return rel, nil
}

// checkGitHubTrackedApp ports checkGitHubTrackedApp.
func (s *Service) checkGitHubTrackedApp(ctx context.Context, app *db.TrackedAppRow) (*trackedCheckResult, error) {
	githubRepo := app.GithubRepo.String

	hasUpdate := false
	var latestVersion *string
	var latestRelease *ghRelease
	var currentVersionPublishDate *string

	rel, err := ghGetLatestRelease(ctx, githubRepo)
	if err != nil && strings.Contains(err.Error(), "rate limit") {
		return nil, err
	}
	// A failed upstream lookup is not an observation: has_update and a cleared
	// publish date must not overwrite an update an earlier successful check
	// confirmed. Same rule the docker path applies.
	observed := err == nil
	if err != nil {
		slog.Error("error checking GitHub repo", "repo", githubRepo, "error", err)
	} else {
		latestRelease = rel
		if latestRelease != nil && latestRelease.TagName != "" {
			latestVersion = &latestRelease.TagName

			if app.CurrentVersion.Valid && app.CurrentVersion.String != "" {
				nc := normalizeVersion(app.CurrentVersion.String)
				nl := normalizeVersion(*latestVersion)
				if nc != "" && nl != "" {
					hasUpdate = nc != nl
				} else {
					hasUpdate = false
				}

				versionsMatch := nc == nl
				if versionsMatch && latestRelease.PublishedAt != "" {
					currentVersionPublishDate = &latestRelease.PublishedAt
				} else if !versionsMatch {
					curRel, ferr := ghFindReleaseByTag(ctx, githubRepo, app.CurrentVersion.String)
					if ferr != nil {
						slog.Error("error fetching current version release",
							"repo", githubRepo, "version", app.CurrentVersion.String, "error", ferr)
					} else if curRel != nil && curRel.PublishedAt != "" {
						currentVersionPublishDate = &curRel.PublishedAt
					}
				}
			} else {
				hasUpdate = false
				if latestRelease.PublishedAt != "" {
					currentVersionPublishDate = &latestRelease.PublishedAt
				}
			}
		} else if latestRelease != nil {
			slog.Warn("GitHub release has no tag_name, skipping", "repo", githubRepo)
		}
	}

	updateData := map[string]any{
		"last_checked": time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
	}
	if observed {
		updateData["has_update"] = boolToInt(hasUpdate)
	}

	if latestVersion != nil && latestRelease != nil {
		if v := jsStoreableString(*latestVersion); v != "" {
			updateData["latest_version"] = v
		}
	} else if hasUpdate && app.LatestVersion.Valid && app.LatestVersion.String != "" {
		updateData["latest_version"] = app.LatestVersion.String
	}
	// GitHub path never clears latest_version.

	currentVersionToStore := app.CurrentVersion

	if (!currentVersionToStore.Valid || currentVersionToStore.String == "") &&
		latestVersion != nil && latestRelease != nil && latestRelease.PublishedAt != "" {
		currentVersionToStore = sql.NullString{String: *latestVersion, Valid: true}
		updateData["current_version"] = *latestVersion
		currentVersionPublishDate = &latestRelease.PublishedAt
	} else if currentVersionToStore.Valid && currentVersionToStore.String != "" &&
		latestVersion != nil && latestRelease != nil && latestRelease.PublishedAt != "" {
		if normalizeVersion(currentVersionToStore.String) == normalizeVersion(*latestVersion) {
			currentVersionPublishDate = &latestRelease.PublishedAt
		}
	}

	if currentVersionPublishDate != nil && *currentVersionPublishDate != "" {
		updateData["current_version_publish_date"] = *currentVersionPublishDate
	}

	if latestRelease != nil && latestRelease.PublishedAt != "" && latestVersion != nil {
		nc := normalizeVersion(jsString(currentVersionToStore))
		nl := normalizeVersion(*latestVersion)
		if nc != nl {
			updateData["latest_version_publish_date"] = latestRelease.PublishedAt
		} else {
			updateData["latest_version_publish_date"] = nil
		}
	} else if hasUpdate && app.LatestVersionPublishDate.Valid && app.LatestVersionPublishDate.String != "" {
		updateData["latest_version_publish_date"] = app.LatestVersionPublishDate.String
	} else if observed && !hasUpdate {
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
		// rejected or nothing was observed), so it must not be reported either:
		// report what the row actually holds.
		hasUpdate, currentVersionToStore, latestVersion, currentVersionPublishDate = observedStateFromRow(app)
	}

	displayCurrentVersion := jsString(currentVersionToStore)
	if displayCurrentVersion == "" {
		displayCurrentVersion = jsString(app.CurrentVersion)
	}
	if displayCurrentVersion == "" {
		displayCurrentVersion = "Not checked"
	}
	displayLatestVersion := ""
	if latestVersion != nil {
		displayLatestVersion = *latestVersion
	}
	if displayLatestVersion == "" {
		displayLatestVersion = jsString(app.LatestVersion)
	}
	if displayLatestVersion == "" {
		displayLatestVersion = "Unknown"
	}

	newly := newlyDetectedVersion(hasUpdate, app, latestVersion)
	if newly {
		slog.Info("new tracked app update detected",
			"trackedAppId", app.ID, "name", app.Name, "githubRepo", githubRepo,
			"currentVersion", displayCurrentVersion, "latestVersion", displayLatestVersion)
		var pubDate, releaseURL *string
		if latestRelease != nil {
			if latestRelease.PublishedAt != "" {
				pubDate = &latestRelease.PublishedAt
			}
			if latestRelease.HTMLURL != "" {
				releaseURL = &latestRelease.HTMLURL
			}
		}
		s.notifier.queueTrackedNotification(ctx, trackedNotification{
			Name:                     app.Name,
			GithubRepo:               githubRepo,
			SourceType:               "github",
			CurrentVersion:           displayCurrentVersion,
			LatestVersion:            displayLatestVersion,
			LatestVersionPublishDate: pubDate,
			ReleaseURL:               releaseURL,
		}, app.UserID)
	}

	result := &trackedCheckResult{
		ID:                        app.ID,
		Name:                      app.Name,
		GithubRepo:                &githubRepo,
		SourceType:                "github",
		CurrentVersion:            displayCurrentVersion,
		LatestVersion:             displayLatestVersion,
		HasUpdate:                 hasUpdate,
		CurrentVersionPublishDate: currentVersionPublishDate,
	}
	if latestRelease != nil {
		if latestRelease.PublishedAt != "" {
			result.LatestPublishDate = &latestRelease.PublishedAt
		}
		if latestRelease.HTMLURL != "" {
			result.ReleaseURL = &latestRelease.HTMLURL
		}
	}
	return result, nil
}
