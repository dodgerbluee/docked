package imagesync

import (
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/dockedapp/backend/internal/runner"
)

// app-version-scan fixtures: tracked tables + a runners table shaped like
// the Node migration DDL.
func newAppVersionTestService(t *testing.T) (*Service, *sql.DB) {
	t.Helper()
	database := newTrackedTestDB(t)
	if _, err := database.Exec(`CREATE TABLE runners (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		name TEXT NOT NULL,
		url TEXT,
		api_key TEXT,
		enabled INTEGER DEFAULT 1,
		version TEXT,
		latest_version TEXT,
		version_checked_at DATETIME,
		docker_enabled INTEGER DEFAULT 0,
		last_seen DATETIME,
		docker_status TEXT,
		docker_status_since DATETIME,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`); err != nil {
		t.Fatalf("create runners: %v", err)
	}
	return NewService(database, nil), database
}

func insertAppRunner(t *testing.T, database *sql.DB, userID int64, name, url string, enabled int) int64 {
	t.Helper()
	res, err := database.Exec(
		"INSERT INTO runners (user_id, name, url, api_key, enabled) VALUES (?, ?, ?, 'key', ?)",
		userID, name, url, enabled)
	if err != nil {
		t.Fatalf("insert runner: %v", err)
	}
	id, _ := res.LastInsertId()
	return id
}

// TestScanRunnerApps covers the per-runner semantics of the ported handler:
// github enrichment (hit / up-to-date / failed lookup), command-sourced apps
// keeping runner-provided versions, unreachable runners skipped, disabled
// runners never contacted.
func TestScanRunnerApps(t *testing.T) {
	svc, database := newAppVersionTestService(t)
	ctx := context.Background()

	// GitHub stub (unique repos: the runner release cache is package-global).
	var ghHits int
	gh := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ghHits++
		switch {
		case strings.Contains(r.URL.Path, "/repos/owner/upd-apps/"):
			w.Header().Set("Content-Type", "application/json")
			io.WriteString(w, `{"tag_name":"2.0"}`)
		default:
			w.WriteHeader(http.StatusNotFound)
			io.WriteString(w, `{"message":"Not Found"}`)
		}
	}))
	defer gh.Close()
	oldBase := runner.GitHubAPIBase
	runner.GitHubAPIBase = gh.URL
	t.Cleanup(func() { runner.GitHubAPIBase = oldBase })

	appsPayload := `{"apps":[
		{"name":"radicale","currentVersion":"1.0","versionSource":{"type":"github","repo":"owner/upd-apps"}},
		{"name":"sonarr","currentVersion":"2.0","versionSource":{"type":"github","repo":"owner/upd-apps"}},
		{"name":"immich","currentVersion":"1.0","versionSource":{"type":"command"},"latestVersion":"9.9"},
		{"name":"gitea","currentVersion":"1.0","versionSource":{"type":"github","repo":"owner/missing-apps"}}
	]}`
	runnerA := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/apps" {
			w.Header().Set("Content-Type", "application/json")
			io.WriteString(w, appsPayload)
			return
		}
		w.WriteHeader(http.StatusNotFound)
	}))
	defer runnerA.Close()

	runnerB := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer runnerB.Close()

	var disabledHits int
	runnerC := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		disabledHits++
		w.WriteHeader(http.StatusOK)
	}))
	defer runnerC.Close()

	insertAppRunner(t, database, 1, "a", runnerA.URL, 1)
	insertAppRunner(t, database, 1, "b", runnerB.URL, 1)
	insertAppRunner(t, database, 1, "c", runnerC.URL, 0)

	checked, updated, err := svc.ScanRunnerApps(ctx, 1)
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	// itemsChecked counts only the reachable runner's apps (Node: the
	// rejected branch contributes 0/0/skipped=1).
	if checked != 4 || updated != 2 {
		t.Fatalf("checked=%d updated=%d, want 4/2", checked, updated)
	}
	if disabledHits != 0 {
		t.Errorf("disabled runner contacted %d times", disabledHits)
	}
	// github apps queried the stub twice (upd + missing); command app did not.
	if ghHits != 2 {
		t.Errorf("github lookups = %d, want 2", ghHits)
	}
}

// TestScanRunnerAppsNoRunners mirrors Node's early return when the user has
// no enabled runners.
func TestScanRunnerAppsNoRunners(t *testing.T) {
	svc, _ := newAppVersionTestService(t)
	checked, updated, err := svc.ScanRunnerApps(context.Background(), 1)
	if err != nil || checked != 0 || updated != 0 {
		t.Fatalf("empty scan = %d/%d/%v, want 0/0/nil", checked, updated, err)
	}
}

