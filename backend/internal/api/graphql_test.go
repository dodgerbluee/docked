// HTTP-level tests for the GraphQL surface: they exercise the auth middleware,
// the resolvers, and the shared SQLite schema together. The focus is the
// write / authorization surface that the read-only live smoke test cannot
// cover: requireAdmin enforcement, DB-compatible role writes, registration
// role assignment, login, preferences persistence, and the batchUpgrade
// empty-list guard.
package api

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/dockedapp/backend/internal/auth"
	"github.com/dockedapp/backend/internal/config"
	"github.com/dockedapp/backend/internal/db"
	"github.com/dockedapp/backend/internal/events"
	"github.com/dockedapp/backend/internal/imagesync"
)

const testSecret = "test-secret"

// fixtureDDL creates the subset of the shared schema the tested resolvers
// touch. It mirrors server/db/connection.js column-for-column for those tables.
const fixtureDDL = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  email TEXT,
  role TEXT DEFAULT 'Administrator',
  password_changed INTEGER DEFAULT 0,
  instance_admin INTEGER DEFAULT 0,
  verification_token TEXT,
  last_login DATETIME,
  oauth_provider TEXT, oauth_provider_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, key)
);
CREATE TABLE batch_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  job_type TEXT DEFAULT 'docker-hub-pull',
  status TEXT NOT NULL,
  is_manual INTEGER DEFAULT 0,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  duration_ms INTEGER,
  containers_checked INTEGER DEFAULT 0,
  containers_updated INTEGER DEFAULT 0,
  error_message TEXT,
  logs TEXT
);
CREATE TABLE source_instances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  url TEXT,
  username TEXT,
  password TEXT,
  api_key TEXT,
  auth_type TEXT DEFAULT 'apikey',
  display_order INTEGER DEFAULT 0,
  ip_address TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE intents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  enabled INTEGER DEFAULT 1,
  match_containers TEXT,
  match_images TEXT,
  match_sources TEXT,
  match_stacks TEXT,
  match_registries TEXT,
  exclude_containers TEXT,
  exclude_images TEXT,
  exclude_stacks TEXT,
  exclude_registries TEXT,
  schedule_type TEXT NOT NULL,
  schedule_cron TEXT,
  max_concurrent INTEGER DEFAULT 1,
  dry_run INTEGER DEFAULT 0,
  sequential_delay_sec INTEGER DEFAULT 0,
  last_evaluated_at DATETIME,
  last_execution_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE intent_executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  intent_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  trigger_type TEXT NOT NULL,
  containers_matched INTEGER DEFAULT 0,
  containers_upgraded INTEGER DEFAULT 0,
  containers_failed INTEGER DEFAULT 0,
  containers_skipped INTEGER DEFAULT 0,
  error_message TEXT,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  duration_ms INTEGER
);
CREATE TABLE runners (
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
);
CREATE TABLE containers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  source_instance_id INTEGER,
  container_id TEXT NOT NULL,
  container_name TEXT NOT NULL,
  endpoint_id TEXT,
  image_name TEXT,
  image_repo TEXT,
  status TEXT,
  state TEXT,
  stack_name TEXT,
  deployed_image_id INTEGER,
  uses_network_mode INTEGER DEFAULT 0,
  provides_network INTEGER DEFAULT 0,
  runner_id INTEGER,
  last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE deployed_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  image_repo TEXT,
  image_tag TEXT,
  image_digest TEXT,
  repo_digests TEXT,
  registry TEXT,
  image_created_date TEXT
);
CREATE TABLE registry_image_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  image_repo TEXT,
  tag TEXT,
  latest_digest TEXT,
  latest_version TEXT,
  latest_publish_date TEXT,
  provider TEXT,
  last_checked TEXT
);
CREATE TABLE upgrade_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  source_instance_id INTEGER,
  source_instance_name TEXT,
  runner_id INTEGER,
  runner_name TEXT,
  container_id TEXT,
  container_name TEXT,
  endpoint_id TEXT,
  source_url TEXT,
  old_image TEXT,
  new_image TEXT,
  old_digest TEXT,
  new_digest TEXT,
  old_version TEXT,
  new_version TEXT,
  image_repo TEXT,
  registry TEXT,
  namespace TEXT,
  repository TEXT,
  status TEXT,
  error_message TEXT,
  upgrade_duration_ms INTEGER,
  intent_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE tracked_apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT,
  image_name TEXT,
  github_repo TEXT,
  source_type TEXT,
  current_version TEXT,
  current_digest TEXT,
  latest_version TEXT,
  latest_digest TEXT,
  has_update INTEGER DEFAULT 0,
  current_version_publish_date TEXT,
  latest_version_publish_date TEXT,
  last_checked TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  repository_token_id INTEGER,
  gitlab_token TEXT
);
CREATE TABLE discord_webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  webhook_url TEXT,
  server_name TEXT,
  channel_name TEXT,
  name TEXT,
  enabled INTEGER DEFAULT 1,
  avatar_url TEXT,
  guild_id TEXT,
  channel_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE batch_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  setting_key TEXT,
  setting_value TEXT
);
CREATE TABLE repository_access_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  name TEXT,
  access_token TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE discord_notifications_sent (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  deduplication_key TEXT NOT NULL,
  notification_type TEXT NOT NULL,
  sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, deduplication_key)
);
CREATE TABLE docker_hub_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  username TEXT,
  token TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id)
);
CREATE TABLE runner_enrollment_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE tracked_app_upgrade_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  app_name TEXT NOT NULL,
  provider TEXT NOT NULL,
  repository TEXT NOT NULL,
  old_version TEXT NOT NULL,
  new_version TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`

type testEnv struct {
	ts       *httptest.Server
	database *sql.DB
	adminID  int64
	memberID int64
}

// newTestEnv builds an isolated fixture DB + in-process server. When seed is
// true it creates one Administrator and one Member user.
func newTestEnv(t *testing.T, seed bool) *testEnv {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "test.db")
	database, err := db.Open(dbPath)
	if err != nil {
		t.Fatalf("open fixture db: %v", err)
	}
	if _, err := database.Exec(fixtureDDL); err != nil {
		t.Fatalf("apply fixture ddl: %v", err)
	}
	auth.SetSecret(testSecret)

	env := &testEnv{database: database}
	ctx := context.Background()
	if seed {
		ah, _ := auth.HashPassword("adminpass")
		mh, _ := auth.HashPassword("memberpass")
		env.adminID, err = db.CreateUser(ctx, database, "admin", ah, "Administrator", 1)
		if err != nil {
			t.Fatalf("seed admin: %v", err)
		}
		env.memberID, err = db.CreateUser(ctx, database, "member", mh, "Member", 0)
		if err != nil {
			t.Fatalf("seed member: %v", err)
		}
	}

	cfg := &config.Config{JWTSecret: testSecret, DBPath: dbPath, Addr: ":0"}
	hub := events.NewHub()
	env.ts = httptest.NewServer(NewServer(cfg, database, hub, imagesync.NewService(database, hub), nil).Handler)
	t.Cleanup(func() {
		env.ts.Close()
		database.Close()
	})
	return env
}

type gqlError struct {
	Message string `json:"message"`
}

type gqlResp struct {
	Data   map[string]json.RawMessage `json:"data"`
	Errors []gqlError                 `json:"errors"`
}

func (r gqlResp) hasErrorContaining(sub string) bool {
	for _, e := range r.Errors {
		if bytes.Contains([]byte(e.Message), []byte(sub)) {
			return true
		}
	}
	return false
}

func (e *testEnv) gql(t *testing.T, token, query string, vars map[string]any) gqlResp {
	return e.gqlAs(t, "", token, query, vars)
}

// gqlAs sends X-Forwarded-For with the given client IP (empty = none). The Go
// limiter keys on the rightmost XFF entry, so tests use distinct IPs to keep
// their rate-limit budgets isolated from each other.
func (e *testEnv) gqlAs(t *testing.T, ip, token, query string, vars map[string]any) gqlResp {
	t.Helper()
	payload := map[string]any{"query": query}
	if vars != nil {
		payload["variables"] = vars
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequest("POST", e.ts.URL+"/graphql", bytes.NewReader(body))
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if ip != "" {
		req.Header.Set("X-Forwarded-For", ip)
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do request: %v", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var out gqlResp
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("decode response %q: %v", raw, err)
	}
	return out
}

func (e *testEnv) token(t *testing.T, userID int64, username string) string {
	t.Helper()
	at, _, err := auth.GenerateTokens(userID, username, "unused")
	if err != nil {
		t.Fatalf("generate token: %v", err)
	}
	return at
}

func TestRequireAdminEnforcesRole(t *testing.T) {
	env := newTestEnv(t, true)
	admin := env.token(t, env.adminID, "admin")
	member := env.token(t, env.memberID, "member")

	// Admin can list users.
	if r := env.gql(t, admin, `{ users { id username role } }`, nil); len(r.Errors) != 0 {
		t.Fatalf("admin users query errored: %+v", r.Errors)
	}

	// Member is denied.
	if r := env.gql(t, member, `{ users { id } }`, nil); !r.hasErrorContaining("insufficient privileges") {
		t.Fatalf("member users query should be denied, got: %+v", r)
	}

	// Anonymous is denied.
	if r := env.gql(t, "", `{ users { id } }`, nil); !r.hasErrorContaining("authentication required") {
		t.Fatalf("anonymous users query should require auth, got: %+v", r)
	}
}

// TestRoleAdminWithoutInstanceAdminDenied guards the privilege-escalation class:
// Node creates every user with role "Administrator" and uses instance_admin as
// the real privilege signal. A user with role "Administrator" but
// instance_admin=0 must NOT be able to reach privileged operations.
func TestRoleAdminWithoutInstanceAdminDenied(t *testing.T) {
	env := newTestEnv(t, true)
	hash, _ := auth.HashPassword("pw12345")
	id, err := db.CreateUser(context.Background(), env.database, "role_only_admin", hash, "Administrator", 0)
	if err != nil {
		t.Fatalf("seed role-only admin: %v", err)
	}
	tok := env.token(t, id, "role_only_admin")

	if r := env.gql(t, tok, `{ users { id } }`, nil); !r.hasErrorContaining("insufficient privileges") {
		t.Fatalf("role-only Administrator (instance_admin=0) must be denied, got: %+v", r)
	}
	if r := env.gql(t, tok, `mutation($id: ID!, $role: Role!){ setUserRole(userId: $id, role: $role){ success } }`,
		map[string]any{"id": strconv.FormatInt(env.adminID, 10), "role": "MEMBER"}); !r.hasErrorContaining("insufficient privileges") {
		t.Fatalf("role-only Administrator must not change roles, got: %+v", r)
	}
}

// TestLogsQueryAdminOnly guards the log-read gate: Node exposed log files
// only through the admin-gated debug controller, so the GraphQL logs query
// must require instance admin, not merely any authenticated user.
func TestLogsQueryAdminOnly(t *testing.T) {
	env := newTestEnv(t, true)
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "combined.log"), []byte("secret log line\n"), 0o644); err != nil {
		t.Fatalf("seed log file: %v", err)
	}
	t.Setenv("LOGS_DIR", dir)

	member := env.token(t, env.memberID, "member")
	if r := env.gql(t, member, `{ logs(file: "combined.log", offset: 0) { logs } }`, nil); !r.hasErrorContaining("insufficient privileges") {
		t.Fatalf("member logs query should be denied, got: %+v", r)
	}

	admin := env.token(t, env.adminID, "admin")
	r := env.gql(t, admin, `{ logs(file: "combined.log", offset: 0) { logs } }`, nil)
	if len(r.Errors) != 0 {
		t.Fatalf("admin logs query errored: %+v", r.Errors)
	}
	var out struct {
		Logs string `json:"logs"`
	}
	if err := json.Unmarshal(r.Data["logs"], &out); err != nil {
		t.Fatalf("decode logs: %v", err)
	}
	if !strings.Contains(out.Logs, "secret log line") {
		t.Fatalf("admin logs query returned %q, want file contents", out.Logs)
	}
}

func TestSetUserRoleAuthzAndPersistence(t *testing.T) {
	env := newTestEnv(t, true)
	admin := env.token(t, env.adminID, "admin")
	member := env.token(t, env.memberID, "member")
	target := strconv.FormatInt(env.memberID, 10)

	// Member cannot change roles.
	if r := env.gql(t, member, `mutation($id: ID!, $role: Role!){ setUserRole(userId: $id, role: $role){ success } }`,
		map[string]any{"id": target, "role": "MEMBER"}); !r.hasErrorContaining("insufficient privileges") {
		t.Fatalf("member setUserRole should be denied, got: %+v", r)
	}

	// Admin promotes to ADMINISTRATOR -> DB stores "Administrator".
	if r := env.gql(t, admin, `mutation($id: ID!, $role: Role!){ setUserRole(userId: $id, role: $role){ success } }`,
		map[string]any{"id": target, "role": "ADMINISTRATOR"}); len(r.Errors) != 0 {
		t.Fatalf("admin setUserRole errored: %+v", r.Errors)
	}
	if got := dbRole(t, env.database, env.memberID); got != "Administrator" {
		t.Fatalf("DB role after promote = %q, want Administrator", got)
	}

	// Admin demotes to MEMBER -> DB stores "Member".
	env.gql(t, admin, `mutation($id: ID!, $role: Role!){ setUserRole(userId: $id, role: $role){ success } }`,
		map[string]any{"id": target, "role": "MEMBER"})
	if got := dbRole(t, env.database, env.memberID); got != "Member" {
		t.Fatalf("DB role after demote = %q, want Member", got)
	}
}

func TestRegistrationRoleAssignment(t *testing.T) {
	// Seeded DB already has users, so a new registration must be a Member.
	env := newTestEnv(t, true)
	r := env.gqlAs(t, "10.0.1.1", "", `mutation($in: RegisterInput!){ register(input: $in){ user { username role } } }`,
		map[string]any{"in": map[string]any{"username": "newbie", "password": "pw123456"}})
	if len(r.Errors) != 0 {
		t.Fatalf("register errored: %+v", r.Errors)
	}
	if got := dbRole(t, env.database, dbIDByUsername(t, env.database, "newbie")); got != "Member" {
		t.Fatalf("second-user DB role = %q, want Member", got)
	}
}

func TestFirstRegistrationBecomesAdministrator(t *testing.T) {
	// Empty DB must fail closed unless an operator supplied a shared code.
	env := newTestEnv(t, false)
	withoutCode := env.gqlAs(t, "10.0.1.2", "", `mutation($in: RegisterInput!){ register(input: $in){ user { username } } }`,
		map[string]any{"in": map[string]any{"username": "blocked", "password": "pw123456"}})
	if !withoutCode.hasErrorContaining("Registration code is required") {
		t.Fatalf("first register without shared code must be rejected, got: %+v", withoutCode)
	}
	if _, err := env.database.Exec(
		"INSERT INTO settings (user_id, key, value) VALUES (0, 'registration_code', 'ABCD-EFGH-IJKL')"); err != nil {
		t.Fatalf("seed registration code: %v", err)
	}
	r := env.gqlAs(t, "10.0.1.2", "", `mutation($in: RegisterInput!){ register(input: $in){ user { username role } } }`,
		map[string]any{"in": map[string]any{
			"username": "root", "password": "pw123456", "registrationCode": "abcdefghijkl",
		}})
	if len(r.Errors) != 0 {
		t.Fatalf("first register errored: %+v", r.Errors)
	}
	id := dbIDByUsername(t, env.database, "root")
	if got := dbRole(t, env.database, id); got != "Administrator" {
		t.Fatalf("first-user DB role = %q, want Administrator", got)
	}
	var ia int
	if err := env.database.QueryRowContext(context.Background(), "SELECT instance_admin FROM users WHERE id = ?", id).Scan(&ia); err != nil {
		t.Fatalf("read instance_admin: %v", err)
	}
	if ia != 1 {
		t.Fatalf("first-user instance_admin = %d, want 1", ia)
	}
	var codes int
	if err := env.database.QueryRow("SELECT COUNT(*) FROM settings WHERE key = 'registration_code'").Scan(&codes); err != nil {
		t.Fatalf("check consumed registration code: %v", err)
	}
	if codes != 0 {
		t.Fatalf("registration code was not consumed")
	}
}

func TestRegisterValidationBoundaries(t *testing.T) {
	env := newTestEnv(t, true) // seeded users exist, so no shared code needed

	// Lengths count UTF-16 code units, exactly like JS String.length: a
	// 2-character unicode username must be rejected with the same message
	// ASCII would produce.
	r := env.gqlAs(t, "10.0.1.3", "", `mutation($in: RegisterInput!){ register(input: $in){ user { username } } }`,
		map[string]any{"in": map[string]any{"username": "猫", "password": "pw123456"}})
	if !r.hasErrorContaining("at least 3 characters") {
		t.Fatalf("2-rune unicode username must be rejected, got: %+v", r)
	}
	r = env.gqlAs(t, "10.0.1.3", "", `mutation($in: RegisterInput!){ register(input: $in){ user { username } } }`,
		map[string]any{"in": map[string]any{"username": "猫小大", "password": "pw123456"}})
	if len(r.Errors) != 0 {
		t.Fatalf("3-rune unicode username should register, got: %+v", r.Errors)
	}

	// 7-character password stays rejected (>=8 rule).
	r = env.gqlAs(t, "10.0.1.3", "", `mutation($in: RegisterInput!){ register(input: $in){ user { username } } }`,
		map[string]any{"in": map[string]any{"username": "shortpw", "password": "pw12345"}})
	if !r.hasErrorContaining("at least 8 characters") {
		t.Fatalf("7-char password must be rejected, got: %+v", r)
	}

	// UTF-16 parity: four emoji are 8 UTF-16 units (JS length 8) and must
	// pass, while three (6 units) must fail — Node would accept the former
	// and a rune count would wrongly reject it.
	r = env.gqlAs(t, "10.0.1.3", "", `mutation($in: RegisterInput!){ register(input: $in){ user { username } } }`,
		map[string]any{"in": map[string]any{"username": "emojipass", "password": "😀😁😂🤣"}})
	if len(r.Errors) != 0 {
		t.Fatalf("4-emoji password (8 UTF-16 units) should register, got: %+v", r.Errors)
	}
	r = env.gqlAs(t, "10.0.1.3", "", `mutation($in: RegisterInput!){ register(input: $in){ user { username } } }`,
		map[string]any{"in": map[string]any{"username": "emojifail", "password": "😀😁😂"}})
	if !r.hasErrorContaining("at least 8 characters") {
		t.Fatalf("3-emoji password (6 UTF-16 units) must be rejected, got: %+v", r)
	}
}

func TestFirstRegistrationEmptyCodeGetsRequiredMessage(t *testing.T) {
	// Node parity: with a shared code on file but an empty submission, the
	// error is "required", not "invalid".
	env := newTestEnv(t, false)
	if _, err := env.database.Exec(
		"INSERT INTO settings (user_id, key, value) VALUES (0, 'registration_code', 'ABCD-EFGH-IJKL')"); err != nil {
		t.Fatalf("seed registration code: %v", err)
	}
	r := env.gqlAs(t, "10.0.1.4", "", `mutation($in: RegisterInput!){ register(input: $in){ user { username } } }`,
		map[string]any{"in": map[string]any{"username": "blocked", "password": "pw123456", "registrationCode": ""}})
	if !r.hasErrorContaining("Registration code is required") {
		t.Fatalf("empty code must report required, got: %+v", r)
	}
}

func TestInstanceAdminTokenInputGuards(t *testing.T) {
	env := newTestEnv(t, true)

	r := env.gqlAs(t, "10.0.1.5", "", `mutation($username: String!){ generateInstanceAdminToken(username: $username){ success error } }`,
		map[string]any{"username": ""})
	if len(r.Errors) != 0 {
		t.Fatalf("generate errored at GraphQL level: %+v", r.Errors)
	}
	var gen struct {
		Success bool    `json:"success"`
		Error   *string `json:"error"`
	}
	if err := json.Unmarshal(r.Data["generateInstanceAdminToken"], &gen); err != nil {
		t.Fatalf("decode generate envelope: %v", err)
	}
	if gen.Success || gen.Error == nil || *gen.Error != "Username is required" {
		t.Fatalf("empty-username envelope = %+v, want success=false error=%q", gen, "Username is required")
	}

	r = env.gqlAs(t, "10.0.1.5", "", `mutation($username: String!, $token: String!){ verifyInstanceAdminToken(username: $username, token: $token){ success error } }`,
		map[string]any{"username": "", "token": ""})
	var ver struct {
		Success bool    `json:"success"`
		Error   *string `json:"error"`
	}
	if err := json.Unmarshal(r.Data["verifyInstanceAdminToken"], &ver); err != nil {
		t.Fatalf("decode verify envelope: %v", err)
	}
	if ver.Success || ver.Error == nil || *ver.Error != "Username and token are required" {
		t.Fatalf("empty-input verify envelope = %+v, want required message", ver)
	}
}

// TestInstanceAdminTokenGrantFlow locks the security contract of the import
// token lifecycle: generate must NOT return the token (it is only written to
// container logs, so obtaining it proves host access), and verify must NOT
// consume the pending token — Node's create-user-with-config consumes it
// atomically at the moment it grants instance-admin. If verify consumed it,
// the grant could never re-check it; if generate returned it, any anonymous
// caller could mint their own grant credential.
func TestInstanceAdminTokenGrantFlow(t *testing.T) {
	env := newTestEnv(t, true)
	ctx := context.Background()

	const username = "ghost-admin"
	genDoc := `mutation($username: String!){ generateInstanceAdminToken(username: $username){ success error token } }`
	r := env.gqlAs(t, "10.0.1.5", "", genDoc, map[string]any{"username": username})
	var gen struct {
		Success bool    `json:"success"`
		Error   *string `json:"error"`
		Token   *string `json:"token"`
	}
	if err := json.Unmarshal(r.Data["generateInstanceAdminToken"], &gen); err != nil {
		t.Fatalf("decode generate envelope: %v", err)
	}
	if !gen.Success {
		t.Fatalf("generate failed: %+v", gen)
	}
	if gen.Token != nil {
		t.Fatalf("generate leaked token in GraphQL response: %q", *gen.Token)
	}

	var stored string
	if err := env.database.QueryRowContext(ctx,
		"SELECT token FROM pending_auth_tokens WHERE kind = 'instance_admin' AND username = ?", username,
	).Scan(&stored); err != nil {
		t.Fatalf("pending token was not stored: %v", err)
	}

	verifyDoc := `mutation($username: String!, $token: String!){ verifyInstanceAdminToken(username: $username, token: $token){ success error } }`
	r = env.gqlAs(t, "10.0.1.5", "", verifyDoc, map[string]any{"username": username, "token": "WRONG-TOKN"})
	if !bytes.Contains(r.Data["verifyInstanceAdminToken"], []byte("Invalid token")) {
		t.Fatalf("wrong token accepted: %s", r.Data["verifyInstanceAdminToken"])
	}
	for i := 0; i < 2; i++ {
		r = env.gqlAs(t, "10.0.1.5", "", verifyDoc, map[string]any{"username": username, "token": stored})
		if !bytes.Contains(r.Data["verifyInstanceAdminToken"], []byte(`"success":true`)) {
			t.Fatalf("verify #%d of pending token failed: %s", i+1, r.Data["verifyInstanceAdminToken"])
		}
	}

	// Simulate Node's grant-time consumption: exactly one caller wins.
	ok, err := db.ConsumePendingToken(ctx, env.database, "instance_admin", username, stored)
	if err != nil || !ok {
		t.Fatalf("consume pending token = (%v, %v), want (true, nil)", ok, err)
	}
	if ok, err = db.ConsumePendingToken(ctx, env.database, "instance_admin", username, stored); ok || err != nil {
		t.Fatalf("replay consume = (%v, %v), want (false, nil)", ok, err)
	}
	r = env.gqlAs(t, "10.0.1.5", "", verifyDoc, map[string]any{"username": username, "token": stored})
	if !bytes.Contains(r.Data["verifyInstanceAdminToken"], []byte("Invalid token")) {
		t.Fatalf("consumed token still verifies: %s", r.Data["verifyInstanceAdminToken"])
	}
}

// TestUserStatsAndDeleteCascade guards the migration-13 rename
// (portainer_instances -> source_instances): the delete cascade must target
// the live table name, otherwise deleteUser fails outright.
func TestUserStatsAndDeleteCascade(t *testing.T) {
	env := newTestEnv(t, true)
	ctx := context.Background()
	admin := env.token(t, env.adminID, "admin")

	if _, err := env.database.ExecContext(ctx,
		"INSERT INTO source_instances (user_id, name, url) VALUES (?, 'src', 'http://src.local')", env.memberID); err != nil {
		t.Fatalf("seed source_instances: %v", err)
	}
	if _, err := env.database.ExecContext(ctx,
		"INSERT INTO tracked_apps (user_id, name, image_name) VALUES (?, 'app', 'img')", env.memberID); err != nil {
		t.Fatalf("seed tracked_apps: %v", err)
	}
	if _, err := env.database.ExecContext(ctx,
		"INSERT INTO containers (user_id, container_id, container_name) VALUES (?, 'c1', 'c1')", env.memberID); err != nil {
		t.Fatalf("seed containers: %v", err)
	}

	r := env.gql(t, admin,
		`query($id: ID!){ user(id: $id){ id containerCount trackedAppCount } }`,
		map[string]any{"id": strconv.FormatInt(env.memberID, 10)})
	if len(r.Errors) != 0 {
		t.Fatalf("stats query errored: %+v", r.Errors)
	}
	var u struct {
		ContainerCount  int `json:"containerCount"`
		TrackedAppCount int `json:"trackedAppCount"`
	}
	if err := json.Unmarshal(r.Data["user"], &u); err != nil {
		t.Fatalf("decode user: %v", err)
	}
	if u.ContainerCount != 1 || u.TrackedAppCount != 1 {
		t.Fatalf("stats = %+v, want 1/1", u)
	}

	r = env.gql(t, admin, `mutation($id: ID!){ deleteUser(userId: $id){ success } }`,
		map[string]any{"id": strconv.FormatInt(env.memberID, 10)})
	if len(r.Errors) != 0 {
		t.Fatalf("deleteUser errored: %+v", r.Errors)
	}
	for _, tbl := range []string{"source_instances", "tracked_apps", "containers"} {
		var n int
		if err := env.database.QueryRowContext(ctx,
			"SELECT COUNT(*) FROM "+tbl+" WHERE user_id = ?", env.memberID).Scan(&n); err != nil {
			t.Fatalf("count %s after cascade: %v", tbl, err)
		}
		if n != 0 {
			t.Fatalf("%s rows left after cascade: %d", tbl, n)
		}
	}
}

// TestLogoutRevokesToken guards the logout revocation path: after the logout
// mutation the same bearer token must be rejected as unauthenticated, closing
// the replay window a stateless JWT would otherwise leave open until its exp
// claim. Revocation is per-token: another user's token is unaffected.
func TestLogoutRevokesToken(t *testing.T) {
	env := newTestEnv(t, true)
	admin := env.token(t, env.adminID, "admin")

	// Pre-logout: the token authenticates.
	r := env.gql(t, admin, `{ me { id username } }`, nil)
	if len(r.Errors) != 0 || r.Data["me"] == nil {
		t.Fatalf("me before logout failed: errors=%+v", r.Errors)
	}

	// Logout revokes exactly the presented token.
	r = env.gql(t, admin, `mutation { logout { success } }`, nil)
	if len(r.Errors) != 0 {
		t.Fatalf("logout errored: %+v", r.Errors)
	}

	// Post-logout: the same token is now rejected as unauthenticated.
	r = env.gql(t, admin, `{ me { id username } }`, nil)
	if len(r.Errors) == 0 {
		t.Fatalf("revoked token still authenticates: data=%s", r.Data["me"])
	}

	// A different user's token is unaffected (revocation is per-token).
	member := env.token(t, env.memberID, "member")
	r = env.gql(t, member, `{ me { id username } }`, nil)
	if len(r.Errors) != 0 || r.Data["me"] == nil {
		t.Fatalf("member token wrongly rejected after admin logout: %+v", r.Errors)
	}
}

func TestUnauthenticatedGraphqlIsRateLimited(t *testing.T) {
	// Public abuse protection replacing Node's authLimiter on the pruned REST
	// auth routes: unauthenticated /graphql gets a per-IP budget.
	env := newTestEnv(t, true)
	for i := 0; i < 60; i++ {
		r := env.gql(t, "", `{ version }`, nil)
		if r.hasErrorContaining("too many requests") {
			t.Fatalf("rate limited too early at request %d", i+1)
		}
	}
	r := env.gql(t, "", `{ version }`, nil)
	if !r.hasErrorContaining("too many requests") {
		t.Fatalf("61st unauthenticated request must be rate limited, got: %+v", r)
	}
	// Authenticated traffic is exempt from the public budget.
	tok := env.token(t, env.adminID, "admin")
	r = env.gql(t, tok, `{ me { id } }`, nil)
	if r.hasErrorContaining("too many requests") {
		t.Fatalf("authenticated traffic must not be rate limited: %+v", r)
	}
}

func TestResolverLimiterDefeatsAuthExemption(t *testing.T) {
	// The per-operation resolver budget applies to authenticated callers too:
	// a member token cannot brute-force verifyInstanceAdminToken past Node's
	// 20-per-15-minutes route limit.
	env := newTestEnv(t, true)
	tok := env.token(t, env.memberID, "member")
	mutation := `mutation($username: String!, $token: String!){ verifyInstanceAdminToken(username: $username, token: $token){ success error } }`
	for i := 0; i < 20; i++ {
		r := env.gqlAs(t, "10.0.2.1", tok, mutation, map[string]any{"username": "ghost", "token": "WRONG-TOKN"})
		if bytes.Contains(r.Data["verifyInstanceAdminToken"], []byte("Too many requests")) {
			t.Fatalf("legitimate budget exhausted too early at attempt %d", i+1)
		}
	}
	r := env.gqlAs(t, "10.0.2.1", tok, mutation, map[string]any{"username": "ghost", "token": "WRONG-TOKN"})
	if !bytes.Contains(r.Data["verifyInstanceAdminToken"], []byte("Too many requests")) {
		t.Fatalf("21st authenticated verify must be limited, got: %+v", r)
	}
}

func TestAliasedMutationsConsumeBudget(t *testing.T) {
	// Aliasing folds many sensitive operations into one HTTP request; the
	// resolver-level limiter counts each execution, so 25 aliases of
	// verifyInstanceAdminToken get 20 attempts and 5 refusals — not 25.
	env := newTestEnv(t, true)
	var sb strings.Builder
	sb.WriteString("mutation {")
	for i := 0; i < 25; i++ {
		fmt.Fprintf(&sb, ` a%d: verifyInstanceAdminToken(username: "ghost", token: "WRONG-TOKN") { success error }`, i)
	}
	sb.WriteString("}")
	r := env.gqlAs(t, "10.0.2.2", "", sb.String(), nil)
	if len(r.Errors) != 0 {
		t.Fatalf("aliased query errored: %+v", r.Errors)
	}
	var limited, invalid int
	for _, raw := range r.Data {
		if bytes.Contains(raw, []byte("Too many requests")) {
			limited++
		}
		if bytes.Contains(raw, []byte("Invalid token")) {
			invalid++
		}
	}
	if invalid != 20 || limited != 5 {
		t.Fatalf("alias budget split = invalid:%d limited:%d, want 20/5", invalid, limited)
	}
}

func TestSpoofedXFFPrefixDoesNotResetBudget(t *testing.T) {
	// The limiter keys on the RIGHTMOST XFF entry (the hop the Node proxy
	// controls). Changing a client-supplied prefix must not mint a new bucket.
	env := newTestEnv(t, true)
	mutation := `mutation($username: String!, $token: String!){ verifyInstanceAdminToken(username: $username, token: $token){ success error } }`
	for i := 0; i < 20; i++ {
		r := env.gqlAs(t, "1.2.3.4, 10.0.2.3", "", mutation, map[string]any{"username": "ghost", "token": "WRONG-TOKN"})
		if bytes.Contains(r.Data["verifyInstanceAdminToken"], []byte("Too many requests")) {
			t.Fatalf("budget exhausted too early at attempt %d", i+1)
		}
	}
	// Different spoofed prefix, same real client (rightmost) → still limited.
	r := env.gqlAs(t, "9.9.9.9, 10.0.2.3", "", mutation, map[string]any{"username": "ghost", "token": "WRONG-TOKN"})
	if !bytes.Contains(r.Data["verifyInstanceAdminToken"], []byte("Too many requests")) {
		t.Fatalf("spoofed prefix must not reset the budget, got: %+v", r)
	}
	// A genuinely different rightmost IP keeps its own budget.
	r = env.gqlAs(t, "10.0.2.4", "", mutation, map[string]any{"username": "ghost", "token": "WRONG-TOKN"})
	if bytes.Contains(r.Data["verifyInstanceAdminToken"], []byte("Too many requests")) {
		t.Fatalf("distinct client must not share the bucket, got: %+v", r)
	}
}

func TestDeletedUserTokenIsRejected(t *testing.T) {
	env := newTestEnv(t, true)
	token := env.token(t, env.memberID, "member")
	if _, err := env.database.Exec("DELETE FROM users WHERE id = ?", env.memberID); err != nil {
		t.Fatalf("delete user: %v", err)
	}
	r := env.gql(t, token, `{ me { id } }`, nil)
	if !r.hasErrorContaining("authentication required") {
		t.Fatalf("deleted user's token must be rejected, got: %+v", r)
	}
}

func TestLoginPasswordCheck(t *testing.T) {
	env := newTestEnv(t, true)

	ok := env.gql(t, "", `mutation($in: LoginInput!){ login(input: $in){ token user { username } } }`,
		map[string]any{"in": map[string]any{"username": "admin", "password": "adminpass"}})
	if len(ok.Errors) != 0 {
		t.Fatalf("valid login errored: %+v", ok.Errors)
	}
	if len(ok.Data["login"]) == 0 {
		t.Fatalf("valid login returned no payload")
	}

	bad := env.gql(t, "", `mutation($in: LoginInput!){ login(input: $in){ token } }`,
		map[string]any{"in": map[string]any{"username": "admin", "password": "wrong"}})
	if !bad.hasErrorContaining("invalid username or password") {
		t.Fatalf("bad login should error, got: %+v", bad)
	}
}

func TestPreferencesPersistUnderNodeKey(t *testing.T) {
	env := newTestEnv(t, true)
	admin := env.token(t, env.adminID, "admin")

	r := env.gql(t, admin, `mutation($in: UpdateUserPreferencesInput!){ updateUserPreferences(input: $in){ success } }`,
		map[string]any{"in": map[string]any{"colorScheme": "dark"}})
	if len(r.Errors) != 0 {
		t.Fatalf("updateUserPreferences errored: %+v", r.Errors)
	}

	// Must be written under the Node-owned key so both backends agree.
	var key string
	err := env.database.QueryRowContext(context.Background(),
		"SELECT key FROM settings WHERE user_id = ? AND key IN ('color_scheme','colorScheme')", env.adminID).Scan(&key)
	if err != nil {
		t.Fatalf("read settings key: %v", err)
	}
	if key != "color_scheme" {
		t.Fatalf("settings key = %q, want color_scheme", key)
	}

	// And read back through GraphQL.
	got := env.gql(t, admin, `{ me { preferences { colorScheme } } }`, nil)
	if len(got.Errors) != 0 {
		t.Fatalf("me.preferences errored: %+v", got.Errors)
	}
	if !bytes.Contains(got.Data["me"], []byte("dark")) {
		t.Fatalf("me.preferences did not return dark: %s", got.Data["me"])
	}
}

func TestBatchUpgradeEmptyListGuard(t *testing.T) {
	env := newTestEnv(t, true)
	admin := env.token(t, env.adminID, "admin")

	// An explicitly empty container list must NOT fall through to upgrading
	// every container; it must be rejected.
	r := env.gql(t, admin, `mutation($in: BatchUpgradeInput!){ batchUpgrade(input: $in){ id } }`,
		map[string]any{"in": map[string]any{"containers": []any{}}})
	if !r.hasErrorContaining("no containers selected") {
		t.Fatalf("empty batchUpgrade should be rejected, got: %+v", r)
	}
}

// TestOperationResolvesBatchRun guards the operation(id) resolver: batch
// operations are persisted in batch_runs and must be pollable by the id that
// batchUpgrade returns ("batch-<runID>"), with the DB status mapped onto the
// OperationStatus enum. Ephemeral (non-batch) ids stay not-found.
func TestOperationResolvesBatchRun(t *testing.T) {
	env := newTestEnv(t, true)
	admin := env.token(t, env.adminID, "admin")

	ctx := context.Background()
	res, err := env.database.ExecContext(ctx,
		"INSERT INTO batch_runs (user_id, job_type, status) VALUES (?, 'upgrade-containers', 'failed')",
		env.adminID)
	if err != nil {
		t.Fatalf("insert batch run: %v", err)
	}
	runID, _ := res.LastInsertId()

	r := env.gql(t, admin, `query($id: ID!){ operation(id: $id){ id type status } }`,
		map[string]any{"id": "batch-" + strconv.FormatInt(runID, 10)})
	if len(r.Errors) != 0 {
		t.Fatalf("operation(batch run) errored: %+v", r.Errors)
	}
	if !bytes.Contains(r.Data["operation"], []byte("FAILED")) {
		t.Fatalf("operation status not mapped to FAILED: %s", r.Data["operation"])
	}

	// A non-batch id has no backing table and must remain not-found.
	if r := env.gql(t, admin, `query($id: ID!){ operation(id: $id){ id } }`,
		map[string]any{"id": "op-123"}); !r.hasErrorContaining("not found") {
		t.Fatalf("ephemeral operation should be not-found, got: %+v", r)
	}
}

// TestBatchJobTypePersistsAndFiltersNodeDomain guards the enum write-side fix
// at the DB level (not just the helper): triggerBatchJob must store the
// Node-domain lowercase/hyphenated job_type, and the batchRuns jobType filter
// must match those lowercase rows. A run written as an UPPER_SNAKE enum member
// would be invisible to both Node's scheduler and this filter.
func TestBatchJobTypePersistsAndFiltersNodeDomain(t *testing.T) {
	env := newTestEnv(t, true)
	admin := env.token(t, env.adminID, "admin")

	// TRACKED_APPS_CHECK enum -> DB must store "tracked-apps-check".
	// (DOCKER_HUB_PULL is honestly rejected by the Go API, so the enum
	// write-side guard uses the job type that is actually implemented.)
	r := env.gql(t, admin, `mutation($jt: BatchJobType){ triggerBatchJob(jobType: $jt){ id jobType } }`,
		map[string]any{"jt": "TRACKED_APPS_CHECK"})
	if len(r.Errors) != 0 {
		t.Fatalf("triggerBatchJob errored: %+v", r.Errors)
	}
	var stored string
	if err := env.database.QueryRowContext(context.Background(),
		"SELECT job_type FROM batch_runs ORDER BY id DESC LIMIT 1").Scan(&stored); err != nil {
		t.Fatalf("read batch run job_type: %v", err)
	}
	if stored != "tracked-apps-check" {
		t.Fatalf("DB job_type = %q, want tracked-apps-check", stored)
	}

	// Seed runs with other (lowercase, Node-domain) job_types so the filter's
	// discrimination is actually exercised, not just "returns 1".
	if _, err := env.database.ExecContext(context.Background(),
		"INSERT INTO batch_runs (user_id, job_type, status) VALUES (?, 'docker-hub-pull', 'completed')",
		env.adminID); err != nil {
		t.Fatalf("seed docker-hub-pull run: %v", err)
	}
	if _, err := env.database.ExecContext(context.Background(),
		"INSERT INTO batch_runs (user_id, job_type, status) VALUES (?, 'app-version-scan', 'completed')",
		env.adminID); err != nil {
		t.Fatalf("seed second run: %v", err)
	}

	// The jobType filter must match the lowercase DB row and return its enum.
	match := env.gql(t, admin, `query($jt: BatchJobType){ batchRuns(jobType: $jt){ totalCount items { id jobType } } }`,
		map[string]any{"jt": "DOCKER_HUB_PULL"})
	if len(match.Errors) != 0 {
		t.Fatalf("batchRuns filter errored: %+v", match.Errors)
	}
	if !bytes.Contains(match.Data["batchRuns"], []byte(`"totalCount":1`)) ||
		!bytes.Contains(match.Data["batchRuns"], []byte("DOCKER_HUB_PULL")) {
		t.Fatalf("batchRuns(jobType:DOCKER_HUB_PULL) did not match the lowercase row: %s", match.Data["batchRuns"])
	}

	// Negative control: the other job type must select only its own row.
	other := env.gql(t, admin, `query($jt: BatchJobType){ batchRuns(jobType: $jt){ totalCount items { jobType } } }`,
		map[string]any{"jt": "APP_VERSION_SCAN"})
	if len(other.Errors) != 0 {
		t.Fatalf("batchRuns negative filter errored: %+v", other.Errors)
	}
	if !bytes.Contains(other.Data["batchRuns"], []byte(`"totalCount":1`)) ||
		!bytes.Contains(other.Data["batchRuns"], []byte("APP_VERSION_SCAN")) {
		t.Fatalf("batchRuns(APP_VERSION_SCAN) should match only its own row, got: %s", other.Data["batchRuns"])
	}
}

// TestUpdateIntentPersistsSafetyFiltersAndRejectsTimezone
func TestUpdateIntentPersistsSafetyFiltersAndRejectsTimezone(t *testing.T) {
	env := newTestEnv(t, true)
	admin := env.token(t, env.adminID, "admin")
	res, err := env.database.Exec(`INSERT INTO intents
		(user_id, name, schedule_type, match_containers, exclude_images, dry_run)
		VALUES (?, 'safe', 'immediate', '["old"]', '["old"]', 0)`, env.adminID)
	if err != nil {
		t.Fatalf("seed intent: %v", err)
	}
	id, _ := res.LastInsertId()

	r := env.gql(t, admin, `mutation($id: ID!, $in: UpdateIntentInput!){
		updateIntent(id: $id, input: $in){ id matchContainers matchRegistries excludeImages excludeRegistries dryRun }
	}`, map[string]any{
		"id": strconv.FormatInt(id, 10),
		"in": map[string]any{
			"matchContainers":   []any{"web-*"},
			"matchRegistries":   []any{"ghcr.io"},
			"excludeImages":     []any{},
			"excludeRegistries": []any{"quay.io"},
			"dryRun":            true,
		},
	})
	if len(r.Errors) != 0 {
		t.Fatalf("updateIntent errored: %+v", r.Errors)
	}

	var matchContainers, matchRegistries, excludeImages, excludeRegistries string
	var dryRun int
	err = env.database.QueryRow(`SELECT match_containers, match_registries, exclude_images,
		exclude_registries, dry_run FROM intents WHERE id = ?`, id).
		Scan(&matchContainers, &matchRegistries, &excludeImages, &excludeRegistries, &dryRun)
	if err != nil {
		t.Fatalf("read intent update: %v", err)
	}
	if matchContainers != `["web-*"]` || matchRegistries != `["ghcr.io"]` ||
		excludeImages != `[]` || excludeRegistries != `["quay.io"]` || dryRun != 1 {
		t.Fatalf("intent safety fields not persisted: containers=%s registries=%s excludeImages=%s excludeRegistries=%s dryRun=%d",
			matchContainers, matchRegistries, excludeImages, excludeRegistries, dryRun)
	}

	unsupported := env.gql(t, admin, `mutation($id: ID!, $in: UpdateIntentInput!){ updateIntent(id: $id, input: $in){ id } }`,
		map[string]any{"id": strconv.FormatInt(id, 10), "in": map[string]any{"scheduleTimezone": "UTC"}})
	if !unsupported.hasErrorContaining("scheduleTimezone is not supported") {
		t.Fatalf("unsupported timezone must be rejected, got: %+v", unsupported)
	}
}

// --- regression tests for the full-sweep findings ---

func TestEntityQueriesReturnNullForMissing(t *testing.T) {
	env := newTestEnv(t, true)
	admin := env.token(t, env.adminID, "admin")

	cases := map[string]string{
		"container":       `query { container(id: "999999") { id } }`,
		"runner":          `query { runner(id: "999999") { id } }`,
		"trackedApp":      `query { trackedApp(id: "999999") { id } }`,
		"intent":          `query { intent(id: "999999") { id } }`,
		"batchRun":        `query { batchRun(id: "999999") { id } }`,
		"discordWebhook":  `query { discordWebhook(id: "999999") { id } }`,
		"repositoryToken": `query { repositoryToken(provider: "github") { id } }`,
	}
	for name, q := range cases {
		r := env.gql(t, admin, q, nil)
		if len(r.Errors) != 0 {
			t.Errorf("%s: missing record must return null, got errors: %+v", name, r.Errors)
			continue
		}
		var v any
		if err := json.Unmarshal(r.Data[name], &v); err != nil {
			t.Errorf("%s: decode data: %v", name, err)
			continue
		}
		if v != nil {
			t.Errorf("%s: expected null, got %v", name, v)
		}
	}
}

func seedContainer(t *testing.T, env *testEnv, name, image, state, stack string, diID, runnerID, sourceID *int64) {
	t.Helper()
	var di, rid, sid any
	if diID != nil {
		di = *diID
	}
	if runnerID != nil {
		rid = *runnerID
	}
	if sourceID != nil {
		sid = *sourceID
	}
	_, err := env.database.Exec(
		`INSERT INTO containers (user_id, container_id, container_name, image_name, image_repo, state, stack_name, deployed_image_id, runner_id, source_instance_id)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		env.adminID, "cid-"+name, name, image, image, state, stack, di, rid, sid)
	if err != nil {
		t.Fatalf("seed container %s: %v", name, err)
	}
}

