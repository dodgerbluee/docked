package runner

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"sync"
	"time"
)

// GitHub latest-release lookups for the runner surface (dockhand installer
// version, heartbeat latest_version, operations/apps version enrichment).
// Mirrors Node's githubService.getLatestRelease: 1-hour cache, optional
// GITHUB_TOKEN, skipCache for install-time freshness.

// GitHubAPIBase is the API root used for release lookups. Exported as a var
// so tests can point it at a stub server.
var GitHubAPIBase = "https://api.github.com"

const releaseFetchTimeout = 10 * time.Second

type cachedRelease struct {
	tag     string
	fetched time.Time
}

var (
	releaseCacheMu sync.Mutex
	releaseCache   = map[string]cachedRelease{}
	releaseTTL     = time.Hour
)

// LatestReleaseTag returns the latest release tag_name for a GitHub repo
// ("owner/name"). ok=false means the lookup failed (the caller decides the
// fallback, matching Node's try/catch → "latest" / null semantics).
func LatestReleaseTag(ctx context.Context, repo string, skipCache bool) (string, bool) {
	if repo == "" {
		return "", false
	}
	if !skipCache {
		releaseCacheMu.Lock()
		entry, hit := releaseCache[repo]
		releaseCacheMu.Unlock()
		if hit && time.Since(entry.fetched) < releaseTTL {
			return entry.tag, true
		}
	}

	reqCtx, cancel := context.WithTimeout(ctx, releaseFetchTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet,
		GitHubAPIBase+"/repos/"+repo+"/releases/latest", nil)
	if err != nil {
		return "", false
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "docked")
	if token := os.Getenv("GITHUB_TOKEN"); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", false
	}

	var payload struct {
		TagName string `json:"tag_name"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&payload); err != nil {
		return "", false
	}
	if payload.TagName == "" {
		return "", false
	}

	releaseCacheMu.Lock()
	releaseCache[repo] = cachedRelease{tag: payload.TagName, fetched: time.Now()}
	releaseCacheMu.Unlock()
	return payload.TagName, true
}

// DockhandRepo is the GitHub repo the dockhand runner agent releases live in.
const DockhandRepo = "dockedapp/dockhand"

// LatestDockhandVersion returns the bare version (leading "v" stripped) used
// by install scripts and docker run snippets, or "latest" on lookup failure —
// exactly Node's createEnrollment/serveInstallScript fallback.
func LatestDockhandVersion(ctx context.Context, skipCache bool) string {
	if tag, ok := LatestReleaseTag(ctx, DockhandRepo, skipCache); ok {
		if len(tag) > 0 && tag[0] == 'v' {
			tag = tag[1:]
		}
		return tag
	}
	return "latest"
}
