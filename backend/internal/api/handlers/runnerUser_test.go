package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/dockedapp/backend/internal/api/middleware"
	"github.com/dockedapp/backend/internal/auth"
)

// Tests for the browser-facing runner proxy routes migrated in phase-4
// commit B (operations/apps listings, app history, and the three SSE
// streams). Reuses the DB and auth scaffolding from runnerAPI_test.go.

func newRunnerUserTestRouter(database *sql.DB) http.Handler {
	writeLimiter := middleware.NewRateLimiter(1000, time.Hour, 100)
	destructiveLimiter := middleware.NewRateLimiter(1000, time.Hour, 100)

	r := chi.NewRouter()
	r.Route("/api", func(r chi.Router) {
		r.Group(func(r chi.Router) {
			r.Use(auth.StrictMiddleware(testJWTSecret, database))
			r.Get("/runners/enrollment-status", EnrollmentStatus(database))

			r.Get("/runners/{runnerId}/operations", RunnerOperations(database))
			r.With(middleware.RateLimit(writeLimiter, middleware.RESTTooManyRequests)).
				Post("/runners/{runnerId}/operations/{name}/run", RunRunnerOperation(database))
			r.Get("/runners/{runnerId}/apps", RunnerApps(database))
			r.Get("/runners/{runnerId}/apps/history", RunnerAppsHistory(database))
			r.With(middleware.RateLimit(writeLimiter, middleware.RESTTooManyRequests)).
				Post("/runners/{runnerId}/apps/{appName}/operations/{opName}/run", RunRunnerAppOperation(database))
			r.With(middleware.RateLimit(destructiveLimiter, middleware.RESTTooManyRequests)).
				Post("/runners/{runnerId}/containers/{containerId}/upgrade", RunnerUpgradeStream(database))
		})
	})
	return r
}

// stubRunner is a minimal dockhand HTTP API: JSON listings plus SSE streams.
// seenAuth records the Authorization header of the last request so tests can
// pin the runner-side credential handling.
type stubRunner struct {
	srv        *httptest.Server
	mu         sync.Mutex
	seenAuth   string
	limitSeen  string
	opsJSON    string // overrides the default /operations payload
	upgradeDur time.Duration
	upgradeSig chan struct{} // signaled once the upgrade stream starts (if non-nil)
}

func newStubRunner(t *testing.T) *stubRunner {
	t.Helper()
	s := &stubRunner{}
	s.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		s.seenAuth = r.Header.Get("Authorization")
		s.mu.Unlock()

		switch {
		case r.URL.Path == "/operations" && r.Method == http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			if s.opsJSON != "" {
				io.WriteString(w, s.opsJSON)
			} else {
				io.WriteString(w, `{"operations":[
					{"name":"deploy","versionSource":{"type":"github","repo":"owner/repo"}},
					{"name":"restart","versionSource":{"type":"command"}},
					{"name":"plain"}]}`)
			}
		case r.URL.Path == "/apps" && r.Method == http.MethodGet:
			w.Header().Set("Content-Type", "application/json")
			io.WriteString(w, `{"apps":[{"name":"stirling","versionSource":{"type":"github","repo":"owner/stirling"}}]}`)
		case r.URL.Path == "/apps/history" && r.Method == http.MethodGet:
			s.mu.Lock()
			s.limitSeen = r.URL.Query().Get("limit")
			s.mu.Unlock()
			w.Header().Set("Content-Type", "application/json")
			io.WriteString(w, `{"history":[{"app":"stirling","operation":"update","status":"success"}]}`)
		case strings.HasSuffix(r.URL.Path, "/upgrade") && r.Method == http.MethodPost:
			w.Header().Set("Content-Type", "text/event-stream")
			w.WriteHeader(200)
			rc := http.NewResponseController(w)
			io.WriteString(w, "event: progress\ndata: {\"step\":\"pull\"}\n\n")
			rc.Flush()
			if s.upgradeSig != nil {
				s.upgradeSig <- struct{}{}
			}
			time.Sleep(s.upgradeDur)
			io.WriteString(w, "event: complete\ndata: {\"status\":\"done\"}\n\n")
			rc.Flush()
		case strings.HasSuffix(r.URL.Path, "/run") && r.Method == http.MethodPost:
			w.Header().Set("Content-Type", "text/event-stream")
			w.WriteHeader(200)
			rc := http.NewResponseController(w)
			io.WriteString(w, "event: log\ndata: {\"line\":\"hello\"}\n\n")
			rc.Flush()
		default:
			w.WriteHeader(http.StatusNotFound)
			io.WriteString(w, `{"error":"no such route"}`)
		}
	}))
	t.Cleanup(s.srv.Close)
	return s
}

