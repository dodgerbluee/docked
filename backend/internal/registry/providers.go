package registry

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/go-containerregistry/pkg/authn"
	"github.com/google/go-containerregistry/pkg/v1/remote"
)

// TokenFingerprint scopes credential-dependent caches by the credential used:
// a private repo's cached metadata must not be served to a later
// credentialless check (or another user's token) for the cache TTL.
func TokenFingerprint(token string) string {
	if token == "" {
		return "anon"
	}
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:6])
}

// DockerHubProvider ports providers/DockerHubProvider.js. Digests come from
// the registry protocol via go-containerregistry (what the crane binary wraps),
// replacing the old crane/skopeo shell-out.
type DockerHubProvider struct {
	cache *DigestCache
}

func NewDockerHubProvider(cache *DigestCache) *DockerHubProvider {
	return &DockerHubProvider{cache: cache}
}

func (p *DockerHubProvider) Name() string { return "dockerhub" }

func (p *DockerHubProvider) CanHandle(imageRepo string) bool {
	if strings.HasPrefix(imageRepo, "docker.io/") ||
		strings.HasPrefix(imageRepo, "registry-1.docker.io/") ||
		strings.HasPrefix(imageRepo, "registry.docker.io/") {
		return true
	}
	// Slash with no dot and no ghcr prefix: assume docker.io.
	if strings.Contains(imageRepo, "/") && !strings.Contains(imageRepo, ".") &&
		!strings.HasPrefix(imageRepo, "ghcr.io/") {
		return true
	}
	// lscr.io images are mirrored on docker.io under the same path.
	return strings.HasPrefix(imageRepo, "lscr.io/")
}

func (p *DockerHubProvider) normalizeRepo(imageRepo string) string {
	repo := imageRepo
	for _, prefix := range []string{"docker.io/", "registry-1.docker.io/", "registry.docker.io/"} {
		repo = strings.TrimPrefix(repo, prefix)
	}
	if strings.HasPrefix(imageRepo, "lscr.io/") {
		repo = strings.TrimPrefix(imageRepo, "lscr.io/")
	}
	return repo
}

func (p *DockerHubProvider) GetLatestDigest(ctx context.Context, imageRepo, tag string, _ Options) (*DigestResult, error) {
	normalized := p.normalizeRepo(imageRepo)
	cacheKey := normalized + ":" + tag

	if cached, ok := p.cache.Get(cacheKey); ok {
		return cached, nil
	}

	// _cleanTagAndCheckCache: strip an incomplete "@sha256" marker and alias cache.
	cleanedTag := tag
	if tag != "" && strings.Contains(tag, "@sha256") && !strings.Contains(tag, "@sha256:") {
		cleanedTag = strings.Replace(tag, "@sha256", "", 1)
		if cached, ok := p.cache.Get(normalized + ":" + cleanedTag); ok {
			p.cache.Set(cacheKey, cached)
			return cached, nil
		}
	}
	if cleanedTag != "" && strings.Contains(cleanedTag, "@sha256:") {
		// Tag is a complete digest reference; nothing to look up.
		return nil, nil
	}

	digest, err := fetchIndexDigest(ctx, normalized+":"+cleanedTag, remote.WithAuthFromKeychain(authn.DefaultKeychain))
	if err != nil {
		if IsRateLimitError(err) {
			return nil, err
		}
		var hsErr *HTTPStatusError
		if errors.As(err, &hsErr) && hsErr.StatusCode == http.StatusNotFound {
			slog.Debug("image not found in registry", "repo", imageRepo, "tag", cleanedTag)
		} else {
			slog.Error("error fetching dockerhub digest", "repo", imageRepo, "tag", cleanedTag, "error", err)
		}
		return nil, nil
	}

	result := &DigestResult{Digest: digest, Tag: cleanedTag, Provider: "dockerhub"}
	p.cache.Set(cacheKey, result)
	if cleanedTag != tag {
		p.cache.Set(normalized+":"+cleanedTag, result)
	}
	return result, nil
}

func (p *DockerHubProvider) GetTagPublishDate(_ context.Context, _, _ string, _ Options) (*string, error) {
	// Publish dates require the Docker Hub REST API, which the Node provider
	// also no longer uses; the GitHub Releases fallback covers dates instead.
	return nil, nil
}

func (p *DockerHubProvider) ClearCache(imageRepo, tag string) {
	p.cache.Delete(p.normalizeRepo(imageRepo) + ":" + tag)
}

// --- GHCR ---

// GHCRProvider ports providers/GHCRProvider.js. Public images need no auth;
// failures fall back to GitHub Releases (repo inferred from the image name).
type GHCRProvider struct {
	cache    *DigestCache
	fallback *GitHubReleasesProvider
}

func NewGHCRProvider(cache *DigestCache, fallback *GitHubReleasesProvider) *GHCRProvider {
	return &GHCRProvider{cache: cache, fallback: fallback}
}

func (p *GHCRProvider) Name() string { return "ghcr" }

func (p *GHCRProvider) CanHandle(imageRepo string) bool {
	return strings.HasPrefix(imageRepo, "ghcr.io/")
}

func (p *GHCRProvider) normalizeRepo(imageRepo string) string {
	return strings.TrimPrefix(imageRepo, "ghcr.io/")
}

