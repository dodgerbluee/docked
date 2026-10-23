package handlers

// Tests for the admin debug surface ported in phase 8b: gating
// (debug_endpoints_enabled), admin enforcement, the read-only SQL runner,
// lock/log introspection, and the runner debug proxy envelope handling.

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/dockedapp/backend/internal/auth"
	"github.com/dockedapp/backend/internal/config"
	"github.com/dockedapp/backend/internal/db"
)

func newDebugTestDB(t *testing.T) *sql.DB {
	t.Helper()
	return newDebugTestDBAt(t, t.TempDir()+"/debug-test.db")
}

func newDebugTestDBAt(t *testing.T, path string) *sql.DB {
	t.Helper()
	database, err := db.Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	stmts := []string{
		`CREATE TABLE users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT, password_hash TEXT, role TEXT,
			password_changed INTEGER DEFAULT 0, instance_admin INTEGER DEFAULT 0,
			email TEXT, last_login TEXT,
			oauth_provider TEXT, oauth_provider_id TEXT, token_version INTEGER NOT NULL DEFAULT 0,
			created_at TEXT DEFAULT CURRENT_TIMESTAMP,
			updated_at TEXT DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE runners (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			name TEXT NOT NULL, url TEXT NOT NULL, api_key TEXT NOT NULL,
			enabled INTEGER NOT NULL DEFAULT 1,
			version TEXT, latest_version TEXT, version_checked_at TEXT,
			docker_enabled INTEGER, last_seen TEXT,
			docker_status TEXT, docker_status_since TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE settings (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			key TEXT NOT NULL,
			value TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(user_id, key)
		)`,
	}
	for _, s := range stmts {
		if _, err := database.Exec(s); err != nil {
			t.Fatalf("create table: %v", err)
		}
	}
	if _, err := database.Exec(
		`INSERT INTO users (id, username, password_hash, role, instance_admin) VALUES
		 (1, 'admin', 'x', 'Administrator', 1), (2, 'member', 'x', 'Member', 0)`); err != nil {
		t.Fatalf("seed users: %v", err)
	}
	return database
}

func newDebugRouter(t *testing.T, database *sql.DB, cfg *config.Config) http.Handler {
	r := chi.NewRouter()
	r.Route("/api", func(r chi.Router) {
		r.Group(func(r chi.Router) {
			r.Use(auth.StrictMiddleware(testJWTSecret, database))
			r.Route("/debug", func(r chi.Router) {
				// The mount opens its own read-only pool; nothing else owns it.
				if closeFn := DebugRoutes(r, database, cfg, nil); closeFn != nil {
					t.Cleanup(closeFn)
				}
			})
		})
	})
	return r
}

func setDebugEnabled(t *testing.T, database *sql.DB, enabled bool) {
	t.Helper()
	value := "false"
	if enabled {
		value = "true"
	}
	if err := db.SetSystemSetting(t.Context(), database, "debug_endpoints_enabled", value); err != nil {
		t.Fatalf("set setting: %v", err)
	}
}

func tokenFor(t *testing.T, userID int64, username string) string {
	t.Helper()
	auth.SetSecret(testJWTSecret)
	token, _, err := auth.GenerateTokens(userID, username, "Administrator", 0)
	if err != nil {
		t.Fatalf("generate tokens: %v", err)
	}
	return token
}

func doDebugReq(t *testing.T, router http.Handler, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var rdr io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		rdr = bytes.NewReader(encoded)
	}
	req := httptest.NewRequest(method, path, rdr)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestDebugGateDisabled(t *testing.T) {
	database := newDebugTestDB(t)
	router := newDebugRouter(t, database, &config.Config{})
	rec := doDebugReq(t, router, http.MethodGet, "/api/debug/health", tokenFor(t, 1, "admin"), nil)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
	body := decodeBody(t, rec)
	if body["success"] != false || !strings.Contains(body["error"].(string), "Debug endpoints are disabled") {
		t.Fatalf("body = %v", body)
	}
}

