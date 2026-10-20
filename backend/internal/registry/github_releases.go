package registry

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/go-containerregistry/pkg/authn"
	"github.com/google/go-containerregistry/pkg/v1/remote"
)

// --- GCR ---

// GCRProvider ports providers/GCRProvider.js: anonymous fetch first, then a
// Docker Hub fallback for images mirrored there (provider stays "gcr").
type GCRProvider struct {
	cache     *DigestCache
	dockerHub *DockerHubProvider
}

func NewGCRProvider(cache *DigestCache, dockerHub *DockerHubProvider) *GCRProvider {
	return &GCRProvider{cache: cache, dockerHub: dockerHub}
}

func (p *GCRProvider) Name() string { return "gcr" }

func (p *GCRProvider) CanHandle(imageRepo string) bool {
	return strings.HasPrefix(imageRepo, "gcr.io/")
}

func (p *GCRProvider) normalizeRepo(imageRepo string) string {
	return strings.TrimPrefix(imageRepo, "gcr.io/")
}

func (p *GCRProvider) GetLatestDigest(ctx context.Context, imageRepo, tag string, opts Options) (*DigestResult, error) {
	normalized := p.normalizeRepo(imageRepo)
	cacheKey := "gcr:" + normalized + ":" + tag

	if cached, ok := p.cache.Get(cacheKey); ok {
		return cached, nil
	}
	if tag != "" && strings.Contains(tag, "@sha256") {
		return nil, nil
	}

	rateLimitDelay(time.Second)

	digest, err := retryFetch(ctx, func() (*string, error) {
		return fetchIndexDigest(ctx, "gcr.io/"+normalized+":"+tag, remote.WithAuth(authn.Anonymous))
	})
	if err != nil {
		slog.Debug("gcr digest fetch failed, trying docker hub fallback",
			"repo", imageRepo, "tag", tag, "error", err)
	}

	if digest != nil {
		result := &DigestResult{Digest: digest, Tag: tag, Provider: "gcr"}
		p.cache.Set(cacheKey, result)
		return result, nil
	}

	// Docker Hub fallback: mirrored images keep provider "gcr" but flag fallback.
	hubResult, hubErr := p.dockerHub.GetLatestDigest(ctx, normalized, tag, opts)
	if hubErr == nil && hubResult != nil && hubResult.Digest != nil {
		result := &DigestResult{Digest: hubResult.Digest, Tag: tag, Provider: "gcr", IsFallback: true}
		p.cache.Set(cacheKey, result)
		return result, nil
	}

	// GCR never returns nil: a null-digest result keeps the provider label.
	return &DigestResult{Tag: tag, Provider: "gcr"}, nil
}

func (p *GCRProvider) GetTagPublishDate(_ context.Context, _, _ string, _ Options) (*string, error) {
	// GCR does not expose tag publish dates via the registry API.
	return nil, nil
}

// --- GitHub Releases ---

// GitHubReleasesProvider ports providers/GitHubReleasesProvider.js: version
// comparison via the GitHub Releases API, with a GHCR digest probe for the
// release tag when the image lives on GHCR.
type GitHubReleasesProvider struct{}

func NewGitHubReleasesProvider() *GitHubReleasesProvider {
	return &GitHubReleasesProvider{}
}

func (p *GitHubReleasesProvider) Name() string { return "github-releases" }

// CanHandle only matches with an explicit repo mapping, matching Node's
// canHandle(imageRepo, { githubRepo }).
func (p *GitHubReleasesProvider) CanHandle(_ string) bool { return false }

// CanHandleWith is the options-aware variant used by the manager fallback.
func (p *GitHubReleasesProvider) CanHandleWith(opts Options) bool {
	return opts.GithubRepo != ""
}

// ExtractGitHubRepo ports _extractGitHubRepo: ghcr.io images map directly to
// the same owner/repo on GitHub.
func ExtractGitHubRepo(imageRepo string) string {
	if strings.HasPrefix(imageRepo, "ghcr.io/") {
		repo := strings.TrimPrefix(imageRepo, "ghcr.io/")
		if strings.Contains(repo, "/") {
			return repo
		}
	}
	return ""
}

type githubRelease struct {
	TagName     string  `json:"tag_name"`
	PublishedAt *string `json:"published_at"`
	HTMLURL     string  `json:"html_url"`
}

