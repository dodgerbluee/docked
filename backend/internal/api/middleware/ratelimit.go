package middleware

import (
	"context"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

// RateLimiter is a fixed-window per-key request limiter. It replaces the
// per-route express-rate-limit guards Node applied to the public auth routes:
// the graph's public operations (bootstrap, register) need the same abuse
// protection once traffic reaches Go directly.
type RateLimiter struct {
	mu      sync.Mutex
	slots   map[string]*rateSlot
	limit   int
	window  time.Duration
	maxKeys int
}

type rateSlot struct {
	count int
	reset time.Time
}

// NewRateLimiter allows limit requests per window per key, keeping at most
// maxKeys tracked keys (expired entries are swept when the map fills).
func NewRateLimiter(limit int, window time.Duration, maxKeys int) *RateLimiter {
	return &RateLimiter{
		slots:   make(map[string]*rateSlot),
		limit:   limit,
		window:  window,
		maxKeys: maxKeys,
	}
}

// Allow reports whether key may perform one request now, consuming budget.
func (l *RateLimiter) Allow(key string) bool {
	now := time.Now()
	l.mu.Lock()
	defer l.mu.Unlock()

	slot := l.slots[key]
	if slot == nil {
		if len(l.slots) >= l.maxKeys {
			l.sweep(now)
			// Still full after sweeping: refuse new keys rather than grow
			// unboundedly (existing keys keep their slots).
			if len(l.slots) >= l.maxKeys {
				return false
			}
		}
		l.slots[key] = &rateSlot{count: 1, reset: now.Add(l.window)}
		return true
	}
	if now.After(slot.reset) {
		slot.count = 1
		slot.reset = now.Add(l.window)
		return true
	}
	if slot.count >= l.limit {
		return false
	}
	slot.count++
	return true
}

func (l *RateLimiter) sweep(now time.Time) {
	for k, v := range l.slots {
		if now.After(v.reset) {
			delete(l.slots, k)
		}
	}
}

// GraphQLTooManyRequests writes a GraphQL-shaped 429 so urql surfaces it as a
// normal operation error instead of a parse failure.
func GraphQLTooManyRequests(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusTooManyRequests)
	w.Write([]byte(`{"errors":[{"message":"too many requests; please slow down"}]}`))
}

// ClientKeyFromRequest derives the rate-limit identity for a request. It uses
// the RIGHTMOST X-Forwarded-For entry, which is the only one a trusted front
// proxy (the Node server) controls: everything to its left is client-supplied
// and spoofable. With no forwarding header it falls back to the peer IP with
// the port stripped, so WS upgrades from a local bridge share one bucket per
// IP instead of getting a fresh key per ephemeral port.
func ClientKeyFromRequest(req *http.Request) string {
	if xff := req.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		if ip := strings.TrimSpace(parts[len(parts)-1]); ip != "" {
			return ip
		}
	}
	host, _, err := net.SplitHostPort(req.RemoteAddr)
	if err != nil {
		return req.RemoteAddr
	}
	return host
}

type clientIPKey struct{}

// WithClientIP stashes the sanitized client identity for downstream resolvers.
func WithClientIP(ctx context.Context, ip string) context.Context {
	return context.WithValue(ctx, clientIPKey{}, ip)
}

// ClientIP returns the identity stored by WithClientIP, or "" if absent.
func ClientIP(ctx context.Context) string {
	ip, _ := ctx.Value(clientIPKey{}).(string)
	return ip
}
