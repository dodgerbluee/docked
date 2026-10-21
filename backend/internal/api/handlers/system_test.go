package handlers

// Tests for the system REST handlers ported in phase 8b (health + version).

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/dockedapp/backend/internal/config"
)

func decodeBody(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode body %q: %v", rec.Body.String(), err)
	}
	return out
}

func TestHealthEnvelope(t *testing.T) {
	rec := httptest.NewRecorder()
	Health()(rec, httptest.NewRequest(http.MethodGet, "/api/health", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	body := decodeBody(t, rec)
	if body["success"] != true || body["status"] != "ok" {
		t.Fatalf("body = %v, want {success:true, status:ok}", body)
	}
}

func writePkg(t *testing.T, dir, version string) string {
	t.Helper()
	p := dir + "/package.json"
	var content string
	if version == "" {
		content = `{"name":"docked"}`
	} else {
		content = `{"name":"docked","version":"` + version + `"}`
	}
	if err := os.WriteFile(p, []byte(content), 0o644); err != nil {
		t.Fatalf("write package.json: %v", err)
	}
	return p
}

func TestVersionDevBuildRules(t *testing.T) {
	cases := []struct {
		name       string
		version    string
		nodeEnv    string
		wantVer    any
		wantDev    *bool // nil → key must be absent
	}{
		{"formal dev release in prod", "3.30.0-dev", "production", "3.30.0-dev", boolPtr(false)},
		{"formal dev release in dev", "3.30.0-dev", "development", "3.30.0-dev", boolPtr(false)},
		{"unversioned local dev", "1.0.0", "production", "1.0.0", boolPtr(true)},
		{"versioned local dev", "3.29.3", "development", "3.29.3", boolPtr(true)},
		{"prod release", "3.29.3", "production", "3.29.3", boolPtr(false)},
		{"missing version field", "", "production", nil, boolPtr(false)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			pkg := writePkg(t, dir, tc.version)
			cfg := &config.Config{Edge: config.EdgeConfig{NodeEnv: tc.nodeEnv, PackageJSON: pkg}}
			rec := httptest.NewRecorder()
			Version(cfg)(rec, httptest.NewRequest(http.MethodGet, "/api/version", nil))
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", rec.Code)
			}
			body := decodeBody(t, rec)
			if body["success"] != true {
				t.Fatalf("success missing: %v", body)
			}
			if body["version"] != tc.wantVer {
				t.Fatalf("version = %v, want %v", body["version"], tc.wantVer)
			}
			if body["environment"] != tc.nodeEnv {
				t.Fatalf("environment = %v, want %v", body["environment"], tc.nodeEnv)
			}
			if tc.wantDev == nil {
				if _, ok := body["isDevBuild"]; ok {
					t.Fatalf("isDevBuild must be absent: %v", body)
				}
			} else if body["isDevBuild"] != *tc.wantDev {
				t.Fatalf("isDevBuild = %v, want %v", body["isDevBuild"], *tc.wantDev)
			}
		})
	}
}

func TestVersionMissingFileOmitsIsDevBuild(t *testing.T) {
	cfg := &config.Config{Edge: config.EdgeConfig{NodeEnv: "production", PackageJSON: "/nonexistent/package.json"}}
	rec := httptest.NewRecorder()
	Version(cfg)(rec, httptest.NewRequest(http.MethodGet, "/api/version", nil))
	body := decodeBody(t, rec)
	if body["version"] != nil || body["environment"] != "production" {
		t.Fatalf("body = %v", body)
	}
	if _, ok := body["isDevBuild"]; ok {
		t.Fatalf("fallback must omit isDevBuild: %v", body)
	}
}

func boolPtr(b bool) *bool { return &b }
