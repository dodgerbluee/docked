package middleware

// Tests for the phase-8b edge middleware: the helmet port (CSP modes, HSTS,
// cross-origin isolation trio, no-store workaround) and the cors port
// (origin allow-list, credentials, preflight short-circuit).

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dockedapp/backend/internal/config"
)

func TestSecurityHeadersRelaxed(t *testing.T) {
	edge := config.EdgeConfig{NodeEnv: "development", Relaxed: true, HTTPS: false}
	rec := httptest.NewRecorder()
	SecurityHeaders(edge)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	h := rec.Header()
	csp := h.Get("Content-Security-Policy")
	if !strings.Contains(csp, "'unsafe-eval'") || !strings.Contains(csp, "connect-src 'self' http: https: ws: wss:") {
		t.Fatalf("relaxed CSP wrong: %q", csp)
	}
	if strings.Contains(csp, "upgrade-insecure-requests") {
		t.Fatalf("relaxed CSP must not upgrade insecure requests: %q", csp)
	}
	for _, hdr := range []string{
		"Cross-Origin-Embedder-Policy", "Cross-Origin-Opener-Policy",
		"Cross-Origin-Resource-Policy", "Strict-Transport-Security",
	} {
		if h.Get(hdr) != "" {
			t.Fatalf("%s must be absent in relaxed mode: %q", hdr, h.Get(hdr))
		}
	}
	if h.Get("X-Frame-Options") != "SAMEORIGIN" || h.Get("X-Content-Type-Options") != "nosniff" ||
		h.Get("Referrer-Policy") != "no-referrer" || h.Get("X-DNS-Prefetch-Control") != "off" ||
		h.Get("X-Download-Options") != "noopen" || h.Get("X-Permitted-Cross-Domain-Policies") != "none" {
		t.Fatalf("helmet defaults wrong: %v", h)
	}
	// Non-HTTPS no-store workaround (Safari header caching).
	if h.Get("Cache-Control") != "no-store, no-cache, must-revalidate, private" || h.Get("Pragma") != "no-cache" {
		t.Fatalf("no-store headers wrong: %v", h)
	}
}

func TestSecurityHeadersStrictHTTPS(t *testing.T) {
	edge := config.EdgeConfig{NodeEnv: "production", Relaxed: false, HTTPS: true}
	rec := httptest.NewRecorder()
	SecurityHeaders(edge)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))

	h := rec.Header()
	csp := h.Get("Content-Security-Policy")
	if strings.Contains(csp, "'unsafe-eval'") {
		t.Fatalf("strict CSP must not allow unsafe-eval: %q", csp)
	}
	if !strings.Contains(csp, "upgrade-insecure-requests") {
		t.Fatalf("HTTPS strict CSP must upgrade insecure requests: %q", csp)
	}
	if h.Get("Strict-Transport-Security") != "max-age=31536000; includeSubDomains" {
		t.Fatalf("HSTS wrong: %q", h.Get("Strict-Transport-Security"))
	}
	if h.Get("Cross-Origin-Embedder-Policy") != "credentialless" ||
		h.Get("Cross-Origin-Opener-Policy") != "same-origin" ||
		h.Get("Cross-Origin-Resource-Policy") != "same-origin" {
		t.Fatalf("cross-origin isolation trio wrong: %v", h)
	}
	if h.Get("Cache-Control") != "" || h.Get("Pragma") != "" {
		t.Fatalf("HTTPS must not force no-store: %v", h)
	}
}

func TestCORSPort(t *testing.T) {
	allowed := []string{"http://localhost:3002"}
	handler := CORS(allowed)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Allowed origin gets ACAO + credentials.
	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	req.Header.Set("Origin", "http://localhost:3002")
	handler.ServeHTTP(rec, req)
	if rec.Header().Get("Access-Control-Allow-Origin") != "http://localhost:3002" ||
		rec.Header().Get("Access-Control-Allow-Credentials") != "true" ||
		rec.Header().Get("Vary") != "Origin" {
		t.Fatalf("allowed origin headers wrong: %v", rec.Header())
	}

	// Disallowed origin gets nothing (browser blocks).
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/health", nil)
	req.Header.Set("Origin", "http://evil.example")
	handler.ServeHTTP(rec, req)
	if rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("disallowed origin must not get ACAO: %v", rec.Header())
	}

	// Preflight short-circuits with 204 and the configured method/header sets.
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodOptions, "/api/auth/login", nil)
	req.Header.Set("Origin", "http://localhost:3002")
	req.Header.Set("Access-Control-Request-Method", "POST")
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("preflight status = %d, want 204", rec.Code)
	}
	if rec.Header().Get("Access-Control-Allow-Methods") != "GET,POST,PUT,DELETE,OPTIONS" ||
		rec.Header().Get("Access-Control-Allow-Headers") != "Content-Type,Authorization" {
		t.Fatalf("preflight headers wrong: %v", rec.Header())
	}

	// Deny-all config (production default): even preflight carries no ACAO.
	deny := CORS(nil)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	rec = httptest.NewRecorder()
	req = httptest.NewRequest(http.MethodGet, "/api/health", nil)
	req.Header.Set("Origin", "http://localhost:3002")
	deny.ServeHTTP(rec, req)
	if rec.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatalf("deny-all must not emit ACAO: %v", rec.Header())
	}
}