func totalOf(t *testing.T, r gqlResp, field string) int {
	t.Helper()
	var conn struct {
		TotalCount int `json:"totalCount"`
	}
	if err := json.Unmarshal(r.Data[field], &conn); err != nil {
		t.Fatalf("decode %s: %v (%+v)", field, err, r)
	}
	return conn.TotalCount
}

// TestUpdateUsernameRequiresCorrectPassword guards the REST-parity security
// boundary: a rename must prove knowledge of the current password, so a
// stolen access token alone cannot take over an account.
func TestUpdateUsernameRequiresCorrectPassword(t *testing.T) {
	env := newTestEnv(t, true)
	admin := env.token(t, env.adminID, "admin")
	mut := `mutation($i:UpdateUsernameInput!){ updateUsername(input:$i){ success } }`

	if r := env.gql(t, admin, mut,
		map[string]any{"i": map[string]any{"newUsername": "renamed-ok"}}); !r.hasErrorContaining("password is required") {
		t.Fatalf("missing password must be rejected: %+v", r)
	}
	if r := env.gql(t, admin, mut,
		map[string]any{"i": map[string]any{"newUsername": "renamed-ok", "password": "nope"}}); !r.hasErrorContaining("incorrect") {
		t.Fatalf("wrong password must be rejected: %+v", r)
	}
	if r := env.gql(t, admin, mut,
		map[string]any{"i": map[string]any{"newUsername": "ab", "password": "adminpass"}}); !r.hasErrorContaining("3 characters") {
		t.Fatalf("short username must be rejected: %+v", r)
	}

	r := env.gql(t, admin, mut,
		map[string]any{"i": map[string]any{"newUsername": " renamed-ok ", "password": "adminpass"}})
	if len(r.Errors) != 0 {
		t.Fatalf("valid rename failed: %+v", r)
	}
	var got string
	if err := env.database.QueryRowContext(context.Background(),
		"SELECT username FROM users WHERE id = ?", env.adminID).Scan(&got); err != nil || got != "renamed-ok" {
		t.Fatalf("username = %q (err %v), want trimmed renamed-ok", got, err)
	}
}

