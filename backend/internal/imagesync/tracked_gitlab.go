package imagesync

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/dockedapp/backend/internal/db"
	"github.com/dockedapp/backend/internal/registry"
)

// glRelease is the GitHub-like mapped shape Node's gitlabService produces.
type glRelease struct {
	TagName     string `json:"tag_name"`
	Name        string `json:"name"`
	PublishedAt string `json:"published_at"`
	HTMLURL     string `json:"html_url"`
}

type glRawRelease struct {
	TagName    string `json:"tag_name"`
	Name       string `json:"name"`
	ReleasedAt string `json:"released_at"`
	Links      struct {
		Self string `json:"self"`
	} `json:"_links"`
	Description string `json:"description"`
}

// gitlabComBase is the default GitLab host for owner/repo inputs; tests
// point it at an httptest server.
var gitlabComBase = "https://gitlab.com"

// parseGitLabRepo ports parseGitLabRepo (https URL / git@ SSH / owner/repo).
func parseGitLabRepo(repoInput string) (owner, repo, baseURL string, ok bool) {
	trimmed := strings.TrimSpace(repoInput)
	if trimmed == "" {
		return "", "", "", false
	}

	switch {
	case strings.HasPrefix(trimmed, "https://"):
		rest := strings.TrimPrefix(trimmed, "https://")
		idx := strings.Index(rest, "/")
		if idx <= 0 || idx == len(rest)-1 {
			return "", "", "", false
		}
		host := rest[:idx]
		base := "https://" + host
		path := strings.TrimSuffix(strings.TrimSuffix(rest[idx+1:], "/"), ".git")
		parts := nonEmptySplit(path, "/")
		if len(parts) >= 2 {
			owner, repo, baseURL = parts[0], strings.Join(parts[1:], "/"), base
		}
	case strings.HasPrefix(trimmed, "git@"):
		rest := strings.TrimPrefix(trimmed, "git@")
		idx := strings.Index(rest, ":")
		if idx <= 0 || idx == len(rest)-1 {
			return "", "", "", false
		}
		host := rest[:idx]
		base := "https://" + host
		path := strings.TrimSuffix(rest[idx+1:], ".git")
		parts := nonEmptySplit(path, "/")
		if len(parts) >= 2 {
			owner, repo, baseURL = parts[0], strings.Join(parts[1:], "/"), base
		}
	case strings.Contains(trimmed, "/"):
		parts := nonEmptySplit(trimmed, "/")
		if len(parts) >= 2 {
			owner = parts[0]
			repo = strings.TrimSuffix(strings.Join(parts[1:], "/"), ".git")
			baseURL = gitlabComBase
		}
	}

	if owner != "" && repo != "" && baseURL != "" {
		return strings.TrimSpace(owner), strings.TrimSpace(repo), strings.TrimSpace(baseURL), true
	}
	return "", "", "", false
}