// payloadRecorder captures Discord webhook bodies.
type payloadRecorder struct {
	mu     sync.Mutex
	bodies []map[string]any
}

func (p *payloadRecorder) RoundTrip(req *http.Request) (*http.Response, error) {
	body, _ := io.ReadAll(req.Body)
	var parsed map[string]any
	_ = json.Unmarshal(body, &parsed)
	p.mu.Lock()
	p.bodies = append(p.bodies, parsed)
	p.mu.Unlock()
	return &http.Response{
		StatusCode: http.StatusNoContent,
		Body:       io.NopCloser(strings.NewReader("")),
		Request:    req,
	}, nil
}

func (p *payloadRecorder) count() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.bodies)
}

// TestAppVersionScanNotifications verifies the tracked-app embed is queued
// for updated apps (sourceType falls back to "app") and that the persistent
// dedup suppresses the second scan (key = user:app-name:latestVersion).
func TestAppVersionScanNotifications(t *testing.T) {
	svc, database := newAppVersionTestService(t)
	ctx := context.Background()

	gh := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"tag_name":"2.0"}`)
	}))
	defer gh.Close()
	oldBase := runner.GitHubAPIBase
	runner.GitHubAPIBase = gh.URL
	t.Cleanup(func() { runner.GitHubAPIBase = oldBase })

	runnerA := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"apps":[
			{"name":"radicale","currentVersion":"1.0","versionSource":{"type":"github","repo":"owner/notify-apps"}}
		]}`)
	}))
	defer runnerA.Close()
	insertAppRunner(t, database, 1, "a", runnerA.URL, 1)

	if _, err := database.Exec(
		"INSERT INTO discord_webhooks (user_id, webhook_url, enabled) VALUES (1, ?, 1)",
		"https://discord.com/api/webhooks/123456789/abcdefghijABCDEF0123456789"); err != nil {
		t.Fatalf("seed webhook: %v", err)
	}
	rec := &payloadRecorder{}
	webhookTransport = rec
	t.Cleanup(func() { webhookTransport = nil })

	if _, updated, err := svc.ScanRunnerApps(ctx, 1); err != nil || updated != 1 {
		t.Fatalf("first scan = %d/%v, want 1 update", updated, err)
	}
	if rec.count() != 1 {
		t.Fatalf("webhook deliveries = %d, want 1", rec.count())
	}
	embed := embedOf(rec.bodies[0])
	if embed["title"] != "🆕 Tracked Application Update Available" {
		t.Errorf("embed title = %v", embed["title"])
	}
	if !strings.Contains(marshalString(embed), "radicale") ||
		!strings.Contains(marshalString(embed), "2.0") {
		t.Errorf("embed missing app/version detail: %s", marshalString(embed))
	}

	// Second scan: same digest-less key (1:radicale:2.0) -> deduped.
	if _, updated, err := svc.ScanRunnerApps(ctx, 1); err != nil || updated != 1 {
		t.Fatalf("second scan = %d/%v, want 1 update", updated, err)
	}
	if rec.count() != 1 {
		t.Fatalf("second scan delivered %d extra webhooks, want 0 (dedup)", rec.count())
	}
}

func embedOf(payload map[string]any) map[string]any {
	embeds, _ := payload["embeds"].([]any)
	if len(embeds) == 0 {
		return map[string]any{}
	}
	e, _ := embeds[0].(map[string]any)
	return e
}

func marshalString(v any) string {
	buf, _ := json.Marshal(v)
	return string(buf)
}

// TestAppVersionAcquireGuard exercises the in-process + DB guard stack: a
// second acquire while one run holds the flag must fail, and completing the
// first run releases it.
func TestAppVersionAcquireGuard(t *testing.T) {
	svc, database := newAppVersionTestService(t)
	ctx := context.Background()

	runID, err := svc.AppVersionAcquire(ctx, 1, true)
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}
	if _, err := svc.AppVersionAcquire(ctx, 1, true); err == nil {
		t.Fatal("second acquire must fail while the first run holds the guard")
	}
	if err := svc.AppVersionExecuteAndComplete(ctx, 1, runID); err != nil {
		t.Fatalf("execute: %v", err)
	}
	var status string
	if err := database.QueryRowContext(ctx,
		"SELECT status FROM batch_runs WHERE id = ?", runID).Scan(&status); err != nil {
		t.Fatalf("read run: %v", err)
	}
	if status != "completed" {
		t.Fatalf("run status = %q, want completed", status)
	}
	if _, err := svc.AppVersionAcquire(ctx, 1, true); err != nil {
		t.Fatalf("acquire after completion must succeed: %v", err)
	}
}