// TestUpgradeContainerWritesHistoryAndBlocksConcurrent guards the Node-parity
// contract: every upgrade attempt writes an upgrade_history row, and while an
// upgrade is in flight a second upgrade for the same container is rejected by
// the shared upgrade lock. The mock runner serves the fine-grained Docker API
// the Go pipeline orchestrates against (inspect/list/stop/pull/remove/create/
// start), and the create payload is captured for config-prep parity checks.
func TestUpgradeContainerWritesHistoryAndBlocksConcurrent(t *testing.T) {
	env := newTestEnv(t, true)
	ctx := context.Background()
	admin := env.token(t, env.adminID, "admin")

	var mu sync.Mutex
	var createBody map[string]any
	var createName string
	stopped := false

	runnerSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/containers":
			fmt.Fprint(w, `{"containers":[{"id":"histdocker1","name":"hist-container","image":"nginx:1.24","status":"running","state":"running"}]}`)
		case r.Method == http.MethodGet && r.URL.Path == "/containers/histdocker1/json":
			mu.Lock()
			st := stopped
			mu.Unlock()
			state := `"Status":"running","Running":true`
			if st {
				state = `"Status":"exited","Running":false`
			}
			fmt.Fprintf(w, `{
				"Id":"histdocker1","Name":"/hist-container","Image":"nginx:1.24",
				"State":{%s},
				"Config":{"Image":"nginx:1.24","Env":["A=1"],"Labels":{"app":"hist"},"WorkingDir":"/data","ExposedPorts":{"80/tcp":{}}},
				"HostConfig":{"NetworkMode":"bridge","RestartPolicy":{"Name":"unless-stopped","MaximumRetryCount":0},"Runtime":"runc","AutoRemove":false,"RestartCount":0,"ResolvConfPath":"/var/lib/docker/xxx/resolv.conf","PortBindings":{"80/tcp":[{"HostPort":"8080"}]}},
				"NetworkSettings":{"Networks":{"bridge":{"Aliases":["alias1"]}}}
			}`, state)
		case r.Method == http.MethodGet && r.URL.Path == "/containers/histnew1/json":
			fmt.Fprint(w, `{"Id":"histnew1","Name":"/hist-container","State":{"Status":"running","Running":true}}`)
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/stop"):
			mu.Lock()
			stopped = true
			mu.Unlock()
			w.WriteHeader(http.StatusNoContent)
		case r.Method == http.MethodPost && r.URL.Path == "/images/pull":
			w.WriteHeader(http.StatusOK)
		case r.Method == http.MethodDelete && r.URL.Path == "/containers/histdocker1":
			w.WriteHeader(http.StatusNoContent)
		case r.Method == http.MethodPost && r.URL.Path == "/containers/create":
			body, _ := io.ReadAll(r.Body)
			mu.Lock()
			_ = json.Unmarshal(body, &createBody)
			createName = r.URL.Query().Get("name")
			mu.Unlock()
			fmt.Fprint(w, `{"Id":"histnew1"}`)
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/start"):
			w.WriteHeader(http.StatusNoContent)
		default:
			t.Errorf("unexpected runner request: %s %s", r.Method, r.URL)
			w.WriteHeader(http.StatusInternalServerError)
		}
	}))
	defer runnerSrv.Close()

	res, err := env.database.ExecContext(ctx,
		"INSERT INTO runners (user_id, name, url, api_key, enabled) VALUES (?, 'hist-runner', ?, 'k', 1)",
		env.adminID, runnerSrv.URL)
	if err != nil {
		t.Fatalf("seed runner: %v", err)
	}
	runnerID, _ := res.LastInsertId()
	if _, err := env.database.ExecContext(ctx,
		`INSERT INTO containers (user_id, container_id, container_name, image_name, runner_id)
		 VALUES (?, 'histdocker1', 'hist-container', 'nginx:1.24', ?)`, env.adminID, runnerID); err != nil {
		t.Fatalf("seed container: %v", err)
	}

	mut := `mutation($i:UpgradeContainerInput!){ upgradeContainer(input:$i){ id status } }`
	vars := map[string]any{"i": map[string]any{
		"dockerContainerId": "histdocker1",
		"runnerId":          strconv.FormatInt(runnerID, 10),
		"imageName":         "nginx:1.25",
	}}
	if r := env.gql(t, admin, mut, vars); len(r.Errors) != 0 {
		t.Fatalf("upgrade failed: %+v", r.Errors)
	}
	// The lock is acquired synchronously in the resolver, so the in-flight
	// pipeline (which takes several seconds of readiness polling) must block
	// a second attempt.
	if r := env.gql(t, admin, mut, vars); !r.hasErrorContaining("in progress") {
		t.Fatalf("concurrent upgrade must be rejected by the lock: %+v", r)
	}

	var status, oldImg, newImg string
	deadline := time.Now().Add(30 * time.Second)
	for {
		err = env.database.QueryRowContext(ctx,
			`SELECT status, old_image, new_image FROM upgrade_history WHERE container_id = 'histdocker1'`).
			Scan(&status, &oldImg, &newImg)
		if err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("no upgrade_history row written: %v", err)
		}
		time.Sleep(100 * time.Millisecond)
	}
	if status != "success" || oldImg != "nginx:1.24" || newImg != "nginx:1.25" {
		t.Fatalf("history row wrong: status=%q %q -> %q", status, oldImg, newImg)
	}

	// Config-prep parity with Node's containerConfigService: the create
	// payload keeps the container identity, swaps the image, and strips
	// Docker-managed HostConfig fields.
	mu.Lock()
	defer mu.Unlock()
	if createName != "/hist-container" {
		t.Errorf("create name = %q, want /hist-container (leading slash preserved)", createName)
	}
	if createBody == nil {
		t.Fatalf("no create request captured")
	}
	if createBody["Image"] != "nginx:1.25" {
		t.Errorf("create Image = %v, want nginx:1.25", createBody["Image"])
	}
	if envVal, ok := createBody["Env"].([]any); !ok || len(envVal) != 1 || envVal[0] != "A=1" {
		t.Errorf("create Env = %v, want [A=1]", createBody["Env"])
	}
	if wd, _ := createBody["WorkingDir"].(string); wd != "/data" {
		t.Errorf("create WorkingDir = %v, want /data", createBody["WorkingDir"])
	}
	if ep, ok := createBody["ExposedPorts"].(map[string]any); !ok || len(ep) != 1 {
		t.Errorf("create ExposedPorts = %v, want {80/tcp:{}}", createBody["ExposedPorts"])
	}
	if nc, ok := createBody["NetworkingConfig"].(map[string]any); !ok {
		t.Errorf("create NetworkingConfig missing: %v", createBody)
	} else if epc, ok := nc["EndpointsConfig"].(map[string]any); !ok {
		t.Errorf("NetworkingConfig.EndpointsConfig missing: %v", nc)
	} else if br, ok := epc["bridge"].(map[string]any); !ok {
		t.Errorf("EndpointsConfig.bridge missing: %v", epc)
	} else if al, ok := br["Aliases"].([]any); !ok || len(al) != 1 {
		t.Errorf("EndpointsConfig.bridge.Aliases = %v, want [alias1]", br["Aliases"])
	}
	hc, ok := createBody["HostConfig"].(map[string]any)
	if !ok {
		t.Fatalf("create HostConfig missing: %v", createBody)
	}
	for _, banned := range []string{"Runtime", "AutoRemove", "RestartCount", "ResolvConfPath", "HostnamePath", "HostsPath", "ContainerIDFile"} {
		if _, present := hc[banned]; present {
			t.Errorf("HostConfig must strip %s", banned)
		}
	}
	if hc["NetworkMode"] != "bridge" {
		t.Errorf("HostConfig.NetworkMode = %v, want bridge", hc["NetworkMode"])
	}
	if pb, ok := hc["PortBindings"].(map[string]any); !ok || len(pb) != 1 {
		t.Errorf("HostConfig.PortBindings = %v, want preserved on bridge network", hc["PortBindings"])
	}
	if rp, ok := hc["RestartPolicy"].(map[string]any); !ok || rp["Name"] != "unless-stopped" {
		t.Errorf("HostConfig.RestartPolicy = %v, want Name=unless-stopped", hc["RestartPolicy"])
	}
}