func nonEmptySplit(s, sep string) []string {
	var out []string
	for _, p := range strings.Split(s, sep) {
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// isGitLabDotCom reports whether reqURL targets gitlab.com (or a gitlab.com
// subdomain) rather than a user-configured self-hosted GitLab host.
func isGitLabDotCom(reqURL string) bool {
	u, err := url.Parse(reqURL)
	if err != nil {
		return false
	}
	host := strings.ToLower(u.Hostname())
	return host == "gitlab.com" || strings.HasSuffix(host, ".gitlab.com")
}

// gitlabGet ports the axios GET with validateStatus<500: transport/5xx -> error.
func gitlabGet(ctx context.Context, reqURL, token string) (int, []byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Docked/1.0")
	glToken := token
	if glToken == "" && isGitLabDotCom(reqURL) {
		// The global GITLAB_TOKEN is only ever sent to gitlab.com itself.
		// Tracked apps may point at user-configured self-hosted GitLab
		// hosts; leaking the operator's global credential there would hand
		// it to any host that merely answers a GET. Per-app repository
		// tokens (the `token` argument) still work on any host.
		glToken = os.Getenv("GITLAB_TOKEN")
	}
	if glToken != "" {
		req.Header.Set("Authorization", "Bearer "+glToken)
	}
	client := trackedHTTPClient
	resp, err := client.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode >= 500 {
		return resp.StatusCode, body, fmt.Errorf("gitlab api error: status %d", resp.StatusCode)
	}
	return resp.StatusCode, body, nil
}

// handleGitLabError ports handleGitLabError.
func handleGitLabError(err error, status int, body []byte, owner, repo string) error {
	if status == 404 {
		return fmt.Errorf("Repository %s/%s not found or has no releases", owner, repo)
	}
	if status == 403 || status == 401 {
		msg := "Access denied"
		var payload struct {
			Message string `json:"message"`
		}
		if json.Unmarshal(body, &payload) == nil && payload.Message != "" {
			msg = payload.Message
		}
		return fmt.Errorf("GitLab API access denied (%d): %s. Consider setting GITLAB_TOKEN environment variable for private repos.", status, msg)
	}
	if status == 429 {
		return fmt.Errorf("GitLab API rate limit exceeded. Consider setting GITLAB_TOKEN environment variable.")
	}
	return fmt.Errorf("Failed to fetch GitLab releases: %v", err)
}

// tokenFingerprint scopes release caches by the credential used (shared
// implementation with the registry digest caches).
var tokenFingerprint = registry.TokenFingerprint

// mapGitLabRelease ports mapGitLabRelease.
func mapGitLabRelease(latest *glRawRelease, baseURL, owner, repo string) *glRelease {
	name := latest.Name
	if name == "" {
		name = latest.TagName
	}
	htmlURL := latest.Links.Self
	if htmlURL == "" {
		htmlURL = fmt.Sprintf("%s/%s/%s/-/releases/%s", baseURL, owner, repo, latest.TagName)
	}
	return &glRelease{
		TagName:     latest.TagName,
		Name:        name,
		PublishedAt: latest.ReleasedAt,
		HTMLURL:     htmlURL,
	}
}

// glGetLatestRelease ports gitlabService.getLatestRelease.
func glGetLatestRelease(ctx context.Context, repoInput, token string) (*glRelease, error) {
	owner, repo, baseURL, ok := parseGitLabRepo(repoInput)
	if !ok {
		return nil, fmt.Errorf("Invalid GitLab repository format. Use owner/repo or full GitLab URL.")
	}
	cacheKey := fmt.Sprintf("gitlab:%s:%s/%s:%s", baseURL, owner, repo, tokenFingerprint(token))

	if cached, ok := cacheGet(cacheKey); ok {
		if list, ok := cached.([]*glRelease); ok && len(list) > 0 {
			return list[0], nil
		}
	}

	encoded := url.QueryEscape(owner + "/" + repo)
	reqURL := fmt.Sprintf("%s/api/v4/projects/%s/releases?per_page=10&order_by=released_at&sort=desc", baseURL, encoded)

	status, body, err := gitlabGet(ctx, reqURL, token)
	if err != nil {
		return nil, handleGitLabError(err, status, body, owner, repo)
	}
	if status != 200 {
		slog.Warn("gitlab non-200 response", "repo", repoInput, "status", status)
		return nil, nil
	}
	var raw []glRawRelease
	if err := json.Unmarshal(body, &raw); err != nil || len(raw) == 0 {
		slog.Warn("no gitlab releases found", "repo", repoInput)
		return nil, nil
	}
	mapped := mapGitLabRelease(&raw[0], baseURL, owner, repo)
	cacheSet(cacheKey, []*glRelease{mapped})
	return mapped, nil
}

// glGetReleaseByTag ports gitlabService.getReleaseByTag.
func glGetReleaseByTag(ctx context.Context, repoInput, tagName, token string) (*glRelease, error) {
	owner, repo, baseURL, ok := parseGitLabRepo(repoInput)
	if !ok {
		return nil, fmt.Errorf("Invalid GitLab repository format. Use owner/repo or full GitLab URL.")
	}
	if tagName == "" {
		return nil, nil
	}
	cacheKey := fmt.Sprintf("gitlab:%s:%s/%s:%s:%s", baseURL, owner, repo, tagName, tokenFingerprint(token))
	if cached, ok := cacheGet(cacheKey); ok {
		if rel, ok := cached.(*glRelease); ok {
			return rel, nil
		}
		return nil, nil
	}

	encoded := url.QueryEscape(owner + "/" + repo)
	reqURL := fmt.Sprintf("%s/api/v4/projects/%s/releases/%s", baseURL, encoded, url.QueryEscape(tagName))

	status, body, err := gitlabGet(ctx, reqURL, token)
	if err != nil {
		// handleReleaseByTagError: 404 -> null (unreachable with this port),
		// 401/403 -> access denied throw, 429 -> rate limit throw, else null.
		if status == 401 || status == 403 {
			return nil, fmt.Errorf("GitLab API access denied. Consider setting GITLAB_TOKEN environment variable.")
		}
		if status == 429 {
			return nil, fmt.Errorf("GitLab API rate limit exceeded. Consider setting GITLAB_TOKEN environment variable.")
		}
		return nil, nil
	}
	if status == 200 && len(body) > 0 {
		var raw glRawRelease
		if err := json.Unmarshal(body, &raw); err == nil {
			mapped := mapGitLabRelease(&raw, baseURL, owner, repo)
			cacheSet(cacheKey, mapped)
			return mapped, nil
		}
	}
	return nil, nil
}

// checkGitLabTrackedApp ports checkGitLabTrackedApp.
func (s *Service) checkGitLabTrackedApp(ctx context.Context, app *db.TrackedAppRow) (*trackedCheckResult, error) {
	gitlabRepo := app.GithubRepo.String

	// Token: repository_access_tokens row wins; fall back to legacy column.
	gitlabToken := ""
	if app.RepositoryTokenID.Valid {
		tok, err := db.GetRepositoryTokenByID(ctx, s.DB, app.UserID, app.RepositoryTokenID.Int64)
		if err == nil && tok != nil && tok.Provider == "gitlab" {
			gitlabToken = tok.AccessToken
		}
	} else if app.GitlabToken.Valid {
		gitlabToken = app.GitlabToken.String
	}

	hasUpdate := false
	var latestVersion *string
	var latestRelease *glRelease
	var currentVersionPublishDate *string

	rel, err := glGetLatestRelease(ctx, gitlabRepo, gitlabToken)
	if err != nil && strings.Contains(err.Error(), "rate limit") {
		return nil, err
	}
	if err != nil {
		slog.Error("error checking GitLab repo", "repo", gitlabRepo, "error", err)
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
					curRel, ferr := glGetReleaseByTag(ctx, gitlabRepo, app.CurrentVersion.String, gitlabToken)
					if ferr == nil && curRel != nil && curRel.PublishedAt != "" {
						currentVersionPublishDate = &curRel.PublishedAt
					}
					if ferr == nil && curRel == nil {
						currentTag := app.CurrentVersion.String
						var variant string
						if !strings.HasPrefix(currentTag, "v") {
							variant = "v" + currentTag
						} else {
							variant = currentTag[1:]
						}
						curRel2, ferr2 := glGetReleaseByTag(ctx, gitlabRepo, variant, gitlabToken)
						if ferr2 == nil && curRel2 != nil && curRel2.PublishedAt != "" {
							currentVersionPublishDate = &curRel2.PublishedAt
						}
					}
					if ferr != nil {
						slog.Error("error fetching current version release", "repo", gitlabRepo, "error", ferr)
					}
				}
			} else {
				hasUpdate = false
				if latestRelease.PublishedAt != "" {
					currentVersionPublishDate = &latestRelease.PublishedAt
				}
			}
		} else if latestRelease != nil {
			slog.Warn("GitLab release has no tag_name, skipping", "repo", gitlabRepo)
		} else {
			slog.Warn("no GitLab release found", "repo", gitlabRepo)
		}
	}

	updateData := map[string]any{
		"has_update":   boolToInt(hasUpdate),
		"last_checked": time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
	}

	if latestVersion != nil && latestRelease != nil {
		if v := jsStoreableString(*latestVersion); v != "" {
			updateData["latest_version"] = v
		}
	} else if hasUpdate && app.LatestVersion.Valid && app.LatestVersion.String != "" {
		updateData["latest_version"] = app.LatestVersion.String
	} else if !hasUpdate && latestVersion == nil {
		updateData["latest_version"] = nil
	}

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
	} else {
		if !hasUpdate {
			updateData["latest_version_publish_date"] = nil
		}
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
			"trackedAppId", app.ID, "name", app.Name, "gitlabRepo", gitlabRepo,
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
			GithubRepo:               gitlabRepo,
			SourceType:               "gitlab",
			CurrentVersion:           displayCurrentVersion,
			LatestVersion:            displayLatestVersion,
			LatestVersionPublishDate: pubDate,
			ReleaseURL:               releaseURL,
		}, app.UserID)
	}

	result := &trackedCheckResult{
		ID:                        app.ID,
		Name:                      app.Name,
		GithubRepo:                &gitlabRepo,
		SourceType:                "gitlab",
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
