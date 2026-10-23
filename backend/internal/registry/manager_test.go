package registry

import (
	"context"
	"errors"
	"testing"
)

func sp(s string) *string { return &s }

func TestHasUpdate(t *testing.T) {
	tests := []struct {
		name          string
		currentDigest *string
		currentTag    string
		latest        *DigestResult
		repoDigests   []string
		want          bool
	}{
		{
			name:   "nil latest never updates",
			latest: nil,
			want:   false,
		},
		{
			name:       "fallback compares versions",
			currentTag: "v1.0.0",
			latest:     &DigestResult{Tag: "v1.0.1", IsFallback: true, Provider: "github-releases"},
			want:       true,
		},
		{
			name:       "fallback equal versions",
			currentTag: "v1.0.0",
			latest:     &DigestResult{Tag: "v1.0.0", IsFallback: true, Provider: "github-releases"},
			want:       false,
		},
		{
			name:          "digests differ",
			currentDigest: sp("sha256:aaa"),
			latest:        &DigestResult{Digest: sp("sha256:bbb"), Tag: "latest", Provider: "dockerhub"},
			want:          true,
		},
		{
			name:          "digests equal",
			currentDigest: sp("sha256:aaa"),
			latest:        &DigestResult{Digest: sp("sha256:aaa"), Tag: "latest", Provider: "dockerhub"},
			want:          false,
		},
		{
			name:          "latest digest found in repoDigests (multi-arch)",
			currentDigest: sp("sha256:aaa"),
			latest:        &DigestResult{Digest: sp("sha256:ccc"), Tag: "latest", Provider: "dockerhub"},
			repoDigests:   []string{"sha256:aaa", "sha256:ccc"},
			want:          false,
		},
		{
			name:          "latest digest not in repoDigests",
			currentDigest: sp("sha256:aaa"),
			latest:        &DigestResult{Digest: sp("sha256:ccc"), Tag: "latest", Provider: "dockerhub"},
			repoDigests:   []string{"sha256:aaa", "sha256:bbb"},
			want:          true,
		},
		{
			name:          "no current digest falls back to tag compare",
			currentDigest: nil,
			currentTag:    "1.24",
			latest:        &DigestResult{Digest: sp("sha256:ccc"), Tag: "1.25", Provider: "dockerhub"},
			want:          true,
		},
		{
			name:       "no digests and equal tags",
			currentTag: "latest",
			latest:     &DigestResult{Tag: "latest", Provider: "dockerhub"},
			want:       false,
		},
		{
			name:          "bare hex digests normalize",
			currentDigest: sp("aaa"),
			latest:        &DigestResult{Digest: sp("bbb"), Tag: "latest", Provider: "dockerhub"},
			want:          true,
		},
	}

	m := NewManager(nil)
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := m.HasUpdate(tc.currentDigest, tc.currentTag, tc.latest, tc.repoDigests); got != tc.want {
				t.Errorf("HasUpdate = %v, want %v", got, tc.want)
			}
		})
	}
}

// stubProvider isolates the manager's error policy from any network provider.
type stubProvider struct{ err error }

func (p stubProvider) Name() string          { return "stub" }
func (p stubProvider) CanHandle(string) bool { return true }
func (p stubProvider) GetLatestDigest(context.Context, string, string, Options) (*DigestResult, error) {
	return nil, p.err
}
func (p stubProvider) GetTagPublishDate(context.Context, string, string, Options) (*string, error) {
	return nil, p.err
}

func newStubManager(err error) *Manager {
	return &Manager{
		providers:     []Provider{stubProvider{err: err}},
		fallback:      NewGitHubReleasesProvider(),
		providerCache: map[string]Provider{},
		cache:         NewDigestCache(DigestCacheTTL),
	}
}

// A throttled registry is not a "no such image" observation: the manager must
// surface it, or the caller's rate-limit branch stays dead and the scan keeps
// hammering the registry.
func TestManagerPropagatesRateLimit(t *testing.T) {
	m := newStubManager(&HTTPStatusError{StatusCode: 429, StatusText: "Too Many Requests"})
	if _, err := m.GetLatestDigest(context.Background(), "ghcr.io/owner/app", "latest", Options{}); err == nil || !IsRateLimitError(err) {
		t.Fatalf("rate limit was swallowed instead of propagated: %v", err)
	}
}

// Every other provider error keeps Node's behaviour: fall back, else nil.
func TestManagerStillFallsBackOnOtherErrors(t *testing.T) {
	m := newStubManager(errors.New("registry unavailable"))
	res, err := m.GetLatestDigest(context.Background(), "ghcr.io/owner/app", "latest", Options{})
	if err != nil {
		t.Fatalf("non-rate-limit error must not propagate: %v", err)
	}
	if res != nil {
		t.Fatalf("expected no result without a githubRepo mapping, got %+v", res)
	}
}
