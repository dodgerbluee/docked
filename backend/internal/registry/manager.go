package registry

import (
	"context"
	"database/sql"
	"log/slog"
	"strings"
	"sync"
)

// Manager ports services/registry/RegistryManager.js: provider selection,
// the GitHub-Releases fallback chain, and the hasUpdate comparison rules.
type Manager struct {
	providers     []Provider
	fallback      *GitHubReleasesProvider
	providerCache map[string]Provider
	cache         *DigestCache
	mu            sync.Mutex
}

// NewManager wires the provider stack in Node's selection order:
// GHCR -> GitLab -> GCR -> DockerHub (first canHandle wins).
func NewManager(database *sql.DB) *Manager {
	cache := NewDigestCache(DigestCacheTTL)
	fallback := NewGitHubReleasesProvider()
	return &Manager{
		providers: []Provider{
			NewGHCRProvider(cache, fallback),
			NewGitLabProvider(cache, database),
			NewGCRProvider(cache, NewDockerHubProvider(cache)),
			NewDockerHubProvider(cache),
		},
		fallback:      fallback,
		providerCache: make(map[string]Provider),
		cache:         cache,
	}
}

// GetProvider picks the provider for an image repo (per-repo cached).
func (m *Manager) GetProvider(imageRepo string) Provider {
	m.mu.Lock()
	defer m.mu.Unlock()
	if p, ok := m.providerCache[imageRepo]; ok {
		return p
	}
	for _, p := range m.providers {
		if p.CanHandle(imageRepo) {
			m.providerCache[imageRepo] = p
			return p
		}
	}
	return nil
}

// processProviderResult mirrors _processProviderResult: a nil provider result
// still yields a non-nil result with a null digest.
func processProviderResult(result *DigestResult, provider Provider, tag string) *DigestResult {
	if result != nil {
		if result.Provider == "" {
			result.Provider = provider.Name()
		}
		return result
	}
	return &DigestResult{Tag: tag, Provider: provider.Name()}
}

// GetLatestDigest resolves the latest digest for imageRepo:tag with the
// GitHub-Releases fallback chain. With useFallback semantics matching Node
// (always on here), provider errors never propagate: they fall back or
// resolve to nil.
func (m *Manager) GetLatestDigest(ctx context.Context, imageRepo, tag string, opts Options) (*DigestResult, error) {
	provider := m.GetProvider(imageRepo)
	if provider == nil {
		slog.Warn("no provider found for image", "repo", imageRepo)
		return nil, nil
	}

	result, err := provider.GetLatestDigest(ctx, imageRepo, tag, opts)
	if err == nil {
		return processProviderResult(result, provider, tag), nil
	}

	slog.Debug("registry provider error, trying fallback", "repo", imageRepo, "tag", tag, "error", err)
	return m.tryFallback(ctx, imageRepo, tag, opts), nil
}

// tryFallback mirrors _tryFallback: only runs with an explicit githubRepo
// mapping, and marks the result provider=github-releases isFallback=true.
func (m *Manager) tryFallback(ctx context.Context, imageRepo, tag string, opts Options) *DigestResult {
	if opts.GithubRepo == "" {
		return nil
	}
	result, err := m.fallback.GetLatestDigest(ctx, imageRepo, tag, opts)
	if err != nil {
		slog.Debug("fallback provider also failed", "repo", imageRepo, "tag", tag, "error", err)
		return nil
	}
	if result == nil {
		return nil
	}
	result.Provider = m.fallback.Name()
	result.IsFallback = true
	return result
}

// GetTagPublishDate mirrors getTagPublishDate: ask the selected provider,
// then the GitHub Releases fallback.
func (m *Manager) GetTagPublishDate(ctx context.Context, imageRepo, tag string, opts Options) (*string, error) {
	provider := m.GetProvider(imageRepo)
	if provider == nil {
		return nil, nil
	}
	date, err := provider.GetTagPublishDate(ctx, imageRepo, tag, opts)
	if err != nil {
		slog.Debug("provider publish date failed", "repo", imageRepo, "tag", tag, "error", err)
	}
	if date != nil {
		return date, nil
	}
	if opts.GithubRepo == "" {
		return nil, nil
	}
	return m.fallback.GetTagPublishDate(ctx, imageRepo, tag, opts)
}

// HasUpdate ports RegistryManager.hasUpdate. repoDigests must be the clean
// "sha256:..." form (image prefix already stripped).
func (m *Manager) HasUpdate(currentDigest *string, currentTag string, latest *DigestResult, repoDigests []string) bool {
	if latest == nil {
		return false
	}

	// Fallback (GitHub Releases) results compare versions, not digests.
	if latest.IsFallback {
		return m.fallback.HasUpdate(currentTag, latest.Tag)
	}

	if currentDigest != nil && latest.Digest != nil {
		normalizedCurrent := normalizeDigest(*currentDigest)
		normalizedLatest := normalizeDigest(*latest.Digest)

		// CRITICAL: the latest digest may exist in ANY of the container's
		// RepoDigests (multi-arch images) — same warning as Node.
		if len(repoDigests) > 0 {
			latestHash := strings.TrimPrefix(normalizedLatest, "sha256:")
			for _, rd := range repoDigests {
				if strings.TrimPrefix(normalizeDigest(rd), "sha256:") == latestHash {
					return false
				}
			}
		}

		return normalizedCurrent != normalizedLatest
	}

	// Digests unavailable: compare tags.
	if currentTag != "" && latest.Tag != "" {
		return currentTag != latest.Tag
	}
	return false
}

func normalizeDigest(digest string) string {
	if digest == "" {
		return ""
	}
	if strings.HasPrefix(digest, "sha256:") {
		return digest
	}
	return "sha256:" + digest
}

// ClearCache drops the cached digest for one image (used by upgrade flows).
func (m *Manager) ClearCache(imageRepo, tag string) {
	m.cache.Delete(imageRepo + ":" + tag)
	m.cache.Delete(strings.TrimPrefix(imageRepo, "docker.io/") + ":" + tag)
	m.cache.Delete("ghcr:" + strings.TrimPrefix(imageRepo, "ghcr.io/") + ":" + tag)
	m.cache.Delete("gitlab:" + strings.TrimPrefix(imageRepo, "registry.gitlab.com/") + ":" + tag)
	m.cache.Delete("gcr:" + strings.TrimPrefix(imageRepo, "gcr.io/") + ":" + tag)
}
