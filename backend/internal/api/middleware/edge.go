package middleware

import (
	"net/http"
	"strings"

	"github.com/dockedapp/backend/internal/config"
)

// SecurityHeaders is the Go port of Node's helmet v8 configuration plus the
// two hand-rolled HSTS/Cache-Control tweaks server.js wraps around it. The
// directive sets and header values mirror helmet's defaults exactly so the
// browser sees the same policy whether the edge is Node or Go.
func SecurityHeaders(edge config.EdgeConfig) func(http.Handler) http.Handler {
	// Node's pre-helmet middleware: when not serving HTTPS, force
	// no-store/Pragma no-cache (Safari header-caching workaround).
	preHTTPS := !edge.HTTPS

	// helmet contentSecurityPolicy, relaxed vs strict (server.js).
	var csp strings.Builder
	if edge.Relaxed {
		csp.WriteString("default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self' 'unsafe-inline' 'unsafe-eval'; img-src 'self' data: https: http: blob:; connect-src 'self' http: https: ws: wss:; font-src 'self' data: https://fonts.gstatic.com; object-src 'none'")
	} else {
		csp.WriteString("default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self'; img-src 'self' data: https: blob:; connect-src 'self'; font-src 'self' data: https://fonts.gstatic.com; object-src 'none'")
		if edge.HTTPS {
			csp.WriteString("; upgrade-insecure-requests")
		}
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()
			if preHTTPS {
				h.Set("Cache-Control", "no-store, no-cache, must-revalidate, private")
				h.Set("Pragma", "no-cache")
			}
			h.Set("Content-Security-Policy", csp.String())
			if edge.HTTPS {
				// helmet strictTransportSecurity: maxAge 1y, includeSubDomains,
				// no preload. Never set when !HTTPS (Node removes it twice).
				h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
			}
			// helmet v8 defaults (always on).
			h.Set("X-DNS-Prefetch-Control", "off")
			h.Set("X-Frame-Options", "SAMEORIGIN")
			h.Set("X-Content-Type-Options", "nosniff")
			h.Set("Referrer-Policy", "no-referrer")
			h.Set("X-Download-Options", "noopen")
			h.Set("X-Permitted-Cross-Domain-Policies", "none")
			// Cross-origin isolation trio: disabled in relaxed mode, strict
			// values in production (COEP credentialless lets cross-origin
			// images load without CORP headers).
			if !edge.Relaxed {
				h.Set("Cross-Origin-Embedder-Policy", "credentialless")
				h.Set("Cross-Origin-Opener-Policy", "same-origin")
				h.Set("Cross-Origin-Resource-Policy", "same-origin")
			}
			next.ServeHTTP(w, r)
		})
	}
}

// CORS is the Go port of the cors package configured in Node's config.cors:
// an origin allow-list (empty = deny every cross-origin request, matching
// Node's production default), credentials always on, fixed method/header
// sets, and 204 short-circuit for preflights.
func CORS(allowedOrigins []string) func(http.Handler) http.Handler {
	allowed := make(map[string]bool, len(allowedOrigins))
	for _, o := range allowedOrigins {
		allowed[o] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			h := w.Header()
			// cors sets Vary: Origin whenever the origin is dynamic.
			h.Set("Vary", "Origin")
			origin := r.Header.Get("Origin")
			if origin != "" && allowed[origin] {
				h.Set("Access-Control-Allow-Origin", origin)
				h.Set("Access-Control-Allow-Credentials", "true")
			}
			// cors' preflight short-circuit: OPTIONS carrying
			// Access-Control-Request-Method gets 204 with the configured
			// method/header sets (even for disallowed origins — the missing
			// ACAO is what blocks the browser).
			if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
				h.Set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
				h.Set("Access-Control-Allow-Headers", "Content-Type,Authorization")
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
