package db

import (
	"context"
	"database/sql"
	"fmt"
)

type IntentExecutionRow struct {
	ID                 int64
	IntentID           int64
	UserID             int64
	Status             string
	TriggerType        string
	ContainersMatched  int
	ContainersUpgraded int
	ContainersFailed   int
	ContainersSkipped  int
	ErrorMessage       sql.NullString
	StartedAt          string
	CompletedAt        sql.NullString
	DurationMs         sql.NullInt64
	IntentName         sql.NullString
}

func GetIntentExecutions(ctx context.Context, database *sql.DB, userID int64, intentID *int64, limit, offset int) ([]IntentExecutionRow, int, error) {
	var total int
	countQ := "SELECT COUNT(*) FROM intent_executions WHERE user_id = ?"
	args := []any{userID}
	if intentID != nil {
		countQ += " AND intent_id = ?"
		args = append(args, *intentID)
	}
	database.QueryRowContext(ctx, countQ, args...).Scan(&total)

	q := "SELECT ie.id, ie.intent_id, ie.user_id, ie.status, ie.trigger_type, ie.containers_matched, ie.containers_upgraded, ie.containers_failed, ie.containers_skipped, ie.error_message, ie.started_at, ie.completed_at, ie.duration_ms, i.name AS intent_name FROM intent_executions ie LEFT JOIN intents i ON ie.intent_id = i.id WHERE ie.user_id = ?"
	args2 := []any{userID}
	if intentID != nil {
		q += " AND ie.intent_id = ?"
		args2 = append(args2, *intentID)
	}
	q += " ORDER BY ie.started_at DESC LIMIT ? OFFSET ?"
	args2 = append(args2, limit, offset)

	rows, err := database.QueryContext(ctx, q, args2...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var result []IntentExecutionRow
	for rows.Next() {
		var r IntentExecutionRow
		if err := rows.Scan(&r.ID, &r.IntentID, &r.UserID, &r.Status, &r.TriggerType,
			&r.ContainersMatched, &r.ContainersUpgraded, &r.ContainersFailed, &r.ContainersSkipped,
			&r.ErrorMessage, &r.StartedAt, &r.CompletedAt, &r.DurationMs, &r.IntentName); err != nil {
			return nil, 0, err
		}
		result = append(result, r)
	}
	return result, total, rows.Err()
}

// GetIntentExecutionByID returns a single execution owned by userID, or nil
// when no matching row exists.
func GetIntentExecutionByID(ctx context.Context, database *sql.DB, id, userID int64) (*IntentExecutionRow, error) {
	row := database.QueryRowContext(ctx,
		`SELECT ie.id, ie.intent_id, ie.user_id, ie.status, ie.trigger_type, ie.containers_matched,
			ie.containers_upgraded, ie.containers_failed, ie.containers_skipped, ie.error_message,
			ie.started_at, ie.completed_at, ie.duration_ms, i.name AS intent_name
		 FROM intent_executions ie LEFT JOIN intents i ON ie.intent_id = i.id
		 WHERE ie.id = ? AND ie.user_id = ?`, id, userID)
	var r IntentExecutionRow
	if err := row.Scan(&r.ID, &r.IntentID, &r.UserID, &r.Status, &r.TriggerType,
		&r.ContainersMatched, &r.ContainersUpgraded, &r.ContainersFailed, &r.ContainersSkipped,
		&r.ErrorMessage, &r.StartedAt, &r.CompletedAt, &r.DurationMs, &r.IntentName); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &r, nil
}

// GetIntentLastExecution returns the execution referenced by the intent's
// last_execution_id pointer, or nil when the intent has not run yet.
func GetIntentLastExecution(ctx context.Context, database *sql.DB, intentID, userID int64) (*IntentExecutionRow, error) {
	row := database.QueryRowContext(ctx,
		`SELECT ie.id, ie.intent_id, ie.user_id, ie.status, ie.trigger_type, ie.containers_matched,
			ie.containers_upgraded, ie.containers_failed, ie.containers_skipped, ie.error_message,
			ie.started_at, ie.completed_at, ie.duration_ms, i2.name AS intent_name
		 FROM intents i
		 JOIN intent_executions ie ON ie.id = i.last_execution_id
		 LEFT JOIN intents i2 ON ie.intent_id = i2.id
		 WHERE i.id = ? AND i.user_id = ?`, intentID, userID)
	var r IntentExecutionRow
	if err := row.Scan(&r.ID, &r.IntentID, &r.UserID, &r.Status, &r.TriggerType,
		&r.ContainersMatched, &r.ContainersUpgraded, &r.ContainersFailed, &r.ContainersSkipped,
		&r.ErrorMessage, &r.StartedAt, &r.CompletedAt, &r.DurationMs, &r.IntentName); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &r, nil
}

func CreateIntentExecution(ctx context.Context, database *sql.DB, intentID, userID int64, triggerType string) (int64, error) {
	res, err := database.ExecContext(ctx,
		"INSERT INTO intent_executions (intent_id, user_id, status, trigger_type) VALUES (?, ?, 'pending', ?)",
		intentID, userID, triggerType)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func UpdateIntentExecution(ctx context.Context, database *sql.DB, id int64, status string, matched, upgraded, failed, skipped int, errMsg *string) error {
	_, err := database.ExecContext(ctx,
		`UPDATE intent_executions SET status=?, containers_matched=?, containers_upgraded=?,
		 containers_failed=?, containers_skipped=?, error_message=?,
		 completed_at=CURRENT_TIMESTAMP,
		 duration_ms=CAST((julianday(CURRENT_TIMESTAMP)-julianday(started_at))*86400000 AS INTEGER)
		 WHERE id=?`,
		status, matched, upgraded, failed, skipped, errMsg, id)
	return err
}

// IntentExecutionContainerRow is a row from the intent_execution_containers table.
type IntentExecutionContainerRow struct {
	ID               int64
	ExecutionID      int64
	ContainerID      string
	ContainerName    string
	ImageName        string
	SourceInstanceID sql.NullInt64
	RunnerID         sql.NullInt64
	Status           string
	OldImage         sql.NullString
	NewImage         sql.NullString
	OldDigest        sql.NullString
	NewDigest        sql.NullString
	ErrorMessage     sql.NullString
	DurationMs       sql.NullInt64
	CreatedAt        string
}

// GetIntentExecutionContainers returns the per-container results for an intent execution.
func GetIntentExecutionContainers(ctx context.Context, database *sql.DB, executionID int64) ([]IntentExecutionContainerRow, error) {
	rows, err := database.QueryContext(ctx,
		`SELECT id, execution_id, container_id, container_name, image_name,
			source_instance_id, runner_id, status, old_image, new_image, old_digest, new_digest,
			error_message, duration_ms, created_at
		 FROM intent_execution_containers WHERE execution_id = ? ORDER BY id`,
		executionID)
	if err != nil {
		return nil, fmt.Errorf("get intent execution containers: %w", err)
	}
	defer rows.Close()

	var results []IntentExecutionContainerRow
	for rows.Next() {
		var r IntentExecutionContainerRow
		if err := rows.Scan(&r.ID, &r.ExecutionID, &r.ContainerID, &r.ContainerName, &r.ImageName,
			&r.SourceInstanceID, &r.RunnerID, &r.Status, &r.OldImage, &r.NewImage, &r.OldDigest, &r.NewDigest,
			&r.ErrorMessage, &r.DurationMs, &r.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan intent execution container: %w", err)
		}
		results = append(results, r)
	}
	return results, rows.Err()
}
