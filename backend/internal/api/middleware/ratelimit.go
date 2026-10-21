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

// RESTTooManyRequests writes the runner-REST-shaped 429 body (the same
// {"success":false,"error":...} envelope the migrated Node routes produced).
func RESTTooManyRequests(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusTooManyRequests)
	w.Write([]byte(`{"success":false,"error":"Too many requests from this IP, please try again later."}`))
}

// RateLimit adapts a RateLimiter to chi middleware, keying on
// ClientKeyFromRequest (the peer address as sanitized by RealIPFrom).
func RateLimit(l *RateLimiter, tooManyRequests func(http.ResponseWriter)) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !l.Allow(ClientKeyFromRequest(r)) {
				tooManyRequests(w)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RealIPFrom replaces chi's unconditional middleware.RealIP: it folds the
// forwarding headers into r.RemoteAddr ONLY when the socket peer belongs to
// one of the trusted proxy networks. With an untrusted peer the
// attacker-controlled X-Forwarded-For / X-Real-IP headers are ignored and the
// true peer address is kept, so a directly-exposed instance cannot be
// spoofed into fresh rate-limit buckets.
func RealIPFrom(trusted []*net.IPNet) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			peer, _, err := net.SplitHostPort(r.RemoteAddr)
			if err != nil {
				peer = r.RemoteAddr
			}
			if ip := net.ParseIP(peer); ip != nil && ipInNetworks(ip, trusted) {
				candidate := ""
				if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
					parts := strings.Split(xff, ",")
					candidate = strings.TrimSpace(parts[len(parts)-1])
				} else if xr := r.Header.Get("X-Real-IP"); xr != "" {
					candidate = strings.TrimSpace(xr)
				}
				if cip := net.ParseIP(candidate); cip != nil {
					r.RemoteAddr = net.JoinHostPort(cip.String(), "0")
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

func ipInNetworks(ip net.IP, nets []*net.IPNet) bool {
	for _, n := range nets {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

// ClientKeyFromRequest derives the rate-limit identity from the peer
// address. X-Forwarded-For is deliberately NOT consulted here: RealIPFrom
// has already folded the trusted-proxy view into RemoteAddr, and anything
// still in the header is client-supplied and spoofable. The port is
// stripped so WS upgrades from one client share a bucket instead of getting
// a fresh key per ephemeral port.
func ClientKeyFromRequest(req *http.Request) string {
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
