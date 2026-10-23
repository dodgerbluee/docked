package db

import (
	"context"
	"database/sql"
	"testing"
	"time"
)

// SetIntentLastEvaluatedAt must be monotonic, like ClaimIntentEvaluation.
// The API and the image-sync runner share this SQLite database, so a late
// write from one process must never rewind last_evaluated_at to an older
// cron point: the evaluator's "already handled this point" check is exactly
// that column, and a rewound pointer makes the cron fire an interval it
// already handled.
func TestSetIntentLastEvaluatedAtIsMonotonic(t *testing.T) {
	db := newMigratedTestDB(t)
	ctx := context.Background()

	const newer = "2026-10-21T05:00:00.000Z"
	const older = "2026-10-21T04:00:00.000Z"
	const newest = "2026-10-21T06:00:00.000Z"

	// Fresh intent: the first write lands.
	fresh := insertCronIntent(t, db, "mono-fresh")
	if err := SetIntentLastEvaluatedAt(ctx, db, fresh, 1, newer, 11); err != nil {
		t.Fatalf("set newer: %v", err)
	}
	if got := mustEvalTime(t, db, fresh); !got.Equal(wantEvalTime(t, newer)) {
		t.Fatalf("fresh intent: last_evaluated_at = %s, want %s", got.Format(time.RFC3339), newer)
	}

	// A late write for an older cron point must not rewind the pointer.
	if err := SetIntentLastEvaluatedAt(ctx, db, fresh, 1, older, 12); err != nil {
		t.Fatalf("set older: %v", err)
	}
	if got := mustEvalTime(t, db, fresh); !got.Equal(wantEvalTime(t, newer)) {
		t.Fatalf("last_evaluated_at regressed to %s, want %s", got.Format(time.RFC3339), newer)
	}
	if got := mustEvalExecutionID(t, db, fresh); got != 11 {
		t.Fatalf("last_execution_id = %d, want 11: a rejected write must not re-point the execution either", got)
	}

	// A write for the point the pointer already holds still attaches
	// last_execution_id (the evaluator's post-run mark).
	if err := SetIntentLastEvaluatedAt(ctx, db, fresh, 1, newer, 13); err != nil {
		t.Fatalf("re-set same point: %v", err)
	}
	if got := mustEvalExecutionID(t, db, fresh); got != 13 {
		t.Fatalf("last_execution_id = %d, want 13", got)
	}

	// A newer point still moves the pointer forward.
	if err := SetIntentLastEvaluatedAt(ctx, db, fresh, 1, newest, 14); err != nil {
		t.Fatalf("set newest: %v", err)
	}
	if got := mustEvalTime(t, db, fresh); !got.Equal(wantEvalTime(t, newest)) {
		t.Fatalf("last_evaluated_at = %s, want %s", got.Format(time.RFC3339), newest)
	}

	// The pre-mark branch (executionID < 0, leaves last_execution_id alone)
	// must not rewind either.
	before := mustEvalTime(t, db, fresh)
	if err := SetIntentLastEvaluatedAt(ctx, db, fresh, 1, older, -1); err != nil {
		t.Fatalf("pre-mark older: %v", err)
	}
	if got := mustEvalTime(t, db, fresh); !got.Equal(before) {
		t.Fatalf("pre-mark rewrote last_evaluated_at to %s, want %s",
			got.Format(time.RFC3339), before.Format(time.RFC3339))
	}
	if got := mustEvalExecutionID(t, db, fresh); got != 14 {
		t.Fatalf("last_execution_id = %d, want 14", got)
	}

	// Mixed storage layouts must compare as instants, not as text: a pointer
	// written in SQLite's CURRENT_TIMESTAMP layout must reject an older ISO
	// write and accept a newer one.
	sqlite := insertCronIntent(t, db, "mono-sqlite")
	if _, err := db.ExecContext(ctx,
		`UPDATE intents SET last_evaluated_at = '2026-10-21 05:00:00' WHERE id = ?`, sqlite); err != nil {
		t.Fatalf("seed sqlite-format pointer: %v", err)
	}
	if err := SetIntentLastEvaluatedAt(ctx, db, sqlite, 1, "2026-10-21T04:30:00.000Z", 21); err != nil {
		t.Fatalf("set older ISO point over sqlite-format pointer: %v", err)
	}
	if got := mustEvalTime(t, db, sqlite); !got.Equal(wantEvalTime(t, "2026-10-21T05:00:00.000Z")) {
		t.Fatalf("pointer regressed across storage layouts: got %s, want 2026-10-21T05:00:00Z", got.Format(time.RFC3339))
	}
	if err := SetIntentLastEvaluatedAt(ctx, db, sqlite, 1, "2026-10-21T05:30:00.000Z", 22); err != nil {
		t.Fatalf("set newer ISO point over sqlite-format pointer: %v", err)
	}
	if got := mustEvalTime(t, db, sqlite); !got.Equal(wantEvalTime(t, "2026-10-21T05:30:00.000Z")) {
		t.Fatalf("pointer did not advance across storage layouts: got %s", got.Format(time.RFC3339))
	}
}

