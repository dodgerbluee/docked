package runner

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

// --- install script generation -------------------------------------------

func TestGenerateInstallScriptValidation(t *testing.T) {
	valid := InstallScriptParams{
		Token:           strings.Repeat("ab", 32),
		DockhandVersion: "0.1.3",
		DockedURL:       "https://docked.example.com",
		Port:            7777,
	}

	script, err := GenerateInstallScript(valid)
	if err != nil {
		t.Fatalf("valid params rejected: %v", err)
	}
	for _, want := range []string{
		`DOCKED_URL="https://docked.example.com"`,
		`ENROLLMENT_TOKEN="` + valid.Token + `"`,
		`DOCKHAND_VERSION="0.1.3"`,
		"PORT=7777",
	} {
		if !strings.Contains(script, want) {
			t.Fatalf("script missing %q", want)
		}
	}
	if strings.Contains(script, "__") {
		t.Fatal("unreplaced placeholder left in script")
	}

	bad := []struct {
		name   string
		mutate func(*InstallScriptParams)
	}{
		{"non-hex token", func(p *InstallScriptParams) { p.Token = "zz" + strings.Repeat("ab", 30) }},
		{"latest version", func(p *InstallScriptParams) { p.DockhandVersion = "latest" }},
		{"injection in url", func(p *InstallScriptParams) { p.DockedURL = "http://x/$(evil)" }},
		{"backtick in url", func(p *InstallScriptParams) { p.DockedURL = "http://x/`id`" }},
		{"port zero", func(p *InstallScriptParams) { p.Port = 0 }},
		{"port too high", func(p *InstallScriptParams) { p.Port = 70000 }},
	}
	for _, tc := range bad {
		p := valid
		tc.mutate(&p)
		if _, err := GenerateInstallScript(p); err == nil {
			t.Fatalf("%s: expected rejection, got nil error", tc.name)
		}
	}

	// Uppercase hex token accepted (Node's regex is /i).
	p := valid
	p.Token = strings.ToUpper(valid.Token)
	if _, err := GenerateInstallScript(p); err != nil {
		t.Fatalf("uppercase hex token rejected: %v", err)
	}
}

// --- server URL resolution -------------------------------------------------

func TestDockedURL(t *testing.T) {
	// Explicit override wins and loses trailing slashes (Node: replace(/\/+$/,"")).
	r := httptest.NewRequest(http.MethodGet, "/x", nil)
	if got := DockedURL(r, "https://docked.example.com///"); got != "https://docked.example.com" {
		t.Fatalf("override: %q", got)
	}

	// Forwarded headers beat the request Host.
	r = httptest.NewRequest(http.MethodGet, "http://127.0.0.1:4000/x", nil)
	r.Header.Set("X-Forwarded-Proto", "https")
	r.Header.Set("X-Forwarded-Host", "docked.example.com")
	if got := DockedURL(r, ""); got != "https://docked.example.com" {
		t.Fatalf("forwarded: %q", got)
	}

	// Plain Host fallback (non-localhost so LAN-IP substitution is skipped).
	r = httptest.NewRequest(http.MethodGet, "http://10.0.0.3:4000/x", nil)
	r.Host = "10.0.0.3:4000"
	if got := DockedURL(r, ""); got != "http://10.0.0.3:4000" {
		t.Fatalf("host fallback: %q", got)
	}
}

// --- GitHub release lookups -------------------------------------------------

func TestLatestReleaseTag(t *testing.T) {
	var hits int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/fail/releases/latest") {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		atomic.AddInt64(&hits, 1)
		fmt.Fprint(w, `{"tag_name":"v9.8.7"}`)
	}))
	defer srv.Close()

	prev := GitHubAPIBase
	GitHubAPIBase = srv.URL
	defer func() { GitHubAPIBase = prev }()

	ctx := context.Background()

	// Unique repos keep the shared package-level cache from leaking between
	// assertions.
	tag, ok := LatestReleaseTag(ctx, "stub/repo-a", false)
	if !ok || tag != "v9.8.7" {
		t.Fatalf("lookup: %q ok=%v", tag, ok)
	}
	// Second call must be served from the 1h cache (no extra HTTP hit).
	if tag, ok = LatestReleaseTag(ctx, "stub/repo-a", false); !ok || tag != "v9.8.7" {
		t.Fatalf("cached lookup: %q ok=%v", tag, ok)
	}
	if n := atomic.LoadInt64(&hits); n != 1 {
		t.Fatalf("cache miss: %d HTTP hits, want 1", n)
	}
	// skipCache forces a refetch.
	if _, ok = LatestReleaseTag(ctx, "stub/repo-a", true); !ok {
		t.Fatal("skipCache lookup failed")
	}
	if n := atomic.LoadInt64(&hits); n != 2 {
		t.Fatalf("skipCache: %d HTTP hits, want 2", n)
	}

	// Non-200 → ok=false, and the failure must not poison the cache.
	if _, ok = LatestReleaseTag(ctx, "stub/fail", false); ok {
		t.Fatal("non-200: expected ok=false")
	}

	// LatestDockhandVersion strips the leading v and falls back to "latest".
	if v := LatestDockhandVersion(ctx, true); v != "9.8.7" {
		t.Fatalf("LatestDockhandVersion: %q", v)
	}
}
