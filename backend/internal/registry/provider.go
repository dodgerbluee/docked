package registry

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/google/go-containerregistry/pkg/name"
	"github.com/google/go-containerregistry/pkg/v1/remote"
	"github.com/google/go-containerregistry/pkg/v1/remote/transport"
)

// DigestResult mirrors the object shape Node providers return from
// getLatestDigest: { digest, tag, version?, publishDate?, provider?, isFallback }.
type DigestResult struct {
	Digest      *string // "sha256:..." (index/manifest-list digest), or nil
	Tag         string
	Version     *string
	PublishDate *string
	Provider    string // empty means "fill in with the selected provider name"
	IsFallback  bool
}

// Options carries per-call context, mirroring the options bag in Node.
type Options struct {
	UserID     int64
	GithubRepo string // explicit GitHub repo mapping for the releases fallback
}

// Provider is the interface every registry backend implements.
type Provider interface {
	Name() string
	CanHandle(imageRepo string) bool
	GetLatestDigest(ctx context.Context, imageRepo, tag string, opts Options) (*DigestResult, error)
	GetTagPublishDate(ctx context.Context, imageRepo, tag string, opts Options) (*string, error)
}

// fetchTimeout matches Node's axios 10s timeout / crane defaults.
const fetchTimeout = 10 * time.Second

// fetchIndexDigest resolves the manifest-list (index) digest for imageRef via
// the registry protocol using go-containerregistry — the library behind crane.
// It deliberately does NOT resolve a platform: Docker stores the index digest
// in RepoDigests, and resolving platform-specific digests causes false updates
// for multi-arch images (same warning as imageUpdateService.js).
func fetchIndexDigest(ctx context.Context, imageRef string, authOpts ...remote.Option) (*string, error) {
	ref, err := name.ParseReference(imageRef)
	if err != nil {
		return nil, fmt.Errorf("parse reference %q: %w", imageRef, err)
	}

	ctx, cancel := context.WithTimeout(ctx, fetchTimeout)
	defer cancel()

	opts := append([]remote.Option{remote.WithContext(ctx)}, authOpts...)
	desc, err := remote.Get(ref, opts...)
	if err != nil {
		var tErr *transport.Error
		if errors.As(err, &tErr) {
			return nil, &HTTPStatusError{StatusCode: tErr.StatusCode, StatusText: http.StatusText(tErr.StatusCode)}
		}
		return nil, err
	}

	recordSuccess()
	digest := desc.Digest.String()
	return &digest, nil
}

// retryFetch ports retryWithBackoff used by the GitLab/GCR providers:
// 3 attempts, exponential backoff from 1s, rate-limit bookkeeping on 429.
func retryFetch(ctx context.Context, fn func() (*string, error)) (*string, error) {
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(time.Duration(1<<uint(attempt-1)) * time.Second):
			}
		}
		digest, err := fn()
		if err == nil {
			return digest, nil
		}
		lastErr = err
		if IsRateLimitError(err) {
			if recordRateLimitError() {
				return nil, ErrRateLimitExceeded
			}
			continue
		}
		// Non-retryable for our purposes: 404/401/403 style misses.
		var hsErr *HTTPStatusError
		if errors.As(err, &hsErr) && hsErr.StatusCode != http.StatusInternalServerError &&
			hsErr.StatusCode != http.StatusBadGateway && hsErr.StatusCode != http.StatusServiceUnavailable {
			return nil, err
		}
	}
	return nil, lastErr
}
