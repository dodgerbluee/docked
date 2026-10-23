package db

import (
	"context"
	"database/sql"
	"fmt"
	"testing"
)

// seedExecAt seeds one intent_executions row started ageSeconds ago and
// returns its id.
func seedExecAt(t *testing.T, database *sql.DB, status string, ageSeconds int) int64 {
	t.Helper()
	res, err := database.ExecContext(context.Background(),
		`INSERT INTO intent_executions (intent_id, user_id, status, trigger_type, started_at)
		 VALUES (1, 1, ?, 'manual', datetime('now', ?))`,
		status, fmt.Sprintf("-%d seconds", ageSeconds))
	if err != nil {
		t.Fatalf("seed %s execution: %v", status, err)
	}
	id, _ := res.LastInsertId()
	return id
}

func execState(t *testing.T, database *sql.DB, id int64) (string, sql.NullString) {
	t.Helper()
	var status string
	var completedAt sql.NullString
	if err := database.QueryRowContext(context.Background(),
		`SELECT status, completed_at FROM intent_executions WHERE id = ?`, id).
		Scan(&status, &completedAt); err != nil {
		t.Fatalf("read execution %d: %v", id, err)
	}
	return status, completedAt
}

// Startup cleanup must only reap executions whose ownership has expired. The
// DB is shared by two processes, so an unconditional "fail every pending /
// running row" pass falsely terminated the OTHER process's live executions —
// and the monotonic completion guard then blocked the real completion from
// correcting it.
func TestCleanupStaleIntentExecutionsOnlyReapsExpiredLeases(t *testing.T) {
	database := newMigratedTestDB(t)
	ctx := context.Background()
	if _, err := database.ExecContext(ctx,
		`INSERT INTO intents (user_id, name, schedule_type, enabled) VALUES (1, 'i', 'scheduled', 1)`); err != nil {
		t.Fatal(err)
	}

	fresh := seedExecAt(t, database, "running", 5)             // peer process started it moments ago
	leased := seedExecAt(t, database, "running", 3*60*60)      // long run, still recording results
	stale := seedExecAt(t, database, "running", 3*60*60)       // owner crashed: silent since start
	pending := seedExecAt(t, database, "pending", 3*60*60)     // pre-created row, owner died
	finalized := seedExecAt(t, database, "completed", 3*60*60) // terminal: never touched

	// The leased execution beat inside the window: its newest per-container
	// result is fresh, which is the only liveness evidence the schema carries.
	if _, err := database.ExecContext(ctx,
		`INSERT INTO intent_execution_containers
		 (execution_id, container_id, container_name, image_name, status)
		 VALUES (?, 'c-leased', 'leased', 'repo/app:latest', 'upgraded')`, leased); err != nil {
		t.Fatal(err)
	}

	n, err := CleanupStaleIntentExecutions(ctx, database, IntentExecutionStaleSeconds)
	if err != nil {
		t.Fatal(err)
	}
	if n != 2 {
		t.Errorf("reaped = %d, want 2 (the silent running + pending rows)", n)
	}

	for _, tc := range []struct {
		label string
		id    int64
		want  string
	}{
		{"fresh run owned by another process", fresh, "running"},
		{"run with a live lease", leased, "running"},
		{"finalized run", finalized, "completed"},
		{"expired run", stale, "failed"},
		{"expired pending row", pending, "failed"},
	} {
		status, completedAt := execState(t, database, tc.id)
		if status != tc.want {
			t.Errorf("%s: status = %q, want %q", tc.label, status, tc.want)
		}
		if tc.want == "failed" && !completedAt.Valid {
			t.Errorf("%s: reaped row has no completed_at", tc.label)
		}
		if tc.want != "failed" && completedAt.Valid {
			t.Errorf("%s: live row must keep completed_at NULL, got %v", tc.label, completedAt)
		}
	}

	// A reap is final: the late executor completion cannot resurrect it.
	if err := UpdateIntentExecution(ctx, database, stale, "completed", 1, 1, 0, 0, nil); err != nil {
		t.Fatal(err)
	}
	if status, _ := execState(t, database, stale); status != "failed" {
		t.Errorf("late completion resurrected a reaped execution: status = %q", status)
	}
}