func seedRunner(t *testing.T, database *sql.DB, url string, enabled int) int64 {
	t.Helper()
	res, err := database.Exec(
		`INSERT INTO runners (user_id, name, url, api_key, enabled) VALUES (1, 'testrunner', ?, 'rk-test', ?)`,
		url, enabled)
	if err != nil {
		t.Fatalf("seed runner: %v", err)
	}
	id, _ := res.LastInsertId()
	return id
}

func doRaw(t *testing.T, h http.Handler, req *http.Request) (int, string, http.Header) {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	body, _ := io.ReadAll(rec.Body)
	return rec.Code, string(body), rec.Header()
}

func TestRunnerOperationsEnrich(t *testing.T) {
	database := newRunnerTestDB(t)
	stub := newStubRunner(t)
	seedRunner(t, database, stub.srv.URL, 1)
	stubGitHub(t, "v1.2.3")

	h := newRunnerUserTestRouter(database)
	token := accessToken(t, 1)

	code, out := getJSON(t, h, "/api/runners/1/operations", token)
	if code != 200 {
		t.Fatalf("status = %d, body = %v", code, out)
	}
	if out["success"] != true {
		t.Fatalf("success = %v", out["success"])
	}
	ops, _ := out["operations"].([]any)
	if len(ops) != 3 {
		t.Fatalf("operations = %v", out["operations"])
	}
	first := ops[0].(map[string]any)
	if first["latestVersion"] != "v1.2.3" {
		t.Errorf("github-sourced op latestVersion = %v, want v1.2.3", first["latestVersion"])
	}
	if _, ok := ops[1].(map[string]any)["latestVersion"]; ok {
		t.Error("command-sourced op must not get a latestVersion key")
	}
	if _, ok := ops[2].(map[string]any)["latestVersion"]; ok {
		t.Error("versionSource-less op must not get a latestVersion key")
	}
	stub.mu.Lock()
	defer stub.mu.Unlock()
	if stub.seenAuth != "Bearer rk-test" {
		t.Errorf("runner auth header = %q", stub.seenAuth)
	}
}

func TestRunnerOperationsGitHubFailureNull(t *testing.T) {
	database := newRunnerTestDB(t)
	stub := newStubRunner(t)
	// Distinct repo so the 1h release cache from other tests can't mask the
	// forced-failure stub.
	stub.opsJSON = `{"operations":[{"name":"deploy","versionSource":{"type":"github","repo":"owner/failrepo"}}]}`
	seedRunner(t, database, stub.srv.URL, 1)
	stubGitHub(t, "") // release lookup fails → latestVersion: null

	h := newRunnerUserTestRouter(database)
	code, out := getJSON(t, h, "/api/runners/1/operations", accessToken(t, 1))
	if code != 200 {
		t.Fatalf("status = %d", code)
	}
	ops := out["operations"].([]any)
	v, ok := ops[0].(map[string]any)["latestVersion"]
	if !ok || v != nil {
		t.Errorf("latestVersion = %v (present=%v), want null", v, ok)
	}
}

func TestRunnerUpstreamAuthMaskedAsBadGateway(t *testing.T) {
	database := newRunnerTestDB(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		io.WriteString(w, `{"error":"bad key"}`)
	}))
	t.Cleanup(upstream.Close)
	seedRunner(t, database, upstream.URL, 1)

	h := newRunnerUserTestRouter(database)
	code, out := getJSON(t, h, "/api/runners/1/operations", accessToken(t, 1))
	// Node masks upstream 401/403 as 502 so the client's logout interceptor
	// never fires for a misconfigured runner key.
	if code != 502 {
		t.Fatalf("status = %d, want 502", code)
	}
	if out["errorCode"] != "RUNNER_CONNECTION_ERROR" {
		t.Errorf("errorCode = %v", out["errorCode"])
	}
	if !strings.HasPrefix(out["error"].(string), "Runner connection error: ") {
		t.Errorf("error = %v", out["error"])
	}
}

