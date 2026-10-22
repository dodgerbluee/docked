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

// FK enforcement is off (Node parity), so DeleteRunner must clear the
// dependent rows itself: events and enrollment tokens go away, container
// rows sourced from the runner go away, and upgrade_history keeps its rows
// with the runner reference nulled (the schema's SET NULL intent).
func TestDeleteRunnerRemovesDependents(t *testing.T) {
	database := newMigratedTestDB(t)
	ctx := context.Background()
	uid, err := CreateUser(ctx, database, "cascade-runner", "hash", "Administrator", 1)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	rid, err := CreateRunner(ctx, database, uid, "r1", "http://runner.invalid", "key")
	if err != nil {
		t.Fatalf("create runner: %v", err)
	}
	seed := []struct {
		stmt string
		args []any
	}{
		{`INSERT INTO runner_events (runner_id, event_type, message) VALUES (?, 'heartbeat', 'up')`, []any{rid}},
		{`INSERT INTO containers (user_id, container_id, container_name, image_name, image_repo, runner_id)
		  VALUES (?, 'abc123def456', 'web', 'img:1', 'img', ?)`, []any{uid, rid}},
		{`INSERT INTO upgrade_history (user_id, container_id, container_name, old_image, new_image, runner_id)
		  VALUES (?, 'abc123def456', 'web', 'img:1', 'img:2', ?)`, []any{uid, rid}},
	}
	for _, s := range seed {
		if _, err := database.ExecContext(ctx, s.stmt, s.args...); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	if err := DeleteRunner(ctx, database, rid, uid); err != nil {
		t.Fatalf("delete runner: %v", err)
	}
	if n := countRows(t, database, `SELECT COUNT(*) FROM runner_events WHERE runner_id = ?`, rid); n != 0 {
		t.Errorf("runner_events left: %d", n)
	}
	if n := countRows(t, database, `SELECT COUNT(*) FROM containers WHERE runner_id = ?`, rid); n != 0 {
		t.Errorf("runner-sourced containers left: %d", n)
	}
	if n := countRows(t, database, `SELECT COUNT(*) FROM upgrade_history WHERE runner_id = ?`, rid); n != 0 {
		t.Errorf("upgrade_history runner refs not nulled: %d", n)
	}
	if n := countRows(t, database, `SELECT COUNT(*) FROM upgrade_history WHERE container_id = 'abc123def456'`); n != 1 {
		t.Errorf("upgrade_history row should survive with nulled ref, got %d", n)
	}
}

// intent_execution_containers and runner_events have no user_id column;
// DeleteUser must clear them through their parents before the parents go.
func TestDeleteUserClearsGrandchildren(t *testing.T) {
	database := newMigratedTestDB(t)
	ctx := context.Background()
	uid, err := CreateUser(ctx, database, "cascade-user", "hash", "Administrator", 1)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	rid, err := CreateRunner(ctx, database, uid, "r1", "http://runner.invalid", "key")
	if err != nil {
		t.Fatalf("create runner: %v", err)
	}
	if _, err := database.ExecContext(ctx,
		`INSERT INTO runner_events (runner_id, event_type, message) VALUES (?, 'heartbeat', 'up')`, rid); err != nil {
		t.Fatalf("seed event: %v", err)
	}
	if _, err := database.ExecContext(ctx,
		`INSERT INTO intents (user_id, name, schedule_type) VALUES (?, 'nightly', 'immediate')`, uid); err != nil {
		t.Fatalf("seed intent: %v", err)
	}
	var intentID int64
	if err := database.QueryRowContext(ctx, `SELECT id FROM intents WHERE user_id = ?`, uid).Scan(&intentID); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx,
		`INSERT INTO intent_executions (intent_id, user_id, status, trigger_type) VALUES (?, ?, 'completed', 'manual')`,
		intentID, uid); err != nil {
		t.Fatalf("seed execution: %v", err)
	}
	var execID int64
	if err := database.QueryRowContext(ctx, `SELECT id FROM intent_executions WHERE user_id = ?`, uid).Scan(&execID); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx,
		`INSERT INTO intent_execution_containers (execution_id, container_id, container_name, image_name, status)
		 VALUES (?, 'abc123def456', 'web', 'img:1', 'success')`, execID); err != nil {
		t.Fatalf("seed execution container: %v", err)
	}

	if n, err := DeleteUser(ctx, database, uid); err != nil || n != 1 {
		t.Fatalf("delete user: n=%d err=%v", n, err)
	}
	if n := countRows(t, database, `SELECT COUNT(*) FROM runner_events`); n != 0 {
		t.Errorf("runner_events left: %d", n)
	}
	if n := countRows(t, database, `SELECT COUNT(*) FROM intent_execution_containers`); n != 0 {
		t.Errorf("intent_execution_containers left: %d", n)
	}
}

