package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
)

// IntentRow is a row from the intents table.
type IntentRow struct {
	ID                 int64
	UserID             int64
	Name               string
	Description        sql.NullString
	Enabled            int
	MatchContainers    sql.NullString // JSON array
	MatchImages        sql.NullString
	MatchSources       sql.NullString
	MatchStacks        sql.NullString
	MatchRegistries    sql.NullString
	ExcludeContainers  sql.NullString
	ExcludeImages      sql.NullString
	ExcludeStacks      sql.NullString
	ExcludeRegistries  sql.NullString
	ScheduleType       string
	ScheduleCron       sql.NullString
	ScheduleTimezone   sql.NullString
	MaxConcurrent      int
	DryRun             int
	SequentialDelaySec int
	LastEvaluatedAt    sql.NullString
	CreatedAt          string
	UpdatedAt          string
}

const intentCols = `id, user_id, name, description, enabled,
	match_containers, match_images, match_sources, match_stacks, match_registries,
	exclude_containers, exclude_images, exclude_stacks, exclude_registries,
	schedule_type, schedule_cron, schedule_timezone,
	max_concurrent, dry_run, sequential_delay_sec, last_evaluated_at, created_at, updated_at`

func scanIntent(row interface{ Scan(...any) error }) (IntentRow, error) {
	var r IntentRow
	err := row.Scan(&r.ID, &r.UserID, &r.Name, &r.Description, &r.Enabled,
		&r.MatchContainers, &r.MatchImages, &r.MatchSources, &r.MatchStacks, &r.MatchRegistries,
		&r.ExcludeContainers, &r.ExcludeImages, &r.ExcludeStacks, &r.ExcludeRegistries,
		&r.ScheduleType, &r.ScheduleCron, &r.ScheduleTimezone,
		&r.MaxConcurrent, &r.DryRun, &r.SequentialDelaySec, &r.LastEvaluatedAt,
		&r.CreatedAt, &r.UpdatedAt)
	return r, err
}

func GetIntentsByUser(ctx context.Context, database *sql.DB, userID int64) ([]IntentRow, error) {
	rows, err := database.QueryContext(ctx,
		"SELECT "+intentCols+" FROM intents WHERE user_id = ? ORDER BY created_at DESC", userID)
	if err != nil {
		return nil, fmt.Errorf("get intents: %w", err)
	}
	defer rows.Close()

	var results []IntentRow
	for rows.Next() {
		r, err := scanIntent(rows)
		if err != nil {
			return nil, fmt.Errorf("scan intent: %w", err)
		}
		results = append(results, r)
	}
	return results, rows.Err()
}

func GetIntentByID(ctx context.Context, database *sql.DB, id, userID int64) (*IntentRow, error) {
	row := database.QueryRowContext(ctx,
		"SELECT "+intentCols+" FROM intents WHERE id = ? AND user_id = ?", id, userID)

	r, err := scanIntent(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get intent: %w", err)
	}
	return &r, nil
}