func TestDebugRequiresInstanceAdmin(t *testing.T) {
	database := newDebugTestDB(t)
	setDebugEnabled(t, database, true)
	router := newDebugRouter(t, database, &config.Config{})

	rec := doDebugReq(t, router, http.MethodGet, "/api/debug/health", tokenFor(t, 2, "member"), nil)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rec.Code)
	}
	if msg := decodeBody(t, rec)["error"]; msg != "Instance admin access required" {
		t.Fatalf("error = %v", msg)
	}

	// No token at all → StrictMiddleware rejects.
	rec = doDebugReq(t, router, http.MethodGet, "/api/debug/health", "", nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestDebugHealth(t *testing.T) {
	database := newDebugTestDB(t)
	setDebugEnabled(t, database, true)
	router := newDebugRouter(t, database, &config.Config{})

	rec := doDebugReq(t, router, http.MethodGet, "/api/debug/health", tokenFor(t, 1, "admin"), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", rec.Code, rec.Body.String())
	}
	body := decodeBody(t, rec)
	if body["success"] != true || body["status"] != "ok" {
		t.Fatalf("body = %v", body)
	}
	if nv, _ := body["nodeVersion"].(string); !strings.HasPrefix(nv, "go") {
		t.Fatalf("nodeVersion = %v, want go runtime version", body["nodeVersion"])
	}
	stats, _ := body["db"].(map[string]any)
	if tables, _ := stats["tables"].(float64); tables < 3 {
		t.Fatalf("db.tables = %v, want >= 3", stats["tables"])
	}
	if locks, _ := body["upgradeLocks"].(float64); locks != 0 {
		t.Fatalf("upgradeLocks = %v, want 0", body["upgradeLocks"])
	}
}

func TestDebugLocks(t *testing.T) {
	database := newDebugTestDB(t)
	setDebugEnabled(t, database, true)
	router := newDebugRouter(t, database, &config.Config{})

	ok, err := db.AcquireUpgradeLock(t.Context(), database, "image:nginx:latest", "op-1")
	if err != nil || !ok {
		t.Fatalf("acquire lock: ok=%v err=%v", ok, err)
	}

	rec := doDebugReq(t, router, http.MethodGet, "/api/debug/locks", tokenFor(t, 1, "admin"), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", rec.Code, rec.Body.String())
	}
	body := decodeBody(t, rec)
	if count, _ := body["count"].(float64); count != 1 {
		t.Fatalf("count = %v, want 1", body["count"])
	}
	locks, _ := body["locks"].([]any)
	entry, _ := locks[0].(map[string]any)
	if entry["key"] != "image:nginx:latest" || entry["owner"] != "op-1" {
		t.Fatalf("locks[0] = %v", entry)
	}
}

func TestDebugDBQuery(t *testing.T) {
	// One path for both handles: t.TempDir() mints a NEW dir per call, so the
	// fixture and cfg.DBPath must share a single captured path or the
	// read-only handle opens a file that does not exist.
	dbPath := t.TempDir() + "/debug-test.db"
	database := newDebugTestDBAt(t, dbPath)
	setDebugEnabled(t, database, true)
	router := newDebugRouter(t, database, &config.Config{DBPath: dbPath})
	admin := tokenFor(t, 1, "admin")

	// Named catalog query.
	rec := doDebugReq(t, router, http.MethodPost, "/api/debug/db", admin, map[string]any{"query": "list-tables"})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", rec.Code, rec.Body.String())
	}
	body := decodeBody(t, rec)
	rows, _ := body["rows"].([]any)
	found := false
	for _, raw := range rows {
		if row, _ := raw.(map[string]any); row["name"] == "users" {
			found = true
		}
	}
	if !found || body["query"] != "list-tables" {
		t.Fatalf("rows missing users table: %v", body)
	}

	// Raw read-only SQL with a param (float64 → int64 coercion).
	rec = doDebugReq(t, router, http.MethodPost, "/api/debug/db", admin,
		map[string]any{"sql": "SELECT username FROM users WHERE id = ?", "params": []any{2}})
	body = decodeBody(t, rec)
	rows, _ = body["rows"].([]any)
	if rec.Code != http.StatusOK || len(rows) != 1 {
		t.Fatalf("raw query: status=%d body=%v", rec.Code, body)
	}
	if row, _ := rows[0].(map[string]any); row["username"] != "member" {
		t.Fatalf("row = %v", row)
	}

	// Raw write rejected.
	rec = doDebugReq(t, router, http.MethodPost, "/api/debug/db", admin,
		map[string]any{"sql": "DELETE FROM users"})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}

	// Prefix-guard bypasses: WITH...INSERT and PRAGMA writes pass the string
	// allowlist but must be rejected by the read-only connection.
	rec = doDebugReq(t, router, http.MethodPost, "/api/debug/db", admin,
		map[string]any{"sql": "WITH x AS (SELECT 'evil' AS u) INSERT INTO users (username) SELECT u FROM x"})
	if rec.Code == http.StatusOK {
		t.Fatalf("WITH...INSERT must not execute on the read-only handle: %s", rec.Body.String())
	}
	rec = doDebugReq(t, router, http.MethodPost, "/api/debug/db", admin,
		map[string]any{"sql": "PRAGMA user_version = 5"})
	if rec.Code == http.StatusOK {
		t.Fatalf("PRAGMA write must not execute on the read-only handle: %s", rec.Body.String())
	}

	// Unknown named query lists the catalog.
	rec = doDebugReq(t, router, http.MethodPost, "/api/debug/db", admin, map[string]any{"query": "nope"})
	body = decodeBody(t, rec)
	if rec.Code != http.StatusBadRequest || body["available"] == nil {
		t.Fatalf("body = %v", body)
	}

	// Neither sql nor query.
	rec = doDebugReq(t, router, http.MethodPost, "/api/debug/db", admin, map[string]any{})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}

	// Catalog listing.
	rec = doDebugReq(t, router, http.MethodGet, "/api/debug/db/queries", admin, nil)
	body = decodeBody(t, rec)
	queries, _ := body["queries"].([]any)
	if rec.Code != http.StatusOK || len(queries) != len(dbQueryOrder) {
		t.Fatalf("body = %v", body)
	}
}