// getRelease performs the GitHub API GET with the optional GITHUB_TOKEN,
// matching githubService's auth and error semantics.
func (p *GitHubReleasesProvider) getRelease(ctx context.Context, url string) (*githubRelease, error) {
	reqCtx, cancel := context.WithTimeout(ctx, fetchTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "docked")
	if token := os.Getenv("GITHUB_TOKEN"); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusTooManyRequests {
		return nil, fmt.Errorf("GitHub API rate limit or access restriction: %d", resp.StatusCode)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, &HTTPStatusError{StatusCode: resp.StatusCode, StatusText: http.StatusText(resp.StatusCode)}
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, err
	}
	var release githubRelease
	if err := json.Unmarshal(body, &release); err != nil {
		return nil, err
	}
	return &release, nil
}

func (p *GitHubReleasesProvider) GetLatestDigest(ctx context.Context, imageRepo, _ string, opts Options) (*DigestResult, error) {
	githubRepo := opts.GithubRepo
	if githubRepo == "" {
		githubRepo = ExtractGitHubRepo(imageRepo)
	}
	if githubRepo == "" {
		return nil, nil
	}

	release, err := p.getRelease(ctx, "https://api.github.com/repos/"+githubRepo+"/releases/latest")
	if err != nil {
		if IsRateLimitError(err) {
			return nil, err
		}
		slog.Debug("github releases fetch failed", "repo", githubRepo, "error", err)
		return nil, nil
	}
	if release.TagName == "" {
		return nil, nil
	}

	// For GHCR images, probe the release tag directly for a real digest.
	if strings.HasPrefix(imageRepo, "ghcr.io/") {
		digest, derr := fetchIndexDigest(ctx, imageRepo+":"+release.TagName, remote.WithAuthFromKeychain(authn.DefaultKeychain))
		if derr == nil && digest != nil {
			return &DigestResult{
				Digest:      digest,
				Tag:         release.TagName,
				Version:     &release.TagName,
				PublishDate: release.PublishedAt,
				Provider:    "ghcr",
			}, nil
		}
	}

	version := release.TagName
	return &DigestResult{
		Tag:         release.TagName,
		Version:     &version,
		PublishDate: release.PublishedAt,
		IsFallback:  true,
	}, nil
}

func (p *GitHubReleasesProvider) GetTagPublishDate(ctx context.Context, imageRepo, tag string, opts Options) (*string, error) {
	githubRepo := opts.GithubRepo
	if githubRepo == "" {
		githubRepo = ExtractGitHubRepo(imageRepo)
	}
	if githubRepo == "" || tag == "" {
		return nil, nil
	}
	release, err := p.getRelease(ctx, "https://api.github.com/repos/"+githubRepo+"/releases/tags/"+tag)
	if err != nil {
		if IsRateLimitError(err) {
			return nil, err
		}
		return nil, nil
	}
	return release.PublishedAt, nil
}

var versionNormalizeRe = regexp.MustCompile(`[^a-z0-9.]+`)

func normalizeVersion(v string) string {
	v = strings.ToLower(strings.TrimSpace(v))
	v = strings.TrimPrefix(v, "v")
	return versionNormalizeRe.ReplaceAllString(v, "")
}

// HasUpdate ports _compareVersions + hasUpdate: semver-ish numeric compare
// when both sides look like versions, otherwise a plain string compare.
func (p *GitHubReleasesProvider) HasUpdate(currentTag, latestTag string) bool {
	if currentTag == "" || latestTag == "" {
		return false
	}
	return p.compareVersions(currentTag, latestTag) < 0
}

func (p *GitHubReleasesProvider) compareVersions(v1, v2 string) int {
	n1 := normalizeVersion(v1)
	n2 := normalizeVersion(v2)

	numeric := regexp.MustCompile(`^\d+\.\d+`)
	if numeric.MatchString(n1) && numeric.MatchString(n2) {
		parts1 := strings.Split(n1, ".")
		parts2 := strings.Split(n2, ".")
		max := len(parts1)
		if len(parts2) > max {
			max = len(parts2)
		}
		for i := 0; i < max; i++ {
			var a, b int
			if i < len(parts1) {
				a, _ = strconv.Atoi(parts1[i])
			}
			if i < len(parts2) {
				b, _ = strconv.Atoi(parts2[i])
			}
			if a < b {
				return -1
			}
			if a > b {
				return 1
			}
		}
		return 0
	}

	if n1 < n2 {
		return -1
	}
	if n1 > n2 {
		return 1
	}
	return 0
}

// ensure interface satisfaction for the primary providers list.
var (
	_ Provider = (*DockerHubProvider)(nil)
	_ Provider = (*GHCRProvider)(nil)
	_ Provider = (*GitLabProvider)(nil)
	_ Provider = (*GCRProvider)(nil)
)