func TestRunnerUserRoutesNotFoundAndDisabled(t *testing.T) {
	database := newRunnerTestDB(t)
	stub := newStubRunner(t)
	disabledID := seedRunner(t, database, stub.srv.URL, 0)

	h := newRunnerUserTestRouter(database)
	token := accessToken(t, 1)

	for _, path := range []string{"/api/runners/999/operations", "/api/runners/999/apps"} {
		code, out := getJSON(t, h, path, token)
		if code != 404 || out["error"] != "Runner not found" {
			t.Errorf("%s: got %d %v", path, code, out)
		}
	}
	code, out := getJSON(t, h, fmt.Sprintf("/api/runners/%d/apps", disabledID), token)
	if code != 400 || out["error"] != "Runner is disabled" {
		t.Errorf("disabled runner: got %d %v", code, out)
	}
}

func TestRunnerAppsHistoryLimitAndAttribution(t *testing.T) {
	database := newRunnerTestDB(t)
	stub := newStubRunner(t)
	id := seedRunner(t, database, stub.srv.URL, 1)

	h := newRunnerUserTestRouter(database)
	token := accessToken(t, 1)

	code, out := getJSON(t, h, "/api/runners/1/apps/history?limit=5", token)
	if code != 200 {
		t.Fatalf("status = %d", code)
	}
	hist, _ := out["history"].([]any)
	if len(hist) != 1 {
		t.Fatalf("history = %v", out["history"])
	}
	rec := hist[0].(map[string]any)
	if rec["runnerId"] != float64(id) || rec["runnerName"] != "testrunner" {
		t.Errorf("attribution = %v / %v", rec["runnerId"], rec["runnerName"])
	}
	stub.mu.Lock()
	if stub.limitSeen != "5" {
		t.Errorf("runner saw limit = %q, want 5", stub.limitSeen)
	}
	stub.mu.Unlock()

	// Missing and unparseable limits both fall back to 100 (Node's || 100).
	for _, q := range []string{"", "?limit=abc", "?limit=0"} {
		code, _ = getJSON(t, h, "/api/runners/1/apps/history"+q, token)
		if code != 200 {
			t.Fatalf("query %q: status = %d", q, code)
		}
		stub.mu.Lock()
		if stub.limitSeen != "100" {
			t.Errorf("query %q: runner saw limit = %q, want 100", q, stub.limitSeen)
		}
		stub.mu.Unlock()
	}
}

func TestRunnerOperationRunSSE(t *testing.T) {
	database := newRunnerTestDB(t)
	stub := newStubRunner(t)
	seedRunner(t, database, stub.srv.URL, 1)

	h := newRunnerUserTestRouter(database)
	req := httptest.NewRequest(http.MethodPost, "/api/runners/1/operations/deploy/run", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken(t, 1))
	code, body, hdr := doRaw(t, h, req)
	if code != 200 {
		t.Fatalf("status = %d, body = %s", code, body)
	}
	if ct := hdr.Get("Content-Type"); ct != "text/event-stream" {
		t.Errorf("content-type = %q", ct)
	}
	if !strings.Contains(body, "event: log") {
		t.Errorf("body = %q", body)
	}
}

func TestRunnerAppOperationRunSSE(t *testing.T) {
	database := newRunnerTestDB(t)
	stub := newStubRunner(t)
	seedRunner(t, database, stub.srv.URL, 1)

	h := newRunnerUserTestRouter(database)
	req := httptest.NewRequest(http.MethodPost, "/api/runners/1/apps/stirling/operations/update/run", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken(t, 1))
	code, body, _ := doRaw(t, h, req)
	if code != 200 || !strings.Contains(body, "event: log") {
		t.Fatalf("status = %d, body = %s", code, body)
	}
}

