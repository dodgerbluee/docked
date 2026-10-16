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
	schedule_type, schedule_cron,
	max_concurrent, dry_run, sequential_delay_sec, last_evaluated_at, created_at, updated_at`

func scanIntent(row interface{ Scan(...any) error }) (IntentRow, error) {
	var r IntentRow
	err := row.Scan(&r.ID, &r.UserID, &r.Name, &r.Description, &r.Enabled,
		&r.MatchContainers, &r.MatchImages, &r.MatchSources, &r.MatchStacks, &r.MatchRegistries,
		&r.ExcludeContainers, &r.ExcludeImages, &r.ExcludeStacks, &r.ExcludeRegistries,
		&r.ScheduleType, &r.ScheduleCron,
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
	excludeRegistries []string, scheduleType string, scheduleCron *string,
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
		 schedule_type, schedule_cron,
		 max_concurrent, dry_run, sequential_delay_sec)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		userID, name, description, enabledInt,
		mc, mi, ms, mst, mr, ec, ei, es, er,
		scheduleType, scheduleCron,
		maxConcurrent, dryRunInt, sequentialDelaySec)
	if err != nil {
		return 0, fmt.Errorf("create intent: %w", err)
	}
	return result.LastInsertId()
}

func DeleteIntent(ctx context.Context, database *sql.DB, id, userID int64) error {
	_, err := database.ExecContext(ctx,
		"DELETE FROM intents WHERE id = ? AND user_id = ?", id, userID)
	return err
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

// UnmarshalStringArr decodes a JSON array string from the DB into a []string.
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

func marshalJSONArr(arr []string) *string {
	if len(arr) == 0 {
		return nil
	}
	data, _ := json.Marshal(arr)
	s := string(data)
	return &s
}
