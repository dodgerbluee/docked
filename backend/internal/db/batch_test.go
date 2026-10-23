package db

import (
	"context"
	"database/sql"
	"testing"
)

func batchRunState(t *testing.T, database *sql.DB, id int64) (string, sql.NullString, sql.NullInt64) {
	t.Helper()
	var status string
	var completedAt sql.NullString
	var durationMs sql.NullInt64
	if err := database.QueryRowContext(context.Background(),
		`SELECT status, completed_at, duration_ms FROM batch_runs WHERE id = ?`, id).
		Scan(&status, &completedAt, &durationMs); err != nil {
		t.Fatalf("read batch run %d: %v", id, err)
	}
	return status, completedAt, durationMs
}

// A client-driven progress update (status 'running') must NOT stamp
// completed_at. It used to, which wedged the run slot forever: acquisition
// rejects any status='running' row, while CompleteBatchRun and both stale-run
// reapers require completed_at IS NULL — so the row could never be finished,
// reclaimed, or reaped, and the real completion write was rejected too.
func TestUpdateBatchRunProgressKeepsRunSlotLive(t *testing.T) {
	database := newMigratedTestDB(t)
	ctx := context.Background()

	id, err := CreateBatchRun(ctx, database, 1, "docker-hub-pull", true)
	if err != nil {
		t.Fatal(err)
	}
	if err := UpdateBatchRun(ctx, database, id, 1, "running", 5, 1, nil, strPtr("scanning 5 containers")); err != nil {
		t.Fatal(err)
	}

	status, completedAt, durationMs := batchRunState(t, database, id)
	if status != "running" {
		t.Errorf("status = %q, want running", status)
	}
	if completedAt.Valid {
		t.Errorf("progress update stamped completed_at = %v", completedAt)
	}
	if durationMs.Valid {
		t.Errorf("progress update stamped duration_ms = %v", durationMs)
	}

	// The run is still live: the lease beats, and the real completion lands.
	if err := HeartbeatBatchRun(ctx, database, id); err != nil {
		t.Fatal(err)
	}
	if err := UpdateBatchRun(ctx, database, id, 1, "completed", 7, 2, nil, strPtr("done")); err != nil {
		t.Fatalf("terminal update after a progress update: %v", err)
	}
	if status, completedAt, _ = batchRunState(t, database, id); status != "completed" || !completedAt.Valid {
		t.Errorf("after terminal update: status=%q completed_at=%v", status, completedAt)
	}

	// A late progress update on a finalized run is still rejected.
	if err := UpdateBatchRun(ctx, database, id, 1, "running", 0, 0, nil, nil); err == nil {
		t.Error("progress update on a finalized run must fail")
	}
}

// Rows already wedged by the old bug (status 'running' AND completed_at set)
// must not hold the run slot forever: the claim counts only live runs, and the
// stale-run reaper self-heals the row.
func TestWedgedBatchRunDoesNotBlockRunSlot(t *testing.T) {
	database := newMigratedTestDB(t)
	ctx := context.Background()

	wedged, err := CreateBatchRun(ctx, database, 1, "docker-hub-pull", false)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx,
		`UPDATE batch_runs SET started_at = datetime('now','-3 hours'),
		 completed_at = datetime('now','-2 hours') WHERE id = ?`, wedged); err != nil {
		t.Fatal(err)
	}

	if _, err := CreateBatchRunIfNoneRunning(ctx, database, 1, "docker-hub-pull", false); err != nil {
		t.Fatalf("wedged row must not block a fresh claim: %v", err)
	}
	reaped, err := ReapStaleBatchRun(ctx, database, wedged, 300)
	if err != nil {
		t.Fatal(err)
	}
	if !reaped {
		t.Error("wedged running row must be reaped")
	}
	if status, _, _ := batchRunState(t, database, wedged); status != "failed" {
		t.Errorf("wedged row after reap: status = %q, want failed", status)
	}
}