func TestContainersFilterAndPagination(t *testing.T) {
	env := newTestEnv(t, true)
	admin := env.token(t, env.adminID, "admin")

	res, err := env.database.Exec(
		"INSERT INTO runners (user_id, name, url, api_key) VALUES (?, 'r1', 'http://runner', 'k')", env.adminID)
	if err != nil {
		t.Fatalf("seed runner: %v", err)
	}
	runnerID, _ := res.LastInsertId()
	res, err = env.database.Exec(
		"INSERT INTO source_instances (user_id, name, url, auth_type) VALUES (?, 'src', 'http://x', 'apikey')", env.adminID)
	if err != nil {
		t.Fatalf("seed source: %v", err)
	}
	sourceID, _ := res.LastInsertId()
	res, err = env.database.Exec(
		`INSERT INTO deployed_images (user_id, image_repo, image_tag, image_digest, repo_digests)
		 VALUES (?, 'nginx', '1.24', 'sha256:aaa', '["nginx@sha256:aaa"]')`, env.adminID)
	if err != nil {
		t.Fatalf("seed deployed image: %v", err)
	}
	diID, _ := res.LastInsertId()
	_, err = env.database.Exec(
		`INSERT INTO registry_image_versions (user_id, image_repo, tag, latest_digest, provider)
		 VALUES (?, 'nginx', '1.24', 'sha256:bbb', 'docker-hub')`, env.adminID)
	if err != nil {
		t.Fatalf("seed registry version: %v", err)
	}

	seedContainer(t, env, "web", "nginx:1.24", "running", "frontend", &diID, &runnerID, nil)
	seedContainer(t, env, "db", "postgres:16", "exited", "backend", nil, &runnerID, nil)
	seedContainer(t, env, "cache", "redis:7", "running", "", nil, nil, &sourceID)

	cases := []struct {
		filter string
		want   int
	}{
		{`{ containers { totalCount } }`, 3},
		{`{ containers(filter: { state: RUNNING }) { totalCount } }`, 2},
		{`{ containers(filter: { imageName: "nginx" }) { totalCount } }`, 1},
		{`{ containers(filter: { search: "web" }) { totalCount } }`, 1},
		{`{ containers(filter: { search: "redis" }) { totalCount } }`, 1},
		{`{ containers(filter: { stackName: "backend" }) { totalCount } }`, 1},
		{`{ containers(filter: { hasUpdate: true }) { totalCount } }`, 1},
		{`{ containers(filter: { hasUpdate: false }) { totalCount } }`, 2},
		{fmt.Sprintf(`{ containers(filter: { runnerId: %q }) { totalCount } }`, strconv.FormatInt(runnerID, 10)), 2},
		{`{ containers(filter: { state: RUNNING, hasUpdate: true }) { totalCount } }`, 1},
	}
	for _, c := range cases {
		r := env.gql(t, admin, c.filter, nil)
		if len(r.Errors) != 0 {
			t.Fatalf("query %s errored: %+v", c.filter, r.Errors)
		}
		if got := totalOf(t, r, "containers"); got != c.want {
			t.Errorf("query %s: totalCount=%d want %d", c.filter, got, c.want)
		}
	}

	// The displayed imageInfo.hasUpdate must agree with the filter (same
	// computation), otherwise filtered queries appear to "leak" rows.
	r := env.gql(t, admin, `{ containers(filter: { hasUpdate: true }) { items { imageInfo { hasUpdate } } } }`, nil)
	if len(r.Errors) != 0 {
		t.Fatalf("hasUpdate items query errored: %+v", r.Errors)
	}
	var items struct {
		Items []struct {
			ImageInfo *struct {
				HasUpdate bool `json:"hasUpdate"`
			} `json:"imageInfo"`
		} `json:"items"`
	}
	if err := json.Unmarshal(r.Data["containers"], &items); err != nil {
		t.Fatalf("decode hasUpdate items: %v", err)
	}
	if len(items.Items) != 1 || items.Items[0].ImageInfo == nil || !items.Items[0].ImageInfo.HasUpdate {
		t.Fatalf("filter/imageInfo disagree: %+v", items.Items)
	}

	// Pagination over the filtered set.
	r = env.gql(t, admin, `{ containers(first: 2) { totalCount items { id } pageInfo { hasNextPage } } }`, nil)
	var conn struct {
		TotalCount int           `json:"totalCount"`
		Items      []interface{} `json:"items"`
		PageInfo   struct {
			HasNextPage bool `json:"hasNextPage"`
		} `json:"pageInfo"`
	}
	if err := json.Unmarshal(r.Data["containers"], &conn); err != nil {
		t.Fatalf("decode page: %v", err)
	}
	if conn.TotalCount != 3 || len(conn.Items) != 2 || !conn.PageInfo.HasNextPage {
		t.Fatalf("pagination wrong: %+v", conn)
	}
}

