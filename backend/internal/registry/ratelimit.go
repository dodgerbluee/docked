package registry

import (
	"errors"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Global rate-limit bookkeeping, ported from server/utils/rateLimiter.js.
// A single process-wide gate spaces out registry requests, and consecutive
// 429s trip a hard stop (RateLimitExceeded) until the window lapses.
const (
	rateLimitErrorThreshold = 5
	rateLimitErrorWindow    = 60 * time.Second
)

// ErrRateLimitExceeded is the fatal "too many 429s" signal, equivalent to
// Node's RateLimitExceededError (isRateLimitExceeded === true).
var ErrRateLimitExceeded = errors.New("registry rate limit exceeded. Too many consecutive rate limit errors. Please wait a few minutes before trying again. Tip: Run 'docker login' on your server for higher rate limits.")

// IsRateLimitError mirrors RegistryProvider.isRateLimitError.
func IsRateLimitError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, ErrRateLimitExceeded) {
		return true
	}
	var rl *HTTPStatusError
	if errors.As(err, &rl) && rl.StatusCode == 429 {
		return true
	}
	return strings.Contains(strings.ToLower(err.Error()), "rate limit")
}

// HTTPStatusError carries an HTTP status code so callers can classify 404/429.
type HTTPStatusError struct {
	StatusCode int
	StatusText string
}

func (e *HTTPStatusError) Error() string {
	return "http status " + strconv.Itoa(e.StatusCode)
}

type rateLimiter struct {
	mu                      sync.Mutex
	lastRequest             time.Time
	consecutiveRateLimitErr int
	lastRateLimitErrorTime  time.Time
}

var limiter = &rateLimiter{}

// rateLimitDelay enforces a minimum spacing between registry requests.
func rateLimitDelay(delay time.Duration) {
	if delay <= 0 {
		return
	}
	limiter.mu.Lock()
	wait := delay - time.Since(limiter.lastRequest)
	if wait > 0 {
		limiter.lastRequest = time.Now().Add(wait)
	} else {
		limiter.lastRequest = time.Now()
	}
	limiter.mu.Unlock()
	if wait > 0 {
		time.Sleep(wait)
	}
}

// recordRateLimitError returns true when the consecutive-429 threshold trips.
func recordRateLimitError() bool {
	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	now := time.Now()
	if now.Sub(limiter.lastRateLimitErrorTime) > rateLimitErrorWindow {
		limiter.consecutiveRateLimitErr = 0
	}
	limiter.consecutiveRateLimitErr++
	limiter.lastRateLimitErrorTime = now
	return limiter.consecutiveRateLimitErr >= rateLimitErrorThreshold
}

func recordSuccess() {
	limiter.mu.Lock()
	defer limiter.mu.Unlock()
	limiter.consecutiveRateLimitErr = 0
}
