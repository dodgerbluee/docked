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
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/dockedapp/backend/internal/auth"
	"github.com/dockedapp/backend/internal/config"
	"github.com/dockedapp/backend/internal/db"
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
	env.ts = httptest.NewServer(NewServer(cfg, database))
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
	r := env.gql(t, "", `mutation($in: RegisterInput!){ register(input: $in){ user { username role } } }`,
		map[string]any{"in": map[string]any{"username": "newbie", "password": "pw12345"}})
	if len(r.Errors) != 0 {
		t.Fatalf("register errored: %+v", r.Errors)
	}
	if got := dbRole(t, env.database, dbIDByUsername(t, env.database, "newbie")); got != "Member" {
		t.Fatalf("second-user DB role = %q, want Member", got)
	}
}

func TestFirstRegistrationBecomesAdministrator(t *testing.T) {
	// Empty DB: the first user must be an Administrator with instance_admin=1.
	env := newTestEnv(t, false)
	r := env.gql(t, "", `mutation($in: RegisterInput!){ register(input: $in){ user { username role } } }`,
		map[string]any{"in": map[string]any{"username": "root", "password": "pw12345"}})
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