func (p *GHCRProvider) GetLatestDigest(ctx context.Context, imageRepo, tag string, opts Options) (*DigestResult, error) {
	normalized := p.normalizeRepo(imageRepo)
	cacheKey := "ghcr:" + normalized + ":" + tag

	if cached, ok := p.cache.Get(cacheKey); ok {
		return cached, nil
	}
	if tag != "" && strings.Contains(tag, "@sha256") {
		return nil, nil
	}

	// crane/skopeo equivalent: anonymous/default-keychain fetch of the full ref.
	digest, err := fetchIndexDigest(ctx, imageRepo+":"+tag, remote.WithAuthFromKeychain(authn.DefaultKeychain))
	if err != nil {
		slog.Debug("ghcr digest fetch failed, trying github releases fallback",
			"repo", imageRepo, "tag", tag, "error", err)
	}
	if digest != nil {
		result := &DigestResult{Digest: digest, Tag: tag}
		p.cache.Set(cacheKey, result)
		return result, nil
	}

	// GitHub Releases fallback with repo inferred from the image name.
	githubRepo := opts.GithubRepo
	if githubRepo == "" && strings.Contains(normalized, "/") {
		githubRepo = normalized
	}
	if githubRepo == "" {
		return nil, nil
	}
	fallbackOpts := opts
	fallbackOpts.GithubRepo = githubRepo
	return p.fallback.GetLatestDigest(ctx, imageRepo, tag, fallbackOpts)
}

func (p *GHCRProvider) GetTagPublishDate(ctx context.Context, imageRepo, tag string, opts Options) (*string, error) {
	githubRepo := opts.GithubRepo
	if githubRepo == "" {
		normalized := p.normalizeRepo(imageRepo)
		if strings.Contains(normalized, "/") {
			githubRepo = normalized
		}
	}
	if githubRepo == "" {
		return nil, nil
	}
	fallbackOpts := opts
	fallbackOpts.GithubRepo = githubRepo
	return p.fallback.GetTagPublishDate(ctx, imageRepo, tag, fallbackOpts)
}

// --- GitLab ---

// GitLabProvider ports providers/GitLabProvider.js: anonymous access for
// public images, deploy/CI tokens resolved from repository_token_id links.
type GitLabProvider struct {
	cache *DigestCache
	db    *sql.DB
}

func NewGitLabProvider(cache *DigestCache, database *sql.DB) *GitLabProvider {
	return &GitLabProvider{cache: cache, db: database}
}

func (p *GitLabProvider) Name() string { return "gitlab" }

func (p *GitLabProvider) CanHandle(imageRepo string) bool {
	return strings.HasPrefix(imageRepo, "registry.gitlab.com/")
}

func (p *GitLabProvider) normalizeRepo(imageRepo string) string {
	return strings.TrimPrefix(imageRepo, "registry.gitlab.com/")
}

// lookupDeployToken mirrors getCredentials: find the repository access token
// linked to any deployed_images row for this repo.
func (p *GitLabProvider) lookupDeployToken(ctx context.Context, userID int64, imageRepo string) string {
	if p.db == nil || userID == 0 || imageRepo == "" {
		return ""
	}
	var tokenID int64
	err := p.db.QueryRowContext(ctx,
		`SELECT DISTINCT repository_token_id
		 FROM deployed_images
		 WHERE user_id = ? AND image_repo = ? AND repository_token_id IS NOT NULL
		 LIMIT 1`, userID, imageRepo).Scan(&tokenID)
	if err != nil {
		return ""
	}
	var accessToken string
	err = p.db.QueryRowContext(ctx,
		"SELECT access_token FROM repository_access_tokens WHERE id = ?", tokenID).Scan(&accessToken)
	if err != nil {
		return ""
	}
	return accessToken
}

func (p *GitLabProvider) GetLatestDigest(ctx context.Context, imageRepo, tag string, opts Options) (*DigestResult, error) {
	normalized := p.normalizeRepo(imageRepo)
	// The deploy token is per-user/per-repo: a private image's digest fetched
	// with one user's token must NOT be served from cache to another user who
	// has no access (cross-credential leak + wrong-authorization results).
	// Scope the cache key by credential, same as the tracked-app release caches.
	token := p.lookupDeployToken(ctx, opts.UserID, imageRepo)
	cacheKey := "gitlab:" + normalized + ":" + tag + ":" + TokenFingerprint(token)

	if cached, ok := p.cache.Get(cacheKey); ok {
		return cached, nil
	}
	if tag != "" && strings.Contains(tag, "@sha256") {
		return nil, nil
	}

	delay := time.Second
	if token != "" {
		delay = 500 * time.Millisecond
	}
	rateLimitDelay(delay)

	if !strings.Contains(normalized, "/") {
		slog.Warn("invalid gitlab repo format", "repo", normalized)
		return nil, nil
	}

	authOpt := remote.WithAuth(authn.Anonymous)
	if token != "" {
		authOpt = remote.WithAuth(authn.FromConfig(authn.AuthConfig{Username: "gitlab-ci-token", Password: token}))
	}

	digest, err := retryFetch(ctx, func() (*string, error) {
		return fetchIndexDigest(ctx, "registry.gitlab.com/"+normalized+":"+tag, authOpt)
	})
	if err != nil {
		if IsRateLimitError(err) {
			return nil, err
		}
		var hsErr *HTTPStatusError
		if errors.As(err, &hsErr) && hsErr.StatusCode == http.StatusNotFound {
			slog.Debug("gitlab image not found", "repo", imageRepo, "tag", tag)
		} else {
			slog.Warn("error fetching gitlab digest", "repo", imageRepo, "tag", tag, "error", err)
		}
		return nil, nil
	}

	result := &DigestResult{Digest: digest, Tag: tag}
	p.cache.Set(cacheKey, result)
	return result, nil
}

func (p *GitLabProvider) GetTagPublishDate(_ context.Context, _, _ string, _ Options) (*string, error) {
	// GitLab Container Registry does not expose tag publish dates via the registry API.
	return nil, nil
}