// TestContainersLiveRunnerMerge guards the appendRunnerContainers parity: live
// runner data replaces DB runner rows for reachable runners (with registry
// data joined from the shared DB and the providesNetwork two-pass applied),
// while rows for unreachable runners are kept.
func TestContainersLiveRunnerMerge(t *testing.T) {
	env := newTestEnv(t, true)
	admin := env.token(t, env.adminID, "admin")

	runnerSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"containers":[
			{"id":"livedocker1","name":"live-web","image":"nginx:1.24","status":"running","state":"running","repoDigests":["nginx@sha256:aaa"],"networkMode":"container:livedocker2"},
			{"id":"livedocker2","name":"live-provider","image":"redis:7","status":"running","state":"running"}
		]}`)
	}))
	defer runnerSrv.Close()

	ctx := context.Background()
	res, err := env.database.ExecContext(ctx,
		"INSERT INTO runners (user_id, name, url, api_key, enabled) VALUES (?, 'live-runner', ?, 'k', 1)",
		env.adminID, runnerSrv.URL)
	if err != nil {
		t.Fatalf("seed runner: %v", err)
	}
	runnerID, _ := res.LastInsertId()
	if _, err := env.database.ExecContext(ctx,
		`INSERT INTO registry_image_versions (user_id, image_repo, tag, latest_digest, provider)
		 VALUES (?, 'nginx', '1.24', 'sha256:bbb', 'docker-hub')`, env.adminID); err != nil {
		t.Fatalf("seed registry version: %v", err)
	}
	// Stale DB row for the reachable runner: must be replaced by live data.
	seedContainer(t, env, "stale-c", "nginx:1.20", "running", "", nil, &runnerID, nil)

	const q = `{ containers { totalCount items { dockerContainerId name providesNetwork imageInfo { hasUpdate } } } }`
	r := env.gql(t, admin, q, nil)
	if len(r.Errors) != 0 {
		t.Fatalf("containers errored: %+v", r.Errors)
	}
	var conn struct {
		TotalCount int `json:"totalCount"`
		Items      []struct {
			DockerContainerID string `json:"dockerContainerId"`
			Name              string `json:"name"`
			ProvidesNetwork   bool   `json:"providesNetwork"`
			ImageInfo         *struct {
				HasUpdate bool `json:"hasUpdate"`
			} `json:"imageInfo"`
		} `json:"items"`
	}
	if err := json.Unmarshal(r.Data["containers"], &conn); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if conn.TotalCount != 2 {
		t.Fatalf("stale runner row must be replaced: %+v", conn)
	}
	byName := map[string]bool{}
	for _, item := range conn.Items {
		byName[item.Name] = true
		switch item.Name {
		case "live-web":
			if item.ImageInfo == nil || !item.ImageInfo.HasUpdate {
				t.Errorf("live-web registry enrichment missing: %+v", item)
			}
		case "live-provider":
			if !item.ProvidesNetwork {
				t.Errorf("live-provider must provide network: %+v", item)
			}
		}
	}
	if !byName["live-web"] || !byName["live-provider"] || byName["stale-c"] {
		t.Fatalf("merge wrong: %+v", conn.Items)
	}

	// Unreachable runner: DB rows are kept (stale beats missing). The stale
	// row seeded above is still in the table — the merge only affects reads.
	runnerSrv.Close()
	r = env.gql(t, admin, q, nil)
	if got := totalOf(t, r, "containers"); got != 1 {
		t.Fatalf("unreachable runner must keep DB rows: got %d", got)
	}
}

// TestUpgradeContainerLiveFallback: runner containers are only persisted to
// the containers table on upgrade, so a never-upgraded container has no DB
// row; the resolver must resolve it live from the runner and the full
// orchestration pipeline must run against it.
func TestUpgradeContainerLiveFallback(t *testing.T) {
	env := newTestEnv(t, true)
	ctx := context.Background()
	admin := env.token(t, env.adminID, "admin")

	runnerSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodGet && r.URL.Path == "/containers":
			fmt.Fprint(w, `{"containers":[{"id":"livedocker1","name":"live-c","image":"nginx:1.24","status":"running","state":"running"}]}`)
		case r.Method == http.MethodGet && r.URL.Path == "/containers/livedocker1/json":
			fmt.Fprint(w, `{
				"Id":"livedocker1","Name":"/live-c","Image":"nginx:1.24",
				"State":{"Status":"exited","Running":false},
				"Config":{"Image":"nginx:1.24","Env":["A=1"]},
				"HostConfig":{"NetworkMode":"bridge","RestartPolicy":{"Name":"unless-stopped"}}
			}`)
		case r.Method == http.MethodGet && r.URL.Path == "/containers/livenew1/json":
			fmt.Fprint(w, `{"Id":"livenew1","Name":"/live-c","State":{"Status":"running","Running":true}}`)
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/stop"):
			w.WriteHeader(http.StatusNoContent)
		case r.Method == http.MethodPost && r.URL.Path == "/images/pull":
			w.WriteHeader(http.StatusOK)
		case r.Method == http.MethodDelete && r.URL.Path == "/containers/livedocker1":
			w.WriteHeader(http.StatusNoContent)
		case r.Method == http.MethodPost && r.URL.Path == "/containers/create":
			fmt.Fprint(w, `{"Id":"livenew1"}`)
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/start"):
			w.WriteHeader(http.StatusNoContent)
		default:
			t.Errorf("unexpected runner request: %s %s", r.Method, r.URL)
			w.WriteHeader(http.StatusInternalServerError)
		}
	}))
	defer runnerSrv.Close()

	res, err := env.database.ExecContext(ctx,
		"INSERT INTO runners (user_id, name, url, api_key, enabled) VALUES (?, 'fb-runner', ?, 'k', 1)",
		env.adminID, runnerSrv.URL)
	if err != nil {
		t.Fatalf("seed runner: %v", err)
	}
	runnerID, _ := res.LastInsertId()

	mut := `mutation($i:UpgradeContainerInput!){ upgradeContainer(input:$i){ id status } }`
	vars := map[string]any{"i": map[string]any{
		"dockerContainerId": "livedocker1",
		"runnerId":          strconv.FormatInt(runnerID, 10),
		"imageName":         "nginx:1.25",
	}}
	if r := env.gql(t, admin, mut, vars); len(r.Errors) != 0 {
		t.Fatalf("live-fallback upgrade failed: %+v", r.Errors)
	}

	var status, oldImg, newImg string
	deadline := time.Now().Add(30 * time.Second)
	for {
		err = env.database.QueryRowContext(ctx,
			`SELECT status, old_image, new_image FROM upgrade_history WHERE container_id = 'livedocker1'`).
			Scan(&status, &oldImg, &newImg)
		if err == nil {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("no upgrade_history row written: %v", err)
		}
		time.Sleep(100 * time.Millisecond)
	}
	if status != "success" || oldImg != "nginx:1.24" || newImg != "nginx:1.25" {
		t.Fatalf("history row wrong: status=%q %q -> %q", status, oldImg, newImg)
	}
}

func TestUpgradeHistoryFilter(t *testing.T) {
	env := newTestEnv(t, true)
	admin := env.token(t, env.adminID, "admin")

	seed := func(name, status, createdAt string) {
		if _, err := env.database.Exec(
			`INSERT INTO upgrade_history (user_id, container_id, container_name, old_image, new_image, status, created_at)
			 VALUES (?, ?, ?, 'img:1', 'img:2', ?, ?)`, env.adminID, "cid-"+name, name, status, createdAt); err != nil {
			t.Fatalf("seed upgrade history %s: %v", name, err)
		}
	}
	seed("web", "success", "2026-10-01 10:00:00")
	seed("db", "failed", "2026-10-02 10:00:00")
	seed("webby", "skipped", "2026-10-03 10:00:00")

	cases := []struct {
		filter string
		want   int
	}{
		{`{ upgradeHistory { totalCount } }`, 3},
		{`{ upgradeHistory(filter: { containerName: "web" }) { totalCount } }`, 2},
		{`{ upgradeHistory(filter: { status: FAILED }) { totalCount } }`, 1},
		{`{ upgradeHistory(filter: { from: "2026-10-02T00:00:00Z", to: "2026-10-02T23:59:59Z" }) { totalCount } }`, 1},
		{`{ upgradeHistory(filter: { containerName: "web", status: SKIPPED }) { totalCount } }`, 1},
	}
	for _, c := range cases {
		r := env.gql(t, admin, c.filter, nil)
		if len(r.Errors) != 0 {
			t.Fatalf("query %s errored: %+v", c.filter, r.Errors)
		}
		if got := totalOf(t, r, "upgradeHistory"); got != c.want {
			t.Errorf("query %s: totalCount=%d want %d", c.filter, got, c.want)
		}
	}
}

func TestIntentExecutionsRelations(t *testing.T) {
	env := newTestEnv(t, true)
	admin := env.token(t, env.adminID, "admin")

	res, err := env.database.Exec(
		`INSERT INTO intents (user_id, name, schedule_type) VALUES (?, 'i1', 'immediate')`, env.adminID)
	if err != nil {
		t.Fatalf("seed intent: %v", err)
	}
	intentID, _ := res.LastInsertId()
	res, err = env.database.Exec(
		`INSERT INTO intent_executions (intent_id, user_id, status, trigger_type, started_at)
		 VALUES (?, ?, 'completed', 'manual', '2026-10-01 10:00:00')`, intentID, env.adminID)
	if err != nil {
		t.Fatalf("seed execution 1: %v", err)
	}
	res, err = env.database.Exec(
		`INSERT INTO intent_executions (intent_id, user_id, status, trigger_type, started_at)
		 VALUES (?, ?, 'failed', 'scheduled', '2026-10-02 10:00:00')`, intentID, env.adminID)
	if err != nil {
		t.Fatalf("seed execution 2: %v", err)
	}
	e2, _ := res.LastInsertId()
	if _, err := env.database.Exec("UPDATE intents SET last_execution_id = ? WHERE id = ?", e2, intentID); err != nil {
		t.Fatalf("link last execution: %v", err)
	}

	r := env.gql(t, admin, `{ intents { id executions(first: 5) { totalCount items { id status } } lastExecution { id status } } }`, nil)
	if len(r.Errors) != 0 {
		t.Fatalf("intents with executions errored: %+v", r.Errors)
	}
	var out []struct {
		ID         string `json:"id"`
		Executions struct {
			TotalCount int `json:"totalCount"`
			Items      []struct {
				ID     string `json:"id"`
				Status string `json:"status"`
			} `json:"items"`
		} `json:"executions"`
		LastExecution *struct {
			ID     string `json:"id"`
			Status string `json:"status"`
		} `json:"lastExecution"`
	}
	if err := json.Unmarshal(r.Data["intents"], &out); err != nil {
		t.Fatalf("decode intents: %v", err)
	}
	if len(out) != 1 {
		t.Fatalf("want 1 intent, got %d", len(out))
	}
	ig := out[0]
	if ig.Executions.TotalCount != 2 || len(ig.Executions.Items) != 2 {
		t.Fatalf("executions connection wrong: %+v", ig.Executions)
	}
	if ig.LastExecution == nil || ig.LastExecution.ID != strconv.FormatInt(e2, 10) || ig.LastExecution.Status != "FAILED" {
		t.Fatalf("lastExecution wrong: %+v (want id=%d FAILED)", ig.LastExecution, e2)
	}
}

func TestBatchAndPullGuards(t *testing.T) {
	env := newTestEnv(t, true)
	admin := env.token(t, env.adminID, "admin")

	if r := env.gql(t, admin, `mutation { pullContainers(runnerId: "999999") { id } }`, nil); !r.hasErrorContaining("runner not found") {
		t.Fatalf("pullContainers with unknown runner must report not found, got: %+v", r)
	}
	// Container sync now runs in Go: the mutation kicks off an async
	// docker-hub-pull batch run and reports RUNNING immediately.
	r := env.gql(t, admin, `mutation { pullContainers { id type status } }`, nil)
	if len(r.Errors) != 0 {
		t.Fatalf("pullContainers must be accepted, got: %+v", r.Errors)
	}
	var op struct {
		Type   string `json:"type"`
		Status string `json:"status"`
	}
	if err := json.Unmarshal(r.Data["pullContainers"], &op); err != nil {
		t.Fatalf("decode pull op: %v", err)
	}
	if op.Type != "PULL_CONTAINERS" || op.Status != "RUNNING" {
		t.Fatalf("pull op wrong: %+v", op)
	}
	if r := env.gql(t, admin, `mutation { triggerBatchJob(jobType: DOCKER_HUB_PULL) { id } }`, nil); !r.hasErrorContaining("not supported") {
		t.Fatalf("DOCKER_HUB_PULL batch job must be rejected honestly, got: %+v", r)
	}

	r = env.gql(t, admin, `mutation { triggerBatchJob(jobType: TRACKED_APPS_CHECK) { id jobType status isManual } }`, nil)
	if len(r.Errors) != 0 {
		t.Fatalf("TRACKED_APPS_CHECK must be accepted, got: %+v", r.Errors)
	}
	var out struct {
		ID       string `json:"id"`
		JobType  string `json:"jobType"`
		Status   string `json:"status"`
		IsManual bool   `json:"isManual"`
	}
	if err := json.Unmarshal(r.Data["triggerBatchJob"], &out); err != nil {
		t.Fatalf("decode batch run: %v", err)
	}
	if out.JobType != "TRACKED_APPS_CHECK" || !out.IsManual {
		t.Fatalf("batch run fields wrong: %+v", out)
	}

	// Phase 6c: app-version-scan is Go-owned too. No runners in the fixture,
	// so the async scan completes with 0/0 — poll the row to 'completed'.
	r = env.gql(t, admin, `mutation { triggerBatchJob(jobType: APP_VERSION_SCAN) { id jobType status isManual } }`, nil)
	if len(r.Errors) != 0 {
		t.Fatalf("APP_VERSION_SCAN must be accepted, got: %+v", r.Errors)
	}
	var appOut struct {
		ID       string `json:"id"`
		JobType  string `json:"jobType"`
		Status   string `json:"status"`
		IsManual bool   `json:"isManual"`
	}
	if err := json.Unmarshal(r.Data["triggerBatchJob"], &appOut); err != nil {
		t.Fatalf("decode app-version batch run: %v", err)
	}
	if appOut.JobType != "APP_VERSION_SCAN" || !appOut.IsManual || appOut.Status != "RUNNING" {
		t.Fatalf("app-version batch run fields wrong: %+v", appOut)
	}
	runID := appOut.ID
	deadline := time.Now().Add(5 * time.Second)
	var final string
	for {
		if err := env.database.QueryRowContext(context.Background(),
			"SELECT status FROM batch_runs WHERE id = ?", runID).Scan(&final); err != nil {
			t.Fatalf("read app-version run status: %v", err)
		}
		if final != "running" || time.Now().After(deadline) {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if final != "completed" {
		t.Fatalf("app-version batch run ended %q, want completed", final)
	}
}

func TestUploadAvatarRequiresMultipartTransport(t *testing.T) {
	env := newTestEnv(t, true)
	admin := env.token(t, env.adminID, "admin")

	// A JSON body cannot carry a real file; the scalar must explain the
	// multipart requirement instead of silently accepting a placeholder.
	r := env.gql(t, admin, `mutation Q($f: Upload!) { uploadAvatar(file: $f) { success } }`,
		map[string]any{"f": map[string]any{"filename": "x.png"}})
	if !r.hasErrorContaining("multipart") {
		t.Fatalf("JSON upload attempt must explain the multipart requirement, got: %+v", r)
	}
}

// The AroundOperations guard caps per-request cost so aliasing/list fan-out
// cannot amplify DB and network work without bound. The client's heaviest
// real queries sit far below the budget; a 600-way aliased list blows past it.
func TestQueryComplexityGuard(t *testing.T) {
	env := newTestEnv(t, true)
	admin := env.token(t, env.adminID, "admin")

	// Static cost model: each aliased `trackedApps { id }` costs 2, so 5100
	// aliases blow the 10000 budget.
	heavy := "query { " + strings.Repeat("a: trackedApps { id } ", 5100) + " }"
	resp := env.gql(t, admin, heavy, nil)
	if !resp.hasErrorContaining("query too complex") {
		t.Fatalf("over-budget query accepted; errors=%v", resp.Errors)
	}

	// A normal query must still pass the same guard.
	resp = env.gql(t, admin, "query { version { version } }", nil)
	if len(resp.Errors) != 0 {
		t.Fatalf("normal query rejected: %v", resp.Errors)
	}
}

// --- small DB helpers used by assertions ---

func dbRole(t *testing.T, database *sql.DB, id int64) string {
	t.Helper()
	var role string
	if err := database.QueryRowContext(context.Background(), "SELECT role FROM users WHERE id = ?", id).Scan(&role); err != nil {
		t.Fatalf("read role for id=%d: %v", id, err)
	}
	return role
}

func dbIDByUsername(t *testing.T, database *sql.DB, username string) int64 {
	t.Helper()
	var id int64
	if err := database.QueryRowContext(context.Background(), "SELECT id FROM users WHERE username = ?", username).Scan(&id); err != nil {
		t.Fatalf("read id for %q: %v", username, err)
	}
	return id
}
