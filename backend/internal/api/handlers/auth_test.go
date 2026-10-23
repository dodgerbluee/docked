package handlers

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/dockedapp/backend/internal/auth"
	"github.com/dockedapp/backend/internal/db"
)

// Tests for the REST auth/export/avatar handlers ported from Node's
// authController.js and avatarController.js (phase 7). The router mirrors
// the mount in api/server.go.

const authTestSecret = "auth-handler-test-secret"

func newAuthTestDB(t *testing.T) *sql.DB {
	t.Helper()
	database, err := db.Open(t.TempDir() + "/auth-test.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	stmts := []string{
		`CREATE TABLE users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT UNIQUE NOT NULL,
			password_hash TEXT,
			email TEXT,
			role TEXT DEFAULT 'Administrator',
			password_changed INTEGER DEFAULT 0,
			instance_admin INTEGER DEFAULT 0,
			verification_token TEXT,
			last_login TEXT,
			oauth_provider TEXT, oauth_provider_id TEXT, token_version INTEGER NOT NULL DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE settings (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			key TEXT NOT NULL,
			value TEXT,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(user_id, key)
		)`,
		`CREATE TABLE batch_config (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL, job_type TEXT NOT NULL,
			enabled INTEGER DEFAULT 0, interval_minutes INTEGER DEFAULT 60,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(user_id, job_type)
		)`,
		`CREATE TABLE discord_webhooks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER,
			webhook_url TEXT NOT NULL,
			server_name TEXT, channel_name TEXT, name TEXT,
			enabled INTEGER DEFAULT 1,
			avatar_url TEXT, guild_id TEXT, channel_id TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE tracked_apps (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			name TEXT NOT NULL,
			image_name TEXT, github_repo TEXT,
			source_type TEXT DEFAULT 'docker',
			current_version TEXT, current_digest TEXT,
			latest_version TEXT, latest_digest TEXT,
			has_update INTEGER DEFAULT 0,
			current_version_publish_date TEXT, latest_version_publish_date TEXT,
			last_checked TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			repository_token_id INTEGER, gitlab_token TEXT
		)`,
		`CREATE TABLE source_instances (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			name TEXT NOT NULL, url TEXT NOT NULL,
			username TEXT DEFAULT '', password TEXT DEFAULT '', api_key TEXT,
			auth_type TEXT DEFAULT 'apikey',
			display_order INTEGER DEFAULT 0,
			ip_address TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE docker_hub_credentials (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			username TEXT, token TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		// revoked_tokens is already ensured by db.Open itself.
	}
	for _, s := range stmts {
		if _, err := database.Exec(s); err != nil {
			t.Fatalf("create table: %v", err)
		}
	}
	return database
}

func newAuthTestRouter(database *sql.DB) http.Handler {
	r := chi.NewRouter()
	r.Route("/api", func(r chi.Router) {
		r.Post("/auth/login", Login(database, nil))
		r.Post("/auth/create-user-with-config", CreateUserWithConfig(database, authTestSecret))
		r.Get("/auth/verify", VerifyToken(database, authTestSecret))
		r.Group(func(r chi.Router) {
			r.Use(auth.StrictMiddleware(authTestSecret, database))
			r.Get("/auth/export-users", ExportUsers(database))
			r.Get("/user/export-config", ExportUserConfig(database))
			r.Post("/auth/logout", Logout(database, authTestSecret))
			r.Get("/avatars", GetAvatar(database))
			r.Get("/avatars/user/{userId}", GetAvatarByUserId(database))
			r.Get("/avatars/recent", GetRecentAvatars(database))
			r.Get("/avatars/recent/{filename}", GetRecentAvatar(database))
		})
	})
	return r
}

func seedUser(t *testing.T, database *sql.DB, username, password string, instanceAdmin int) int64 {
	t.Helper()
	hash, err := auth.HashPassword(password)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	res, err := database.Exec(
		`INSERT INTO users (username, password_hash, role, instance_admin) VALUES (?, ?, 'Administrator', ?)`,
		username, hash, instanceAdmin)
	if err != nil {
		t.Fatalf("seed user: %v", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		t.Fatalf("last id: %v", err)
	}
	return id
}

func doJSON(t *testing.T, h http.Handler, method, path string, body any, token string) (int, map[string]any) {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			t.Fatalf("encode: %v", err)
		}
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)

	out := map[string]any{}
	if rec.Body.Len() > 0 {
		if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
			t.Fatalf("decode response %q: %v", rec.Body.String(), err)
		}
	}
	return rec.Code, out
}

func TestLoginAndVerify(t *testing.T) {
	auth.SetSecret(authTestSecret)
	database := newAuthTestDB(t)
	h := newAuthTestRouter(database)

	seedUser(t, database, "alice", "password123", 1)
	if _, err := database.Exec(
		`INSERT INTO users (username, password_hash, oauth_provider, role) VALUES ('ssouser', NULL, 'authentik', 'Member')`); err != nil {
		t.Fatalf("seed sso user: %v", err)
	}

	// Missing fields: Node's validateRequiredFields envelope.
	code, body := doJSON(t, h, http.MethodPost, "/api/auth/login", map[string]any{}, "")
	if code != http.StatusBadRequest {
		t.Fatalf("missing fields: got %d", code)
	}
	if body["error"] != "Missing required fields: username, password" {
		t.Fatalf("missing fields: error = %v", body["error"])
	}
	if mf, _ := body["missingFields"].([]any); len(mf) != 2 {
		t.Fatalf("missing fields: missingFields = %v", body["missingFields"])
	}

	// Unknown user and wrong password share one message.
	for _, creds := range []map[string]any{
		{"username": "ghost", "password": "password123"},
		{"username": "alice", "password": "wrongpass1"},
	} {
		code, body = doJSON(t, h, http.MethodPost, "/api/auth/login", creds, "")
		if code != http.StatusUnauthorized || body["error"] != "Invalid username or password" {
			t.Fatalf("bad creds: code=%d body=%v", code, body)
		}
	}

	// OAuth-only account gets the SSO hint.
	code, body = doJSON(t, h, http.MethodPost, "/api/auth/login",
		map[string]any{"username": "ssouser", "password": "whatever1"}, "")
	if code != http.StatusUnauthorized ||
		body["error"] != "This account uses SSO. Please sign in with authentik." {
		t.Fatalf("sso user: code=%d body=%v", code, body)
	}

	// Success path.
	code, body = doJSON(t, h, http.MethodPost, "/api/auth/login",
		map[string]any{"username": "alice", "password": "password123"}, "")
	if code != http.StatusOK || body["success"] != true {
		t.Fatalf("login: code=%d body=%v", code, body)
	}
	token, _ := body["token"].(string)
	refresh, _ := body["refreshToken"].(string)
	if token == "" || refresh == "" {
		t.Fatalf("login: missing tokens: %v", body)
	}
	if body["username"] != "alice" || body["instanceAdmin"] != true {
		t.Fatalf("login: payload = %v", body)
	}
	var lastLogin string
	if err := database.QueryRow("SELECT last_login FROM users WHERE username = 'alice'").Scan(&lastLogin); err != nil || lastLogin == "" {
		t.Fatalf("last_login not stamped: %v %q", err, lastLogin)
	}

	// Verify: must honor the same session-eviction checks as the auth
	// middleware (revoked tokens, password-change token versions).
	code, body = doJSON(t, h, http.MethodGet, "/api/auth/verify", nil, token)
	if code != http.StatusOK || body["username"] != "alice" || body["instanceAdmin"] != true {
		t.Fatalf("verify: code=%d body=%v", code, body)
	}
	code, body = doJSON(t, h, http.MethodGet, "/api/auth/verify", nil, "")
	if code != http.StatusUnauthorized || body["error"] != "No token provided" {
		t.Fatalf("verify empty: code=%d body=%v", code, body)
	}
	code, body = doJSON(t, h, http.MethodGet, "/api/auth/verify", nil, "garbage.token.here")
	if code != http.StatusUnauthorized || body["error"] != "Invalid token" {
		t.Fatalf("verify garbage: code=%d body=%v", code, body)
	}

	// Revoked token: verify must reject it, or it becomes a revocation
	// oracle bypass for the client's boot check.
	if err := db.RevokeToken(context.Background(), database, token, 1, 1<<40); err != nil {
		t.Fatalf("revoke: %v", err)
	}
	code, body = doJSON(t, h, http.MethodGet, "/api/auth/verify", nil, token)
	if code != http.StatusUnauthorized || body["error"] != "Invalid token" {
		t.Fatalf("verify revoked: code=%d body=%v", code, body)
	}

	// Token minted before a password change carries a stale version.
	fresh, _, err := auth.GenerateTokens(1, "alice", "Administrator", 0)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if _, err := database.Exec(`UPDATE users SET token_version = 5 WHERE username = 'alice'`); err != nil {
		t.Fatalf("bump version: %v", err)
	}
	code, body = doJSON(t, h, http.MethodGet, "/api/auth/verify", nil, fresh)
	if code != http.StatusUnauthorized || body["error"] != "Invalid token" {
		t.Fatalf("verify stale-version: code=%d body=%v", code, body)
	}

	// Token whose user was deleted.
	deadToken, _, err := auth.GenerateTokens(999, "ghost", "Member", 0)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	code, body = doJSON(t, h, http.MethodGet, "/api/auth/verify", nil, deadToken)
	if code != http.StatusUnauthorized || body["error"] != "User not found" {
		t.Fatalf("verify dead: code=%d body=%v", code, body)
	}
}

func TestLogoutRevokes(t *testing.T) {
	auth.SetSecret(authTestSecret)
	database := newAuthTestDB(t)
	h := newAuthTestRouter(database)
	seedUser(t, database, "alice", "password123", 1)

	code, body := doJSON(t, h, http.MethodPost, "/api/auth/login",
		map[string]any{"username": "alice", "password": "password123"}, "")
	if code != http.StatusOK {
		t.Fatalf("login: code=%d", code)
	}
	token, _ := body["token"].(string)
	refresh, _ := body["refreshToken"].(string)

	code, body = doJSON(t, h, http.MethodPost, "/api/auth/logout",
		map[string]any{"refreshToken": refresh}, token)
	if code != http.StatusOK || body["message"] != "Logged out" {
		t.Fatalf("logout: code=%d body=%v", code, body)
	}

	for _, tok := range []string{token, refresh} {
		revoked, err := db.IsTokenRevoked(context.Background(), database, tok)
		if err != nil || !revoked {
			t.Fatalf("token not revoked: %v %v", revoked, err)
		}
	}

	// StrictMiddleware now rejects the revoked access token.
	code, _ = doJSON(t, h, http.MethodPost, "/api/auth/logout", map[string]any{}, token)
	if code != http.StatusUnauthorized {
		t.Fatalf("revoked token accepted: %d", code)
	}
}

func TestCreateUserWithConfigGates(t *testing.T) {
	auth.SetSecret(authTestSecret)
	database := newAuthTestDB(t)
	h := newAuthTestRouter(database)

	// Missing userData.
	code, body := doJSON(t, h, http.MethodPost, "/api/auth/create-user-with-config",
		map[string]any{}, "")
	if code != http.StatusBadRequest ||
		body["error"] != "User data with username and password is required" {
		t.Fatalf("no userData: code=%d body=%v", code, body)
	}

	// Length + email validation.
	code, body = doJSON(t, h, http.MethodPost, "/api/auth/create-user-with-config",
		map[string]any{"userData": map[string]any{"username": "ab", "password": "password123"}}, "")
	if code != http.StatusBadRequest || body["error"] != `Username "ab" must be at least 3 characters long` {
		t.Fatalf("short username: code=%d body=%v", code, body)
	}
	code, body = doJSON(t, h, http.MethodPost, "/api/auth/create-user-with-config",
		map[string]any{"userData": map[string]any{"username": "bob", "password": "short"}}, "")
	if code != http.StatusBadRequest || body["error"] != `Password for "bob" must be at least 8 characters long` {
		t.Fatalf("short password: code=%d body=%v", code, body)
	}
	code, body = doJSON(t, h, http.MethodPost, "/api/auth/create-user-with-config",
		map[string]any{"userData": map[string]any{"username": "bob", "password": "password123", "email": "nope"}}, "")
	if code != http.StatusBadRequest || body["error"] != `Invalid email format for "bob"` {
		t.Fatalf("bad email: code=%d body=%v", code, body)
	}

	// Bootstrap window: no instance admin exists, member creation is open.
	code, body = doJSON(t, h, http.MethodPost, "/api/auth/create-user-with-config",
		map[string]any{"userData": map[string]any{
			"username": "bob", "password": "password123", "email": "bob@example.com",
		}}, "")
	if code != http.StatusOK || body["success"] != true ||
		body["message"] != `User "bob" created successfully` {
		t.Fatalf("bootstrap member: code=%d body=%v", code, body)
	}
	var role string
	var ia int
	var email sql.NullString
	if err := database.QueryRow(
		"SELECT role, instance_admin, email FROM users WHERE username = 'bob'").Scan(&role, &ia, &email); err != nil {
		t.Fatalf("read bob: %v", err)
	}
	if role != "Administrator" || ia != 0 || email.String != "bob@example.com" {
		t.Fatalf("bob columns: %q %d %v", role, ia, email)
	}

	// Re-running the import skips cleanly.
	code, body = doJSON(t, h, http.MethodPost, "/api/auth/create-user-with-config",
		map[string]any{"userData": map[string]any{
			"username": "bob", "password": "password123",
		}}, "")
	if code != http.StatusOK || body["skipped"] != true ||
		body["message"] != `User "bob" already exists` {
		t.Fatalf("skip existing: code=%d body=%v", code, body)
	}

	// Seed an instance admin; now member creation needs an admin caller.
	seedUser(t, database, "root", "rootpass123", 1)
	code, body = doJSON(t, h, http.MethodPost, "/api/auth/create-user-with-config",
		map[string]any{"userData": map[string]any{
			"username": "carol", "password": "password123",
		}}, "")
	if code != http.StatusForbidden ||
		body["error"] != "Creating users requires an authenticated instance admin" {
		t.Fatalf("closed bootstrap: code=%d body=%v", code, body)
	}

	adminToken, _, err := auth.GenerateTokens(2, "root", "Administrator", 0)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	code, _ = doJSON(t, h, http.MethodPost, "/api/auth/create-user-with-config",
		map[string]any{"userData": map[string]any{
			"username": "carol", "password": "password123",
		}}, adminToken)
	if code != http.StatusOK {
		t.Fatalf("admin caller: code=%d", code)
	}

	// Instance-admin creation requires the pending verification token.
	code, body = doJSON(t, h, http.MethodPost, "/api/auth/create-user-with-config",
		map[string]any{"userData": map[string]any{
			"username": "mallory", "password": "password123", "instanceAdmin": true,
		}}, adminToken)
	if code != http.StatusForbidden ||
		body["error"] != "A valid verification token is required to create an instance admin" {
		t.Fatalf("admin without token: code=%d body=%v", code, body)
	}

	if err := db.SetPendingToken(context.Background(), database, "instance_admin", "mallory", "vtoken"); err != nil {
		t.Fatalf("set pending: %v", err)
	}
	code, _ = doJSON(t, h, http.MethodPost, "/api/auth/create-user-with-config",
		map[string]any{
			"userData": map[string]any{
				"username": "mallory", "password": "password123", "instanceAdmin": true,
			},
			"verificationToken": "vtoken",
		}, adminToken)
	if code != http.StatusOK {
		t.Fatalf("admin with token: code=%d", code)
	}
	var malloryIA int
	if err := database.QueryRow("SELECT instance_admin FROM users WHERE username = 'mallory'").Scan(&malloryIA); err != nil || malloryIA != 1 {
		t.Fatalf("mallory not admin: %v %d", err, malloryIA)
	}
	// The pending token was consumed.
	if left, err := db.GetPendingToken(context.Background(), database, "instance_admin", "mallory"); err != nil || left != nil {
		t.Fatalf("pending token left over: %v %v", left, err)
	}
}

// Node's resolveInstanceAdminCaller verified signatures only; the Go stack
// must also reject revoked and password-evicted (token_version bump) admin
// tokens on the public import endpoint.
func TestCreateUserWithConfigRejectsRevokedOrEvictedAdmin(t *testing.T) {
	auth.SetSecret(authTestSecret)
	database := newAuthTestDB(t)
	h := newAuthTestRouter(database)

	seedUser(t, database, "root", "rootpass123", 1)
	var rootID int64
	if err := database.QueryRow("SELECT id FROM users WHERE username = 'root'").Scan(&rootID); err != nil {
		t.Fatal(err)
	}
	token, _, err := auth.GenerateTokens(rootID, "root", "Administrator", 0)
	if err != nil {
		t.Fatal(err)
	}

	// Sanity: a live admin token authorizes the import.
	code, body := doJSON(t, h, http.MethodPost, "/api/auth/create-user-with-config",
		map[string]any{"userData": map[string]any{"username": "carol", "password": "password123"}}, token)
	if code != http.StatusOK {
		t.Fatalf("fresh admin token: code=%d body=%v", code, body)
	}

	// Revoked (logout): the same token must stop authorizing.
	if err := db.RevokeToken(context.Background(), database, token, rootID, time.Now().Add(time.Hour).Unix()); err != nil {
		t.Fatal(err)
	}
	if code, _ := doJSON(t, h, http.MethodPost, "/api/auth/create-user-with-config",
		map[string]any{"userData": map[string]any{"username": "dave", "password": "password123"}}, token); code != http.StatusForbidden {
		t.Error("revoked admin token still authorized user creation, want 403")
	}

	// Password change bumps token_version: pre-bump tokens are evicted.
	token2, _, err := auth.GenerateTokens(rootID, "root", "Administrator", 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec("UPDATE users SET token_version = 1 WHERE id = ?", rootID); err != nil {
		t.Fatal(err)
	}
	if code, _ := doJSON(t, h, http.MethodPost, "/api/auth/create-user-with-config",
		map[string]any{"userData": map[string]any{"username": "erin", "password": "password123"}}, token2); code != http.StatusForbidden {
		t.Error("token superseded by password change still authorized user creation, want 403")
	}
}

func TestCreateUserWithConfigImports(t *testing.T) {
	auth.SetSecret(authTestSecret)
	database := newAuthTestDB(t)
	h := newAuthTestRouter(database)

	payload := map[string]any{
		"userData": map[string]any{
			"username": "importer", "password": "password123",
		},
		"configData": map[string]any{
			"portainerInstances": []any{
				map[string]any{"name": "edge", "url": "http://1.2.3.4:9000", "auth_type": "password"},
			},
			"dockerHubCredentials": map[string]any{"username": "u"},
			"discordWebhooks": []any{
				map[string]any{"server_name": "Guild", "channel_name": "general", "enabled": 1},
			},
			"trackedApps": []any{
				map[string]any{"name": "app", "image_name": "img", "source_type": "docker",
					"current_version": "1.2.3", "has_update": true},
			},
			"generalSettings": map[string]any{
				"colorScheme": "dark", "logLevel": "debug", "refreshingTogglesEnabled": true,
				"batchConfig": map[string]any{
					"docker-hub-pull": map[string]any{"enabled": true, "intervalMinutes": 30},
				},
			},
		},
		"credentials": map[string]any{
			"portainerInstances": []any{map[string]any{"username": "admin", "password": "secret"}},
			"dockerHub":          map[string]any{"username": "u", "password": "p"},
			"discordWebhooks":    []any{map[string]any{"webhookUrl": "https://discord.com/api/webhooks/123/abc"}},
		},
	}
	code, body := doJSON(t, h, http.MethodPost, "/api/auth/create-user-with-config", payload, "")
	if code != http.StatusOK {
		t.Fatalf("import: code=%d body=%v", code, body)
	}
	results, _ := body["results"].(map[string]any)
	if results == nil {
		t.Fatalf("no results: %v", body)
	}
	if pi, _ := results["portainerInstances"].([]any); len(pi) != 1 {
		t.Fatalf("portainerInstances: %v", results["portainerInstances"])
	}
	if dw, _ := results["discordWebhooks"].([]any); len(dw) != 1 {
		t.Fatalf("discordWebhooks: %v", results["discordWebhooks"])
	}
	if ta, _ := results["trackedApps"].([]any); len(ta) != 1 {
		t.Fatalf("trackedApps: %v", results["trackedApps"])
	}
	errs, _ := results["errors"].([]any)
	if len(errs) != 1 || errs[0] != "Docker Hub credential import is no longer supported. Use 'docker login' instead." {
		t.Fatalf("errors: %v", errs)
	}
	if gs, _ := results["generalSettings"].(map[string]any); gs["imported"] != true {
		t.Fatalf("generalSettings: %v", results["generalSettings"])
	}

	var userID int64
	if err := database.QueryRow("SELECT id FROM users WHERE username = 'importer'").Scan(&userID); err != nil {
		t.Fatalf("read importer: %v", err)
	}

	// Source instance: password creds + resolved IP (literal IP passes through).
	var authType, ip string
	var usernameCol string
	var order int
	if err := database.QueryRow(
		`SELECT auth_type, username, display_order, ip_address FROM source_instances WHERE user_id = ?`,
		userID).Scan(&authType, &usernameCol, &order, &ip); err != nil {
		t.Fatalf("read instance: %v", err)
	}
	if authType != "password" || usernameCol != "admin" || order != 0 || ip != "1.2.3.4" {
		t.Fatalf("instance columns: %q %q %d %q", authType, usernameCol, order, ip)
	}

	// Discord webhook: name defaults to Docked, creds URL wins.
	var whURL, whName string
	if err := database.QueryRow(
		`SELECT webhook_url, name FROM discord_webhooks WHERE user_id = ?`, userID).
		Scan(&whURL, &whName); err != nil {
		t.Fatalf("read webhook: %v", err)
	}
	if whURL != "https://discord.com/api/webhooks/123/abc" || whName != "Docked" {
		t.Fatalf("webhook columns: %q %q", whURL, whName)
	}

	// Tracked app: version metadata carried over.
	var version sql.NullString
	var hasUpdate int
	if err := database.QueryRow(
		`SELECT current_version, has_update FROM tracked_apps WHERE user_id = ?`, userID).
		Scan(&version, &hasUpdate); err != nil {
		t.Fatalf("read app: %v", err)
	}
	if version.String != "1.2.3" || hasUpdate != 1 {
		t.Fatalf("app columns: %v %d", version, hasUpdate)
	}

	// General settings + batch config.
	var cs string
	if err := database.QueryRow(
		`SELECT value FROM settings WHERE user_id = ? AND key = 'color_scheme'`, userID).Scan(&cs); err != nil {
		t.Fatalf("read color_scheme: %v", err)
	}
	if cs != "dark" {
		t.Fatalf("color_scheme = %q", cs)
	}
	var enabled int
	var interval int
	if err := database.QueryRow(
		`SELECT enabled, interval_minutes FROM batch_config WHERE user_id = ? AND job_type = 'docker-hub-pull'`,
		userID).Scan(&enabled, &interval); err != nil {
		t.Fatalf("read batch config: %v", err)
	}
	if enabled != 1 || interval != 30 {
		t.Fatalf("batch config: %d %d", enabled, interval)
	}
}

// Regression: when the revocation write fails, logout must not answer 200.
// The caller would drop the cookie and believe the session is dead while the
// token it was shown still authenticates for the rest of its lifetime.
func TestLogoutRevocationFailureReturnsError(t *testing.T) {
	auth.SetSecret(authTestSecret)

	t.Run("access token", func(t *testing.T) {
		database := newAuthTestDB(t)
		h := newAuthTestRouter(database)
		seedUser(t, database, "alice", "password123", 1)

		code, body := doJSON(t, h, http.MethodPost, "/api/auth/login",
			map[string]any{"username": "alice", "password": "password123"}, "")
		if code != http.StatusOK {
			t.Fatalf("login: code=%d", code)
		}
		token, _ := body["token"].(string)

		// Every revocation write fails, while reads still work so the
		// auth middleware can reach the handler.
		if _, err := database.Exec(`CREATE TRIGGER fail_revoke BEFORE INSERT ON revoked_tokens
			BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END`); err != nil {
			t.Fatalf("create trigger: %v", err)
		}

		code, body = doJSON(t, h, http.MethodPost, "/api/auth/logout", map[string]any{}, token)
		if code != http.StatusInternalServerError {
			t.Fatalf("logout with failing revocation: code=%d body=%v, want 500", code, body)
		}
	})

	t.Run("refresh token", func(t *testing.T) {
		database := newAuthTestDB(t)
		h := newAuthTestRouter(database)
		seedUser(t, database, "alice", "password123", 1)

		code, body := doJSON(t, h, http.MethodPost, "/api/auth/login",
			map[string]any{"username": "alice", "password": "password123"}, "")
		if code != http.StatusOK {
			t.Fatalf("login: code=%d", code)
		}
		token, _ := body["token"].(string)
		refresh, _ := body["refreshToken"].(string)

		// Fail only the refresh token's insert so the access-token
		// revocation succeeds first and the refresh branch is the one
		// that reports the failure. token_hash is the lowercase hex
		// SHA-256 of the presented token (see internal/db/revokedTokens.go).
		sum := sha256.Sum256([]byte(refresh))
		stmt := `CREATE TRIGGER fail_revoke BEFORE INSERT ON revoked_tokens
			WHEN NEW.token_hash = '` + hex.EncodeToString(sum[:]) + `'
			BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END`
		if _, err := database.Exec(stmt); err != nil {
			t.Fatalf("create trigger: %v", err)
		}

		code, body = doJSON(t, h, http.MethodPost, "/api/auth/logout",
			map[string]any{"refreshToken": refresh}, token)
		if code != http.StatusInternalServerError {
			t.Fatalf("logout with failing refresh revocation: code=%d body=%v, want 500", code, body)
		}
	})
}

func TestExportUserConfig(t *testing.T) {
	auth.SetSecret(authTestSecret)
	database := newAuthTestDB(t)
	h := newAuthTestRouter(database)
	userID := seedUser(t, database, "alice", "password123", 1)

	ctx := context.Background()
	if _, err := db.CreateSourceInstance(ctx, database, userID, "edge", "http://1.2.3.4:9000",
		strPtr("admin"), strPtr("pw"), nil, "password", strPtr("1.2.3.4")); err != nil {
		t.Fatalf("create instance: %v", err)
	}
	if _, err := db.CreateDiscordWebhookFull(ctx, database, userID, "https://discord.com/api/webhooks/1/abc",
		strPtr("Guild"), strPtr("general"), strPtr("Hook"), nil, nil, nil, true); err != nil {
		t.Fatalf("create webhook: %v", err)
	}
	appID, err := db.CreateTrackedApp(ctx, database, userID, "app", strPtr("img"), nil, "docker", nil, nil, nil)
	if err != nil {
		t.Fatalf("create app: %v", err)
	}
	created, err := db.GetTrackedAppByID(ctx, database, appID, userID)
	if err != nil || created == nil {
		t.Fatalf("load app: %v", err)
	}
	if _, err := db.UpdateTrackedAppFields(ctx, database, appID, userID,
		map[string]any{"current_version": "1.0", "has_update": 1},
		created.ObservedSnapshot()); err != nil {
		t.Fatalf("update app: %v", err)
	}
	if err := db.UpdateBatchConfig(ctx, database, userID, "app-version-scan", true, 45); err != nil {
		t.Fatalf("batch config: %v", err)
	}
	if err := db.SetSetting(ctx, database, "color_scheme", userID, "dark"); err != nil {
		t.Fatalf("setting: %v", err)
	}
	if err := db.SetSystemSetting(ctx, database, "log_level", "debug"); err != nil {
		t.Fatalf("system setting: %v", err)
	}

	token, _, err := auth.GenerateTokens(userID, "alice", "Administrator", 0)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	code, body := doJSON(t, h, http.MethodGet, "/api/user/export-config", nil, token)
	if code != http.StatusOK {
		t.Fatalf("export: code=%d body=%v", code, body)
	}
	data, _ := body["data"].(map[string]any)
	if data == nil || data["exportDate"] == nil {
		t.Fatalf("data: %v", body)
	}
	user, _ := data["user"].(map[string]any)
	if user["username"] != "alice" || user["instance_admin"] != true {
		t.Fatalf("user: %v", user)
	}
	if _, ok := user["email"]; ok {
		t.Fatalf("config export must not include email: %v", user)
	}
	instances, _ := data["portainerInstances"].([]any)
	if len(instances) != 1 {
		t.Fatalf("instances: %v", data["portainerInstances"])
	}
	if inst, _ := instances[0].(map[string]any); inst["auth_type"] != "password" || inst["ip_address"] != "1.2.3.4" {
		t.Fatalf("instance row: %v", inst)
	}
	webhooks, _ := data["discordWebhooks"].([]any)
	wh, _ := webhooks[0].(map[string]any)
	if wh["server_name"] != "Guild" || wh["name"] != "Hook" {
		t.Fatalf("webhook row (snake reads): %v", wh)
	}
	if wh["created_at"] == nil {
		t.Fatalf("config export must carry real webhook timestamps: %v", wh)
	}
	apps, _ := data["trackedApps"].([]any)
	app, _ := apps[0].(map[string]any)
	if app["has_update"] != true || app["current_version"] != "1.0" {
		t.Fatalf("app row: %v", app)
	}
	if _, ok := app["gitlab_token"]; ok {
		t.Fatalf("config export must not include gitlab_token: %v", app)
	}
	general, _ := data["generalSettings"].(map[string]any)
	if general["colorScheme"] != "dark" || general["logLevel"] != "debug" ||
		general["refreshingTogglesEnabled"] != false {
		t.Fatalf("generalSettings: %v", general)
	}
	batch, _ := general["batchConfig"].(map[string]any)
	if av, _ := batch["app-version-scan"].(map[string]any); av["enabled"] != true || av["intervalMinutes"] != float64(45) {
		t.Fatalf("app-version-scan config: %v", batch)
	}
	if dh, _ := batch["docker-hub-pull"].(map[string]any); dh["enabled"] != false || dh["intervalMinutes"] != float64(60) {
		t.Fatalf("default docker-hub-pull config: %v", batch)
	}
}

// Regression: latest_version_publish_date was missing from both export shapes
// and from the import column allowlist, so an export/import round-trip
// silently dropped the "latest version published on" metadata.
// Regression: the legacy username-keyed avatar directory was joined into the
// filesystem path without validation. Because usernames are attacker-chosen,
// registering the numeric id of another user copied that user's avatar tree
// into the caller's own id-keyed directory, where /avatars and
// /avatars/recent serve it back. Path-like names escaped the avatars root.
func TestAvatarMigrationIgnoresHostileUsername(t *testing.T) {
	auth.SetSecret(authTestSecret)

	t.Run("numeric username collides with another user", func(t *testing.T) {
		dataDir := t.TempDir()
		t.Setenv("DATA_DIR", dataDir)

		database := newAuthTestDB(t)
		h := newAuthTestRouter(database)
		victimID := seedUser(t, database, "victim", "password123", 0)
		thiefID := seedUser(t, database, strconv.FormatInt(victimID, 10), "password123", 0)

		thiefToken, _, err := auth.GenerateTokens(thiefID, strconv.FormatInt(victimID, 10), "Member", 0)
		if err != nil {
			t.Fatalf("generate: %v", err)
		}

		victimDir := filepath.Join(dataDir, "avatars", strconv.FormatInt(victimID, 10))
		if err := os.MkdirAll(filepath.Join(victimDir, "recent"), 0o755); err != nil {
			t.Fatalf("mkdir: %v", err)
		}
		if err := os.WriteFile(filepath.Join(victimDir, "avatar.jpg"), []byte("victim-avatar"), 0o644); err != nil {
			t.Fatalf("write: %v", err)
		}
		if err := os.WriteFile(filepath.Join(victimDir, "recent", "private-1.jpg"), []byte("victim-recent"), 0o644); err != nil {
			t.Fatalf("write recent: %v", err)
		}

		code, body := doJSON(t, h, http.MethodGet, "/api/avatars", nil, thiefToken)
		if code != http.StatusNotFound || body["error"] != "Avatar not found" {
			t.Errorf("served another user's avatar: code=%d body=%v", code, body)
		}
		code, body = doJSON(t, h, http.MethodGet, "/api/avatars/recent", nil, thiefToken)
		if code != http.StatusOK {
			t.Fatalf("recent list: code=%d", code)
		}
		if avatars, _ := body["avatars"].([]any); len(avatars) != 0 {
			t.Errorf("leaked another user's recent avatars: %v", avatars)
		}
		if _, err := os.Stat(filepath.Join(dataDir, "avatars", strconv.FormatInt(thiefID, 10))); err == nil {
			t.Errorf("migration created the caller's id directory from a numeric username")
		}
	})

	t.Run("path-like username escapes the avatars root", func(t *testing.T) {
		dataDir := t.TempDir()
		t.Setenv("DATA_DIR", dataDir)

		// A file that lives outside avatars/ and must never be served.
		if err := os.WriteFile(filepath.Join(dataDir, "avatar.jpg"), []byte("outside-root"), 0o644); err != nil {
			t.Fatalf("write: %v", err)
		}

		database := newAuthTestDB(t)
		h := newAuthTestRouter(database)
		userID := seedUser(t, database, "..", "password123", 0)
		token, _, err := auth.GenerateTokens(userID, "..", "Member", 0)
		if err != nil {
			t.Fatalf("generate: %v", err)
		}

		req := httptest.NewRequest(http.MethodGet, "/api/avatars", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Errorf("served a file outside the avatars root: code=%d body=%q", rec.Code, rec.Body.String())
		}
	})
}

func TestIsSafeLegacyAvatarName(t *testing.T) {
	tests := map[string]bool{
		"alice":      true,
		"old-name":   true,
		"old_name.1": true,
		"042":        true, // not a canonical id, so it cannot collide
		"-1":         true, // ids are positive
		"":           false,
		".":          false,
		"..":         false,
		"42":         false, // collides with user 42's live avatar directory
		"a/b":        false,
		"avatars":    false, // the root's own name
		"/etc":       false,
	}
	for name, want := range tests {
		if got := isSafeLegacyAvatarName(name); got != want {
			t.Errorf("isSafeLegacyAvatarName(%q) = %v, want %v", name, got, want)
		}
	}
}

func TestExportAndImportCarriesLatestPublishDate(t *testing.T) {
	auth.SetSecret(authTestSecret)
	database := newAuthTestDB(t)
	h := newAuthTestRouter(database)
	userID := seedUser(t, database, "alice", "password123", 1)

	ctx := context.Background()
	appID, err := db.CreateTrackedApp(ctx, database, userID, "app", strPtr("img"), nil, "docker", nil, nil, nil)
	if err != nil {
		t.Fatalf("create app: %v", err)
	}
	const published = "2026-01-02T03:04:05Z"
	if _, err := database.ExecContext(ctx,
		`UPDATE tracked_apps SET latest_version = ?, latest_version_publish_date = ? WHERE id = ? AND user_id = ?`,
		"2.0", published, appID, userID); err != nil {
		t.Fatalf("update app: %v", err)
	}

	token, _, err := auth.GenerateTokens(userID, "alice", "Administrator", 0)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}

	code, body := doJSON(t, h, http.MethodGet, "/api/user/export-config", nil, token)
	if code != http.StatusOK {
		t.Fatalf("export-config: code=%d body=%v", code, body)
	}
	data, _ := body["data"].(map[string]any)
	apps, _ := data["trackedApps"].([]any)
	app, _ := apps[0].(map[string]any)
	if app["latest_version_publish_date"] != published {
		t.Errorf("config export lost latest_version_publish_date: %v", app)
	}

	code, body = doJSON(t, h, http.MethodGet, "/api/auth/export-users", nil, token)
	if code != http.StatusOK {
		t.Fatalf("export-users: code=%d body=%v", code, body)
	}
	data, _ = body["data"].(map[string]any)
	users, _ := data["users"].([]any)
	entry, _ := users[0].(map[string]any)
	apps, _ = entry["trackedApps"].([]any)
	app, _ = apps[0].(map[string]any)
	if app["latest_version_publish_date"] != published {
		t.Errorf("users export lost latest_version_publish_date: %v", app)
	}

	// Import must restore the field, not drop it on the floor.
	payload := map[string]any{
		"userData": map[string]any{"username": "importer", "password": "password123"},
		"configData": map[string]any{
			"trackedApps": []any{map[string]any{
				"name": "app", "image_name": "img", "source_type": "docker",
				"latest_version":              "2.0",
				"latest_version_publish_date": published,
			}},
		},
	}
	code, body = doJSON(t, h, http.MethodPost, "/api/auth/create-user-with-config", payload, token)
	if code != http.StatusOK {
		t.Fatalf("import: code=%d body=%v", code, body)
	}
	var got string
	if err := database.QueryRowContext(ctx,
		`SELECT latest_version_publish_date FROM tracked_apps WHERE name = 'app'`).Scan(&got); err != nil {
		t.Fatalf("read imported app: %v", err)
	}
	if got != published {
		t.Errorf("import lost latest_version_publish_date: got %q, want %q", got, published)
	}
}

func TestExportUsers(t *testing.T) {
	auth.SetSecret(authTestSecret)
	database := newAuthTestDB(t)
	h := newAuthTestRouter(database)
	memberID := seedUser(t, database, "member", "password123", 0)
	adminID := seedUser(t, database, "root", "rootpass123", 1)

	ctx := context.Background()
	if _, err := db.CreateDiscordWebhookFull(ctx, database, memberID, "https://discord.com/api/webhooks/1/abc",
		strPtr("Guild"), strPtr("general"), strPtr("Hook"), nil, nil, nil, true); err != nil {
		t.Fatalf("create webhook: %v", err)
	}
	appID, err := db.CreateTrackedApp(ctx, database, memberID, "app", strPtr("img"), nil, "docker",
		strPtr("glpat-secret"), nil, nil)
	if err != nil {
		t.Fatalf("create app: %v", err)
	}
	created, err := db.GetTrackedAppByID(ctx, database, appID, memberID)
	if err != nil || created == nil {
		t.Fatalf("load app: %v", err)
	}
	if _, err := db.UpdateTrackedAppFields(ctx, database, appID, memberID,
		map[string]any{"has_update": 1}, created.ObservedSnapshot()); err != nil {
		t.Fatalf("update app: %v", err)
	}
	if _, err := database.Exec(
		`INSERT INTO docker_hub_credentials (user_id, username, token) VALUES (?, 'hubuser', 'hubtoken')`,
		memberID); err != nil {
		t.Fatalf("seed creds: %v", err)
	}

	memberToken, _, err := auth.GenerateTokens(memberID, "member", "Member", 0)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	adminToken, _, err := auth.GenerateTokens(adminID, "root", "Administrator", 0)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}

	// Member is not an instance admin.
	code, body := doJSON(t, h, http.MethodGet, "/api/auth/export-users", nil, memberToken)
	if code != http.StatusForbidden || body["error"] != "Forbidden" {
		t.Fatalf("member export: code=%d body=%v", code, body)
	}

	code, body = doJSON(t, h, http.MethodGet, "/api/auth/export-users", nil, adminToken)
	if code != http.StatusOK {
		t.Fatalf("admin export: code=%d body=%v", code, body)
	}
	data, _ := body["data"].(map[string]any)
	users, _ := data["users"].([]any)
	if len(users) != 2 {
		t.Fatalf("users: %v", data["users"])
	}

	var memberEntry map[string]any
	for _, u := range users {
		entry, _ := u.(map[string]any)
		user, _ := entry["user"].(map[string]any)
		if user["username"] == "member" {
			memberEntry = entry
		}
	}
	if memberEntry == nil {
		t.Fatalf("member entry missing: %v", users)
	}
	user, _ := memberEntry["user"].(map[string]any)
	if user["instance_admin"] != false || user["email"] != nil {
		t.Fatalf("member user: %v", user)
	}

	// Node's camelCase-read quirk: the camel-snake divergent keys are null
	// and the timestamp keys are absent; `name` is read identically in both
	// casings so it survives with its real value.
	webhooks, _ := memberEntry["discordWebhooks"].([]any)
	wh, _ := webhooks[0].(map[string]any)
	if wh["server_name"] != nil || wh["name"] != "Hook" {
		t.Fatalf("webhook quirk not reproduced: %v", wh)
	}
	if _, ok := wh["created_at"]; ok {
		t.Fatalf("webhook created_at must be omitted: %v", wh)
	}
	if wh["enabled"] != float64(1) {
		t.Fatalf("webhook enabled: %v", wh["enabled"])
	}

	// gitlab_token leaks in the all-users export (Node parity).
	apps, _ := memberEntry["trackedApps"].([]any)
	app, _ := apps[0].(map[string]any)
	if app["gitlab_token"] != "glpat-secret" || app["has_update"] != true {
		t.Fatalf("app row: %v", app)
	}

	// The latent Node 500 is fixed: masked credentials instead.
	dh, _ := memberEntry["dockerHubCredentials"].(map[string]any)
	if dh == nil || dh["username"] != "hubuser" || dh["token"] != "***configured***" {
		t.Fatalf("dockerHubCredentials: %v", memberEntry["dockerHubCredentials"])
	}

	// Admin without creds serializes null.
	for _, u := range users {
		entry, _ := u.(map[string]any)
		user, _ := entry["user"].(map[string]any)
		if user["username"] == "root" && entry["dockerHubCredentials"] != nil {
			t.Fatalf("root creds should be null: %v", entry["dockerHubCredentials"])
		}
	}
}

func TestAvatarRoutes(t *testing.T) {
	auth.SetSecret(authTestSecret)
	dataDir := t.TempDir()
	t.Setenv("DATA_DIR", dataDir)

	database := newAuthTestDB(t)
	h := newAuthTestRouter(database)
	adminID := seedUser(t, database, "admin", "password123", 1)
	plainID := seedUser(t, database, "oldname", "password123", 0)

	adminToken, _, err := auth.GenerateTokens(adminID, "admin", "Administrator", 0)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	plainToken, _, err := auth.GenerateTokens(plainID, "oldname", "Member", 0)
	if err != nil {
		t.Fatalf("generate: %v", err)
	}

	// Missing avatar: 404 JSON (client maps this to its own default image).
	code, body := doJSON(t, h, http.MethodGet, "/api/avatars", nil, plainToken)
	if code != http.StatusNotFound || body["error"] != "Avatar not found" {
		t.Fatalf("missing avatar: code=%d body=%v", code, body)
	}

	// Username-directory migration: writing avatars/<username>/avatar.jpg
	// makes the avatar appear under the id-keyed path.
	oldDir := filepath.Join(dataDir, "avatars", "oldname")
	if err := os.MkdirAll(oldDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(oldDir, "avatar.jpg"), []byte("jpegbytes"), 0o644); err != nil {
		t.Fatalf("write: %v", err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/avatars", nil)
	req.Header.Set("Authorization", "Bearer "+plainToken)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Body.String() != "jpegbytes" {
		t.Fatalf("migrated avatar: code=%d body=%q", rec.Code, rec.Body.String())
	}
	if _, err := os.Stat(filepath.Join(dataDir, "avatars", itoa(plainID), "avatar.jpg")); err != nil {
		t.Fatalf("migration did not copy into id directory: %v", err)
	}

	// Admin fetch by user id (binary body, so a raw request).
	req = httptest.NewRequest(http.MethodGet, "/api/avatars/user/"+itoa(plainID), nil)
	req.Header.Set("Authorization", "Bearer "+adminToken)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Body.String() != "jpegbytes" {
		t.Fatalf("admin fetch: code=%d body=%q", rec.Code, rec.Body.String())
	}
	code, body = doJSON(t, h, http.MethodGet, "/api/avatars/user/"+itoa(plainID), nil, plainToken)
	if code != http.StatusForbidden || body["error"] != "Forbidden" {
		t.Fatalf("non-admin fetch: code=%d body=%v", code, body)
	}
	code, body = doJSON(t, h, http.MethodGet, "/api/avatars/user/abc", nil, adminToken)
	if code != http.StatusBadRequest || body["error"] != "Invalid user ID" {
		t.Fatalf("bad id: code=%d body=%v", code, body)
	}

	// Recent avatars.
	recentDir := filepath.Join(dataDir, "avatars", itoa(plainID), "recent")
	if err := os.MkdirAll(recentDir, 0o755); err != nil {
		t.Fatalf("mkdir recent: %v", err)
	}
	if err := os.WriteFile(filepath.Join(recentDir, "avatar-1.jpg"), []byte("one"), 0o644); err != nil {
		t.Fatalf("write recent: %v", err)
	}
	if err := os.WriteFile(filepath.Join(recentDir, "notes.txt"), []byte("skip"), 0o644); err != nil {
		t.Fatalf("write txt: %v", err)
	}
	code, body = doJSON(t, h, http.MethodGet, "/api/avatars/recent", nil, plainToken)
	if code != http.StatusOK {
		t.Fatalf("recent list: code=%d", code)
	}
	avatars, _ := body["avatars"].([]any)
	if len(avatars) != 1 || avatars[0] != "/api/avatars/recent/avatar-1.jpg" {
		t.Fatalf("recent list: %v", body["avatars"])
	}

	req = httptest.NewRequest(http.MethodGet, "/api/avatars/recent/avatar-1.jpg", nil)
	req.Header.Set("Authorization", "Bearer "+plainToken)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK || rec.Body.String() != "one" {
		t.Fatalf("recent file: code=%d body=%q", rec.Code, rec.Body.String())
	}
	code, body = doJSON(t, h, http.MethodGet, "/api/avatars/recent/avatar-1.png", nil, plainToken)
	if code != http.StatusBadRequest || body["error"] != "Invalid filename" {
		t.Fatalf("bad filename: code=%d body=%v", code, body)
	}
}

func itoa(n int64) string {
	return strconv.FormatInt(n, 10)
}