func TestDebugLogs(t *testing.T) {
	logsDir := t.TempDir()
	if err := os.WriteFile(logsDir+"/combined.log",
		[]byte("line1\nline2\n\nline3\n"), 0o644); err != nil {
		t.Fatalf("write log: %v", err)
	}
	database := newDebugTestDB(t)
	setDebugEnabled(t, database, true)
	cfg := &config.Config{}
	cfg.Edge.LogsDir = logsDir
	router := newDebugRouter(t, database, cfg)
	admin := tokenFor(t, 1, "admin")

	// Node's slice(-lines) counts the empty string after the trailing
	// newline, so lines=4 keeps line2 + line3 after the blank filter.
	rec := doDebugReq(t, router, http.MethodGet, "/api/debug/logs?lines=4", admin, nil)
	body := decodeBody(t, rec)
	lines, _ := body["lines"].([]any)
	if rec.Code != http.StatusOK || len(lines) != 2 || lines[0] != "line2" || lines[1] != "line3" {
		t.Fatalf("body = %v", body)
	}

	// Blank lines filtered, error.log allowlisted but absent.
	rec = doDebugReq(t, router, http.MethodGet, "/api/debug/logs?file=error.log", admin, nil)
	body = decodeBody(t, rec)
	if rec.Code != http.StatusOK || body["note"] != "Log file not found" {
		t.Fatalf("body = %v", body)
	}

	// Path traversal / non-allowlisted file rejected.
	rec = doDebugReq(t, router, http.MethodGet, "/api/debug/logs?file=../secret.log", admin, nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestDebugCacheStateAndClear(t *testing.T) {
	database := newDebugTestDB(t)
	setDebugEnabled(t, database, true)
	router := newDebugRouter(t, database, &config.Config{})
	admin := tokenFor(t, 1, "admin")

	rec := doDebugReq(t, router, http.MethodGet, "/api/debug/cache", admin, nil)
	body := decodeBody(t, rec)
	caches, _ := body["caches"].(map[string]any)
	if rec.Code != http.StatusOK || caches == nil {
		t.Fatalf("body = %v", body)
	}
	if _, ok := caches["imagesyncReleaseCache"]; !ok {
		t.Fatalf("caches = %v", caches)
	}
	if body["timestamp"] == nil {
		t.Fatalf("timestamp missing: %v", body)
	}

	rec = doDebugReq(t, router, http.MethodPost, "/api/debug/cache/clear", admin, nil)
	body = decodeBody(t, rec)
	if rec.Code != http.StatusOK || body["message"] != "All caches cleared" {
		t.Fatalf("body = %v", body)
	}
}

func TestDebugRunnerProxy(t *testing.T) {
	stub := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/debug/health":
			w.Header().Set("Content-Type", "application/json")
			io.WriteString(w, `{"ok":true,"uptime":12}`)
		case "/debug/boom":
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			io.WriteString(w, `{"message":"no such debug route","details":{"path":"/debug/boom"}}`)
		default:
			w.WriteHeader(http.StatusNotFound)
			io.WriteString(w, "plain text")
		}
	}))
	t.Cleanup(stub.Close)

	database := newDebugTestDB(t)
	setDebugEnabled(t, database, true)
	if _, err := database.Exec(
		`INSERT INTO runners (id, user_id, name, url, api_key) VALUES (1, 1, 'plexy', ?, 'runner-key')`,
		stub.URL); err != nil {
		t.Fatalf("seed runner: %v", err)
	}
	router := newDebugRouter(t, database, &config.Config{})
	admin := tokenFor(t, 1, "admin")

	// 2xx: payload gains success:true.
	rec := doDebugReq(t, router, http.MethodGet, "/api/debug/runner/1/health", admin, nil)
	body := decodeBody(t, rec)
	if rec.Code != http.StatusOK || body["success"] != true || body["ok"] != true {
		t.Fatalf("status=%d body=%v", rec.Code, body)
	}

	// 4xx: collapses to the error envelope (message → error), details kept.
	rec = doDebugReq(t, router, http.MethodGet, "/api/debug/runner/1/boom", admin, nil)
	body = decodeBody(t, rec)
	if rec.Code != http.StatusNotFound || body["success"] != false ||
		body["error"] != "no such debug route" || body["details"] == nil {
		t.Fatalf("status=%d body=%v", rec.Code, body)
	}

	// Non-JSON runner answer → generic envelope.
	rec = doDebugReq(t, router, http.MethodGet, "/api/debug/runner/1/other", admin, nil)
	body = decodeBody(t, rec)
	if rec.Code != http.StatusNotFound || body["error"] != "An error occurred" {
		t.Fatalf("status=%d body=%v", rec.Code, body)
	}

	// Unknown runner → 404.
	rec = doDebugReq(t, router, http.MethodGet, "/api/debug/runner/99/health", admin, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}

	// Runner without API key → 400.
	if _, err := database.Exec(
		`INSERT INTO runners (id, user_id, name, url, api_key) VALUES (2, 1, 'keyless', 'http://127.0.0.1:1', '')`); err != nil {
		t.Fatalf("seed keyless runner: %v", err)
	}
	rec = doDebugReq(t, router, http.MethodGet, "/api/debug/runner/2/health", admin, nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

// Every named query in the debug DB catalog must execute against the real
// migrated schema. Several catalog queries were inherited from Node with
// columns/tables that no longer exist; this test keeps them honest as the
// schema evolves.
func TestDBQueryCatalogMatchesMigratedSchema(t *testing.T) {
	database, err := db.Open(t.TempDir() + "/catalog-schema.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	if err := db.Migrate(context.Background(), database); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	for _, name := range dbQueryOrder {
		sqlText, ok := dbQueryCatalog[name]
		if !ok {
			t.Fatalf("catalog order entry %q has no query", name)
		}
		rows, err := database.QueryContext(context.Background(), sqlText)
		if err != nil {
			t.Errorf("catalog query %q fails against migrated schema: %v", name, err)
			continue
		}
		rows.Close()
	}
}