// FKs are not enforced, so DeleteIntent must cascade by hand: the intent's
// executions and their per-container rows go with it, and another user's
// rows are untouched.
func TestDeleteIntentCascadesExecutions(t *testing.T) {
	database := newMigratedTestDB(t)
	ctx := context.Background()
	uid, err := CreateUser(ctx, database, "intent-owner", "hash", "Administrator", 1)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	other, err := CreateUser(ctx, database, "other-owner", "hash", "Administrator", 1)
	if err != nil {
		t.Fatalf("create other user: %v", err)
	}
	seedChain := func(owner int64) int64 {
		t.Helper()
		res, err := database.ExecContext(ctx,
			`INSERT INTO intents (user_id, name, schedule_type) VALUES (?, 'nightly', 'immediate')`, owner)
		if err != nil {
			t.Fatalf("seed intent: %v", err)
		}
		intentID, _ := res.LastInsertId()
		res, err = database.ExecContext(ctx,
			`INSERT INTO intent_executions (intent_id, user_id, status, trigger_type) VALUES (?, ?, 'completed', 'manual')`,
			intentID, owner)
		if err != nil {
			t.Fatalf("seed execution: %v", err)
		}
		execID, _ := res.LastInsertId()
		if _, err := database.ExecContext(ctx,
			`INSERT INTO intent_execution_containers (execution_id, container_id, container_name, image_name, status)
			 VALUES (?, 'abc123def456', 'web', 'img:1', 'success')`, execID); err != nil {
			t.Fatalf("seed execution container: %v", err)
		}
		return intentID
	}
	victim := seedChain(uid)
	survivor := seedChain(other)

	if err := DeleteIntent(ctx, database, victim, uid); err != nil {
		t.Fatalf("delete intent: %v", err)
	}
	// Wrong-user deletes must be a no-op on the survivor chain.
	if err := DeleteIntent(ctx, database, survivor, uid); err != nil {
		t.Fatalf("wrong-user delete: %v", err)
	}
	if n := countRows(t, database, `SELECT COUNT(*) FROM intents WHERE id = ?`, victim); n != 0 {
		t.Errorf("victim intent left: %d", n)
	}
	if n := countRows(t, database, `SELECT COUNT(*) FROM intent_executions WHERE intent_id = ?`, victim); n != 0 {
		t.Errorf("victim executions left: %d", n)
	}
	if n := countRows(t, database, `SELECT COUNT(*) FROM intent_execution_containers
		WHERE execution_id IN (SELECT id FROM intent_executions WHERE intent_id = ?)`, victim); n != 0 {
		t.Errorf("victim execution containers left: %d", n)
	}
	if n := countRows(t, database, `SELECT COUNT(*) FROM intent_execution_containers
		WHERE execution_id IN (SELECT id FROM intent_executions WHERE intent_id = ?)`, survivor); n != 1 {
		t.Errorf("survivor chain damaged: %d", n)
	}
}

// The stale-run reaper must measure silence since the last heartbeat, not
// since the job started: a long-running job that beats is never reaped,
// and one that stops beating is.
func TestBatchRunHeartbeatLease(t *testing.T) {
	database := newMigratedTestDB(t)
	ctx := context.Background()

	runID, err := CreateBatchRunIfNoneRunning(ctx, database, 1, "docker-hub-pull", false)
	if err != nil {
		t.Fatalf("claim: %v", err)
	}
	// Backdate the start beyond the threshold: without a heartbeat the row
	// is stale and gets reaped.
	if _, err := database.ExecContext(ctx,
		`UPDATE batch_runs SET started_at = datetime('now', '-10 minutes') WHERE id = ?`, runID); err != nil {
		t.Fatal(err)
	}
	if n, err := MarkStaleBatchRunsFailed(ctx, database, "docker-hub-pull", 300); err != nil || n != 1 {
		t.Fatalf("unheartbeated run should be reaped: n=%d err=%v", n, err)
	}

	runID, err = CreateBatchRunIfNoneRunning(ctx, database, 2, "docker-hub-pull", false)
	if err != nil {
		t.Fatalf("claim: %v", err)
	}
	if _, err := database.ExecContext(ctx,
		`UPDATE batch_runs SET started_at = datetime('now', '-10 minutes') WHERE id = ?`, runID); err != nil {
		t.Fatal(err)
	}
	if err := HeartbeatBatchRun(ctx, database, runID); err != nil {
		t.Fatalf("heartbeat: %v", err)
	}
	if n, err := MarkStaleBatchRunsFailed(ctx, database, "docker-hub-pull", 300); err != nil || n != 0 {
		t.Fatalf("heartbeated run must not be reaped: n=%d err=%v", n, err)
	}
	// A completed run ignores heartbeats (the lease only covers 'running'):
	// stamp a sentinel and confirm the beat leaves it alone.
	if _, err := database.ExecContext(ctx,
		`UPDATE batch_runs SET heartbeat_at = '2000-01-01 00:00:00' WHERE id = ?`, runID); err != nil {
		t.Fatal(err)
	}
	if err := CompleteBatchRun(ctx, database, runID, "completed", 0, 0, nil); err != nil {
		t.Fatal(err)
	}
	if err := HeartbeatBatchRun(ctx, database, runID); err != nil {
		t.Fatalf("heartbeat on completed run: %v", err)
	}
	if n := countRows(t, database,
		`SELECT COUNT(*) FROM batch_runs WHERE id = ? AND status = 'completed' AND heartbeat_at = '2000-01-01 00:00:00'`, runID); n != 1 {
		t.Errorf("completed run should not beat, got %d", n)
	}
}

// The CSRF state must survive exactly one consume: two concurrent callbacks
// carrying the same state may not both obtain the PKCE verifier.
func TestConsumeOAuthStateIsSingleUse(t *testing.T) {
	database := newMigratedTestDB(t)
	ctx := context.Background()
	if err := CreateOAuthState(ctx, database, "state-1", "verifier", "nonce", nil, nil); err != nil {
		t.Fatalf("create state: %v", err)
	}
	first, err := ConsumeOAuthState(ctx, database, "state-1")
	if err != nil {
		t.Fatalf("first consume: %v", err)
	}
	if first == nil || first.CodeVerifier != "verifier" {
		t.Fatalf("first consume = %#v, want the stored row", first)
	}
	second, err := ConsumeOAuthState(ctx, database, "state-1")
	if err != nil {
		t.Fatalf("second consume: %v", err)
	}
	if second != nil {
		t.Fatalf("second consume = %#v, want nil (state already spent)", second)
	}
}