// insertCronIntent creates a scheduled intent with no evaluation pointer yet.
func insertCronIntent(t *testing.T, db *sql.DB, name string) int64 {
	t.Helper()
	res, err := db.ExecContext(context.Background(),
		`INSERT INTO intents (user_id, name, match_containers, schedule_type, schedule_cron, enabled)
		 VALUES (1, ?, '[]', 'scheduled', '0 5 * * *', 1)`, name)
	if err != nil {
		t.Fatalf("insert intent: %v", err)
	}
	id, err := res.LastInsertId()
	if err != nil {
		t.Fatalf("intent id: %v", err)
	}
	return id
}

func mustEvalTime(t *testing.T, db *sql.DB, intentID int64) time.Time {
	t.Helper()
	var raw sql.NullString
	if err := db.QueryRowContext(context.Background(),
		`SELECT last_evaluated_at FROM intents WHERE id = ?`, intentID).Scan(&raw); err != nil {
		t.Fatalf("read last_evaluated_at: %v", err)
	}
	if !raw.Valid {
		t.Fatalf("last_evaluated_at is NULL")
	}
	parsed, err := ParseSQLiteTime(raw.String)
	if err != nil {
		t.Fatalf("parse last_evaluated_at %q: %v", raw.String, err)
	}
	return parsed
}

func mustEvalExecutionID(t *testing.T, db *sql.DB, intentID int64) int64 {
	t.Helper()
	var id sql.NullInt64
	if err := db.QueryRowContext(context.Background(),
		`SELECT last_execution_id FROM intents WHERE id = ?`, intentID).Scan(&id); err != nil {
		t.Fatalf("read last_execution_id: %v", err)
	}
	return id.Int64
}

func wantEvalTime(t *testing.T, iso string) time.Time {
	t.Helper()
	parsed, err := ParseSQLiteTime(iso)
	if err != nil {
		t.Fatalf("parse %q: %v", iso, err)
	}
	return parsed
}

// TestIntentFilterEmptyListContract pins the intent filter write contract that
// schema.graphql documents. The intent form sends [] for every dimension the
// user did not pick, and switching match types relies on [] CLEARING the
// previously active dimension: if [] were stored as-is the intent would match
// nothing at all. The one exception is a row that already holds "[]" from the
// Node era, which must keep reading as "matches nothing" so it can never
// silently widen into "matches everything".
func TestIntentFilterEmptyListContract(t *testing.T) {
	ctx := context.Background()
	database := testDB(t)
	migrate(t, database)

	const uid = 1
	if _, err := database.Exec(
		`INSERT INTO users (id, username, password_hash, role, instance_admin)
		 VALUES (?, 'u1', 'x', 'Administrator', 1)`, uid); err != nil {
		t.Fatal(err)
	}

	create := func(name string, matchContainers []string) *IntentRow {
		t.Helper()
		id, err := CreateIntent(ctx, database, uid, name, nil, true,
			matchContainers, nil, nil, nil, nil, nil, nil, nil, nil,
			"scheduled", nil, nil, 1, false, 0)
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		row, err := GetIntentByID(ctx, database, id, uid)
		if err != nil || row == nil {
			t.Fatalf("reload %s: %v", name, err)
		}
		return row
	}

	// Omitted dimension: NULL, and reads back as nil.
	if row := create("unset", nil); row.MatchContainers.Valid {
		t.Errorf("omitted dimension stored %q, want NULL", row.MatchContainers.String)
	} else if got := UnmarshalStringArr(row.MatchContainers); got != nil {
		t.Errorf("omitted dimension decodes to %v, want nil", got)
	}

	// Explicit []: cleared to NULL, so the dimension contributes no filter.
	// This is what the intent form relies on when the user switches match
	// types: the dimension they left behind has to stop filtering.
	if row := create("cleared", []string{}); row.MatchContainers.Valid {
		t.Errorf("explicit [] stored %q, want the dimension cleared to NULL", row.MatchContainers.String)
	} else if got := UnmarshalStringArr(row.MatchContainers); got != nil {
		t.Errorf("explicit [] must decode as inactive, got %v", got)
	}

	// Non-empty: round-trips.
	row := create("picked", []string{"radarr*", "sonarr*"})
	if got := UnmarshalStringArr(row.MatchContainers); len(got) != 2 || got[0] != "radarr*" {
		t.Errorf("non-empty dimension decodes to %v", got)
	}

	// Legacy "[]" row: still decodes as an explicitly empty slice, which the
	// matcher reads as "matches nothing".
	legacy := sql.NullString{String: `[]`, Valid: true}
	if got := UnmarshalStringArr(legacy); got == nil {
		t.Error(`stored "[]" must decode as explicitly empty, not unset`)
	} else if len(got) != 0 {
		t.Errorf(`stored "[]" decoded to %v`, got)
	}
	if got := UnmarshalStringArr(sql.NullString{}); got != nil {
		t.Errorf("NULL must decode to nil, got %v", got)
	}
}