func CreateIntent(ctx context.Context, database *sql.DB, userID int64, name string,
	description *string, enabled bool, matchContainers, matchImages, matchSources,
	matchStacks, matchRegistries, excludeContainers, excludeImages, excludeStacks,
	excludeRegistries []string, scheduleType string, scheduleCron *string, scheduleTimezone *string,
	maxConcurrent int, dryRun bool, sequentialDelaySec int) (int64, error) {

	mc := marshalJSONArr(matchContainers)
	mi := marshalJSONArr(matchImages)
	ms := marshalJSONArr(matchSources)
	mst := marshalJSONArr(matchStacks)
	mr := marshalJSONArr(matchRegistries)
	ec := marshalJSONArr(excludeContainers)
	ei := marshalJSONArr(excludeImages)
	es := marshalJSONArr(excludeStacks)
	er := marshalJSONArr(excludeRegistries)

	enabledInt := 0
	if enabled {
		enabledInt = 1
	}
	dryRunInt := 0
	if dryRun {
		dryRunInt = 1
	}

	result, err := database.ExecContext(ctx,
		`INSERT INTO intents (user_id, name, description, enabled,
		 match_containers, match_images, match_sources, match_stacks, match_registries,
		 exclude_containers, exclude_images, exclude_stacks, exclude_registries,
		 schedule_type, schedule_cron, schedule_timezone,
		 max_concurrent, dry_run, sequential_delay_sec)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		userID, name, description, enabledInt,
		mc, mi, ms, mst, mr, ec, ei, es, er,
		scheduleType, scheduleCron, scheduleTimezone,
		maxConcurrent, dryRunInt, sequentialDelaySec)
	if err != nil {
		return 0, fmt.Errorf("create intent: %w", err)
	}
	return result.LastInsertId()
}

func DeleteIntent(ctx context.Context, database *sql.DB, id, userID int64) error {
	// FKs are not enforced on this DB (see migrate.go), so the cascade has to
	// be explicit: intent_execution_containers -> intent_executions -> intent,
	// all in one transaction so a failure cannot half-delete the chain.
	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("delete intent: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM intent_execution_containers
		 WHERE execution_id IN (SELECT id FROM intent_executions WHERE intent_id = ? AND user_id = ?)`,
		id, userID); err != nil {
		return fmt.Errorf("delete intent: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		"DELETE FROM intent_executions WHERE intent_id = ? AND user_id = ?", id, userID); err != nil {
		return fmt.Errorf("delete intent: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		"DELETE FROM intents WHERE id = ? AND user_id = ?", id, userID); err != nil {
		return fmt.Errorf("delete intent: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("delete intent: %w", err)
	}
	return nil
}

// TouchIntentLastEvaluated records that an intent was evaluated, mirroring
// Node's updateLastEvaluated: last_evaluated_at + last_execution_id.
func TouchIntentLastEvaluated(ctx context.Context, database *sql.DB, intentID, userID, executionID int64) error {
	_, err := database.ExecContext(ctx,
		`UPDATE intents SET last_evaluated_at = CURRENT_TIMESTAMP, last_execution_id = ?
		 WHERE id = ? AND user_id = ?`,
		executionID, intentID, userID)
	return err
}

// GetEnabledIntents returns every enabled intent for a user (Node's
// db/intents.js getEnabledIntents), used by the intent evaluator loops.
func GetEnabledIntents(ctx context.Context, database *sql.DB, userID int64) ([]IntentRow, error) {
	rows, err := database.QueryContext(ctx,
		"SELECT "+intentCols+" FROM intents WHERE user_id = ? AND enabled = 1", userID)
	if err != nil {
		return nil, fmt.Errorf("get enabled intents: %w", err)
	}
	defer rows.Close()

	var results []IntentRow
	for rows.Next() {
		r, err := scanIntent(rows)
		if err != nil {
			return nil, fmt.Errorf("scan enabled intent: %w", err)
		}
		results = append(results, r)
	}
	return results, rows.Err()
}

// SetIntentLastEvaluatedAt anchors an intent's last_evaluated_at to an exact
// timestamp (Node writes the cron trigger time as an ISO string, never
// wall-clock, so a cron point can only fire once). executionID < 0 leaves
// last_execution_id untouched (the evaluator's pre-mark step).
//
// Both writes are monotonic, using the same datetime()-normalised comparison
// as ClaimIntentEvaluation: the API and the image-sync runner share this
// database, and a late write from one process must never rewind the other's
// newer pointer and let a cron point fire a second time. "<=" (not "<") so a
// write for the point the pointer already holds still attaches
// last_execution_id.
func SetIntentLastEvaluatedAt(ctx context.Context, database *sql.DB, intentID, userID int64, evaluatedAt string, executionID int64) error {
	const guard = ` AND (last_evaluated_at IS NULL OR datetime(last_evaluated_at) IS NULL
			        OR datetime(last_evaluated_at) <= datetime(?))`
	if executionID < 0 {
		_, err := database.ExecContext(ctx,
			`UPDATE intents SET last_evaluated_at = ? WHERE id = ? AND user_id = ?`+guard,
			evaluatedAt, intentID, userID, evaluatedAt)
		return err
	}
	_, err := database.ExecContext(ctx,
		`UPDATE intents SET last_evaluated_at = ?, last_execution_id = ? WHERE id = ? AND user_id = ?`+guard,
		evaluatedAt, executionID, intentID, userID, evaluatedAt)
	return err
}

// ClaimIntentEvaluation atomically advances last_evaluated_at to evaluatedAt
// only while it is still behind that point. With several processes sharing
// the SQLite DB this is the cross-process guard that keeps a cron point from
// firing twice (the evaluator's inProgress map only covers one process).
// Returns true when this caller won the claim.
//
// The comparison goes through datetime() so rows written in SQLite's
// CURRENT_TIMESTAMP layout ("YYYY-MM-DD HH:MM:SS") and Node's ISO layout
// ("YYYY-MM-DDTHH:MM:SS.sssZ") order correctly — a raw string compare sorts
// the space-separated form before the T-separated form for the same date.
// An unparseable value is treated as claimable so a corrupt row cannot
// wedge the intent forever.
func ClaimIntentEvaluation(ctx context.Context, database *sql.DB, intentID, userID int64, evaluatedAt string) (bool, error) {
	res, err := database.ExecContext(ctx,
		`UPDATE intents SET last_evaluated_at = ?
		 WHERE id = ? AND user_id = ?
		   AND (last_evaluated_at IS NULL
		        OR datetime(last_evaluated_at) IS NULL
		        OR datetime(last_evaluated_at) < datetime(?))`,
		evaluatedAt, intentID, userID, evaluatedAt)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, err
	}
	return n == 1, nil
}

// UnmarshalStringArr decodes a JSON array string from the DB into a []string.
// NULL/invalid decodes to nil ("unset"); "[]" decodes to an empty non-nil
// slice ("explicitly empty": matches nothing).
func UnmarshalStringArr(s sql.NullString) []string {
	if !s.Valid || s.String == "" {
		return nil
	}
	var arr []string
	if err := json.Unmarshal([]byte(s.String), &arr); err != nil {
		return nil
	}
	return arr
}

// marshalJSONArr encodes an intent filter list for the DB. A nil slice means
// "unset" and stores NULL (dimension inactive). An explicitly empty slice is
// normalized to NULL as well: the GraphQL clients (the intent form) send []
// for dimensions the user did not pick, and storing "[]" there would make
// the intent match nothing. The stored "[]" state is legacy-only; the matcher
// still treats decoded "[]" as matching nothing so old rows never silently
// match everything (see UnmarshalStringArr / intentIncludes).
func marshalJSONArr(arr []string) *string {
	if arr == nil || len(arr) == 0 {
		return nil
	}
	data, _ := json.Marshal(arr)
	s := string(data)
	return &s
}
