package intents

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/dockedapp/backend/internal/db"
)

// The completion write carries the execution's ORIGINAL trigger time, so a
// slow execution finishing after a newer cron claim used to rewind
// last_evaluated_at to an already-fired point — the cron point then fired a
// second time. The write must be monotonic, and the execution pointer must
// not regress either.
func TestUpdateLastEvaluatedDoesNotRegressNewerClaim(t *testing.T) {
	ctx := context.Background()
	database := testDB(t)
	intent := insertIntent(t, database, map[string]any{
		"name": "monotonic", "schedule_type": "scheduled", "schedule_cron": "*/5 * * * *",
	})
	exec := &Executor{DB: database}

	newer := time.Now().UTC()
	won, err := db.ClaimIntentEvaluation(ctx, database, intent.ID, 1, newer.Format(isoMillis))
	if err != nil || !won {
		t.Fatalf("claim newer cron point = (%v, %v)", won, err)
	}

	// An execution dispatched for an older cron point completes late.
	older := newer.Add(-time.Hour)
	exec.updateLastEvaluated(ctx, intent, 1, 7, &older)

	evaluatedAt, execID := intentEvalPointers(t, database, intent.ID)
	if evaluatedAt != newer.Format(isoMillis) {
		t.Errorf("last_evaluated_at regressed to %q, want %q", evaluatedAt, newer.Format(isoMillis))
	}
	if execID != nil && *execID == 7 {
		t.Errorf("last_execution_id points at the stale execution 7")
	}

	// The execution that actually ran the claimed point still gets the
	// pointer (the evaluator's claim leaves last_execution_id untouched).
	exec.updateLastEvaluated(ctx, intent, 1, 9, &newer)
	evaluatedAt, execID = intentEvalPointers(t, database, intent.ID)
	if evaluatedAt != newer.Format(isoMillis) {
		t.Errorf("same cron point must not move: %q", evaluatedAt)
	}
	if execID == nil || *execID != 9 {
		t.Errorf("last_execution_id = %v, want 9", execID)
	}
}

func intentEvalPointers(t *testing.T, database *sql.DB, intentID int64) (string, *int64) {
	t.Helper()
	var evaluatedAt string
	var execID *int64
	if err := database.QueryRowContext(context.Background(),
		`SELECT last_evaluated_at, last_execution_id FROM intents WHERE id = ?`, intentID).
		Scan(&evaluatedAt, &execID); err != nil {
		t.Fatalf("read intent %d: %v", intentID, err)
	}
	return evaluatedAt, execID
}