func TestRunnerUpgradeStreamLockLifecycle(t *testing.T) {
	database := newRunnerTestDB(t)
	stub := newStubRunner(t)
	seedRunner(t, database, stub.srv.URL, 1)
	stub.upgradeSig = make(chan struct{}, 1)
	stub.upgradeDur = 300 * time.Millisecond

	h := newRunnerUserTestRouter(database)
	token := accessToken(t, 1)

	type result struct {
		code int
		body string
	}
	done := make(chan result, 1)
	go func() {
		req := httptest.NewRequest(http.MethodPost, "/api/runners/1/containers/abc123/upgrade", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		code, body, _ := doRaw(t, h, req)
		done <- result{code, body}
	}()

	// Once the runner stream started, the lock is definitely held: a second
	// upgrade on the same container must be rejected with the holder named.
	select {
	case <-stub.upgradeSig:
	case <-time.After(5 * time.Second):
		t.Fatal("upgrade stream never started")
	}

	code, out := postJSON(t, h, "/api/runners/1/containers/abc123/upgrade", map[string]any{}, token)
	if code != 409 {
		t.Fatalf("second upgrade: status = %d, want 409 (%v)", code, out)
	}
	if !strings.Contains(out["error"].(string), "locked by runner-sse") {
		t.Errorf("409 error = %v", out["error"])
	}

	res := <-done
	if res.code != 200 || !strings.Contains(res.body, "event: complete") {
		t.Fatalf("first upgrade: status = %d, body = %s", res.code, res.body)
	}

	// Lock released after the stream ends.
	var count int
	if err := database.QueryRow(`SELECT COUNT(*) FROM upgrade_locks`).Scan(&count); err != nil {
		t.Fatalf("count locks: %v", err)
	}
	if count != 0 {
		t.Errorf("upgrade_locks rows after stream = %d, want 0", count)
	}
}

func TestRunnerUpgradeLockHeldByOtherOwner(t *testing.T) {
	database := newRunnerTestDB(t)
	stub := newStubRunner(t)
	seedRunner(t, database, stub.srv.URL, 1)

	// A live lock held by the intent engine blocks the SSE route and the
	// holder is named (minus the uuid suffix) in the conflict message. The
	// key is name-scoped (see db.UpgradeLockKey); with no persisted row for
	// abc123 the handler falls back to the container id.
	_, err := database.Exec(
		`INSERT INTO upgrade_locks (target_key, owner, expires_at)
		 VALUES ('runner:1:name:abc123', 'intent:42:deadbeef-0000-0000-0000-000000000000', datetime('now','+5 minutes'))`)
	if err != nil {
		t.Fatalf("seed lock: %v", err)
	}

	h := newRunnerUserTestRouter(database)
	code, out := postJSON(t, h, "/api/runners/1/containers/abc123/upgrade", map[string]any{}, accessToken(t, 1))
	if code != 409 {
		t.Fatalf("status = %d, want 409", code)
	}
	if out["error"] != "Upgrade already in progress (locked by intent:42)" {
		t.Errorf("error = %v", out["error"])
	}
}

func TestRunnerSSEConnectFailureIsErrorEvent(t *testing.T) {
	database := newRunnerTestDB(t)
	// Port 1: connect refused immediately.
	seedRunner(t, database, "http://127.0.0.1:1", 1)

	h := newRunnerUserTestRouter(database)
	req := httptest.NewRequest(http.MethodPost, "/api/runners/1/operations/deploy/run", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken(t, 1))
	code, body, _ := doRaw(t, h, req)
	// Headers flush before the upstream is attempted, so failures arrive as
	// an SSE error event on a 200 — never an HTTP error status.
	if code != 200 {
		t.Fatalf("status = %d, want 200", code)
	}
	if !strings.Contains(body, "event: error") {
		t.Errorf("body = %q", body)
	}
	var envelope map[string]any
	dataLine := strings.TrimPrefix(strings.Split(body, "data: ")[1], "")
	if err := json.Unmarshal([]byte(strings.TrimSpace(dataLine)), &envelope); err != nil {
		t.Fatalf("error event not JSON: %v", err)
	}
	if _, ok := envelope["message"].(string); !ok {
		t.Errorf("error event = %v", envelope)
	}
}
