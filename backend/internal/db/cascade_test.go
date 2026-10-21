package db

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// newMigratedTestDB opens a fresh database with the full migrated schema,
// so cascade and claim tests see every real table.
func newMigratedTestDB(t *testing.T) *sql.DB {
	t.Helper()
	database, err := Open(filepath.Join(t.TempDir(), "cascade-test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if err := Migrate(context.Background(), database); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return database
}

func countRows(t *testing.T, database *sql.DB, query string, args ...any) int {
	t.Helper()
	var n int
	if err := database.QueryRow(query, args...).Scan(&n); err != nil {
		t.Fatalf("count %q: %v", query, err)
	}
	return n
}

// The atomic claim must reject a second 'running' row for the same
// user+job (the old check-then-insert pair raced across processes), allow
// different jobs/users, and free the slot once the run completes.
func TestCreateBatchRunIfNoneRunningAtomicClaim(t *testing.T) {
	database := newMigratedTestDB(t)
	ctx := context.Background()

	id1, err := CreateBatchRunIfNoneRunning(ctx, database, 1, "docker-hub-pull", true)
	if err != nil {
		t.Fatalf("first claim: %v", err)
	}
	if _, err := CreateBatchRunIfNoneRunning(ctx, database, 1, "docker-hub-pull", true); !errors.Is(err, ErrBatchRunActive) {
		t.Fatalf("second claim err = %v, want ErrBatchRunActive", err)
	}
	if _, err := CreateBatchRunIfNoneRunning(ctx, database, 1, "tracked-apps-check", true); err != nil {
		t.Fatalf("different job type blocked: %v", err)
	}
	if _, err := CreateBatchRunIfNoneRunning(ctx, database, 2, "docker-hub-pull", true); err != nil {
		t.Fatalf("different user blocked: %v", err)
	}

	// Concurrent racers: exactly one winner.
	var mu sync.Mutex
	winners := 0
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := CreateBatchRunIfNoneRunning(ctx, database, 3, "docker-hub-pull", false); err == nil {
				mu.Lock()
				winners++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if winners != 1 {
		t.Errorf("concurrent winners = %d, want exactly 1", winners)
	}

	// Completing the run frees the slot.
	if err := CompleteBatchRun(ctx, database, id1, "completed", 0, 0, nil); err != nil {
		t.Fatalf("complete: %v", err)
	}
	if _, err := CreateBatchRunIfNoneRunning(ctx, database, 1, "docker-hub-pull", false); err != nil {
		t.Fatalf("claim after completion: %v", err)
	}
}

// deleteUser must remove every user-scoped row (not just the original seven
// tables) while deliberately keeping revoked_tokens (replay protection must
// outlive the user).
func TestDeleteUserCascadesAllUserRows(t *testing.T) {
	database := newMigratedTestDB(t)
	ctx := context.Background()

	uid, err := CreateUser(ctx, database, "victim", "hash", "Member", 0)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	other, err := CreateUser(ctx, database, "survivor", "hash", "Member", 0)
	if err != nil {
		t.Fatalf("create other: %v", err)
	}

	seeds := []struct {
		query string
		args  []any
	}{
		{`INSERT INTO containers (user_id, container_id, container_name, image_name, image_repo) VALUES (?, 'cid', 'c1', 'img:1', 'img')`, []any{uid}},
		{`INSERT INTO tracked_apps (user_id, name) VALUES (?, 'app1')`, []any{uid}},
		{`INSERT INTO discord_webhooks (user_id, webhook_url) VALUES (?, 'https://x')`, []any{uid}},
		{`INSERT INTO settings (user_id, key, value) VALUES (?, 'k', 'v')`, []any{uid}},
		{`INSERT INTO batch_config (user_id, job_type) VALUES (?, 'docker-hub-pull')`, []any{uid}},
		{`INSERT INTO batch_runs (user_id, job_type, status) VALUES (?, 'docker-hub-pull', 'completed')`, []any{uid}},
		{`INSERT INTO discord_notifications_sent (user_id, deduplication_key, notification_type) VALUES (?, 'k1', 'tracked_app')`, []any{uid}},
		{`INSERT INTO intents (user_id, name, match_containers) VALUES (?, 'i1', '[]')`, []any{uid}},
		{`INSERT INTO intent_executions (intent_id, user_id, trigger_type, status) VALUES ((SELECT id FROM intents WHERE user_id = ?), ?, 'manual', 'completed')`, []any{uid, uid}},
		{`INSERT INTO registry_image_versions (user_id, image_repo, registry, repository) VALUES (?, 'r', 'docker.io', 'repo')`, []any{uid}},
		{`INSERT INTO repository_access_tokens (user_id, provider, name, access_token) VALUES (?, 'github', 't', 'tok')`, []any{uid}},
		{`INSERT INTO upgrade_history (user_id, container_id, container_name, old_image, new_image) VALUES (?, 'cid', 'c1', 'a:1', 'a:2')`, []any{uid}},
		{`INSERT INTO tracked_app_upgrade_history (user_id, app_name, provider, repository, old_version, new_version) VALUES (?, 'app1', 'docker', 'repo', '1', '2')`, []any{uid}},
		{`INSERT INTO runners (user_id, name, url, api_key) VALUES (?, 'r1', 'http://r1', 'k')`, []any{uid}},
		{`INSERT INTO pending_auth_tokens (kind, username, token) VALUES ('password_change', 'victim', 'tok')`, nil},
		{`INSERT INTO revoked_tokens (token_hash, user_id, expires_at) VALUES ('h1', ?, 9999999999)`, []any{uid}},
		// Same-shaped rows for the other user must survive.
		{`INSERT INTO containers (user_id, container_id, container_name, image_name, image_repo) VALUES (?, 'cid2', 'c2', 'img:1', 'img')`, []any{other}},
		{`INSERT INTO runners (user_id, name, url, api_key) VALUES (?, 'r2', 'http://r2', 'k')`, []any{other}},
	}
	for _, s := range seeds {
		if _, err := database.Exec(s.query, s.args...); err != nil {
			t.Fatalf("seed %q: %v", strings.SplitN(s.query, " ", 4)[3], err)
		}
	}

	changes, err := DeleteUser(ctx, database, uid)
	if err != nil {
		t.Fatalf("delete user: %v", err)
	}
	if changes != 1 {
		t.Fatalf("changes = %d, want 1", changes)
	}

	for _, tbl := range []string{
		"containers", "tracked_apps", "discord_webhooks", "settings", "batch_config",
		"batch_runs", "discord_notifications_sent", "intents", "intent_executions",
		"registry_image_versions", "repository_access_tokens", "upgrade_history",
		"tracked_app_upgrade_history", "runners",
	} {
		if n := countRows(t, database, "SELECT COUNT(*) FROM "+tbl+" WHERE user_id = ?", uid); n != 0 {
			t.Errorf("%s: %d rows left for deleted user", tbl, n)
		}
	}
	if n := countRows(t, database, "SELECT COUNT(*) FROM pending_auth_tokens WHERE username = 'victim'"); n != 0 {
		t.Errorf("pending_auth_tokens: %d rows left for deleted username", n)
	}
	// Revoked tokens must outlive the user to keep blocking replay.
	if n := countRows(t, database, "SELECT COUNT(*) FROM revoked_tokens WHERE user_id = ?", uid); n != 1 {
		t.Errorf("revoked_tokens: got %d rows, want the entry kept", n)
	}
	// Other user's rows untouched.
	for _, tbl := range []string{"containers", "runners"} {
		if n := countRows(t, database, "SELECT COUNT(*) FROM "+tbl+" WHERE user_id = ?", other); n == 0 {
			t.Errorf("%s: other user's rows were deleted", tbl)
		}
	}
}
