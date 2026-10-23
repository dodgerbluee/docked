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
	return CreateIntentExecutionStatus(ctx, database, intentID, userID, triggerType, "pending")
}

// CreateIntentExecutionStatus creates an execution record with an explicit
// initial status (Node's executor creates 'running' directly).
func CreateIntentExecutionStatus(ctx context.Context, database *sql.DB, intentID, userID int64, triggerType, status string) (int64, error) {
	res, err := database.ExecContext(ctx,
		"INSERT INTO intent_executions (intent_id, user_id, status, trigger_type) VALUES (?, ?, ?, ?)",
		intentID, userID, status, triggerType)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// MarkIntentExecutionFailed records only status/error/duration, preserving
// any partial counters already on the row (Node's updateIntentExecution
// COALESCEs the counts). The completed_at IS NULL guard makes completion
// monotonic: a terminal row is never re-written, so a late executor update
// can never resurrect (or overwrite) an execution another process already
// finalized.
func MarkIntentExecutionFailed(ctx context.Context, database *sql.DB, id int64, errMsg string) error {
	_, err := database.ExecContext(ctx,
		`UPDATE intent_executions SET status='failed', error_message=?,
		 completed_at=CURRENT_TIMESTAMP,
		 duration_ms=CAST((julianday(CURRENT_TIMESTAMP)-julianday(started_at))*86400000 AS INTEGER)
		 WHERE id=? AND completed_at IS NULL`, errMsg, id)
	return err
}

// IntentExecutionStaleSeconds is how long an intent execution may go without
// any sign of life (no container results recorded) before a peer is allowed to
// treat it as abandoned. The executor's per-container upgrade timeout is 15
// minutes and it records a container row per container, so a live execution
// keeps writing within this window.
const IntentExecutionStaleSeconds = 30 * 60

// CleanupStaleIntentExecutions marks interrupted executions failed on
// startup (Node's cleanupStaleIntentExecutions). Only executions whose lease
// has expired are reaped: the API and the image-sync runner share this
// database, and the runner's executions are still alive while it works on
// them. Liveness is measured by the newest container result written for the
// execution; executions with no results yet fall back to started_at.
func CleanupStaleIntentExecutions(ctx context.Context, database *sql.DB, staleSeconds int) (int64, error) {
	res, err := database.ExecContext(ctx,
		`UPDATE intent_executions
		 SET status = 'failed',
		     completed_at = CURRENT_TIMESTAMP,
		     error_message = 'Execution was interrupted (server restart detected)'
		 WHERE status IN ('pending', 'running') AND completed_at IS NULL
		   AND datetime(COALESCE(
		     (SELECT MAX(created_at) FROM intent_execution_containers ec WHERE ec.execution_id = intent_executions.id),
		     started_at
		   )) < datetime('now', ?)`,
		fmt.Sprintf("-%d seconds", staleSeconds))
	if err != nil {
		return 0, fmt.Errorf("cleanup stale intent executions: %w", err)
	}
	return res.RowsAffected()
}

// UpdateIntentExecution finalizes an execution. The completed_at IS NULL
// guard keeps completion monotonic: whichever terminal write lands first
// (executor success, executor failure, or a peer's stale-execution cleanup)
// wins, and later writes are no-ops.
func UpdateIntentExecution(ctx context.Context, database *sql.DB, id int64, status string, matched, upgraded, failed, skipped int, errMsg *string) error {
	_, err := database.ExecContext(ctx,
		`UPDATE intent_executions SET status=?, containers_matched=?, containers_upgraded=?,
		 containers_failed=?, containers_skipped=?, error_message=?,
		 completed_at=CURRENT_TIMESTAMP,
		 duration_ms=CAST((julianday(CURRENT_TIMESTAMP)-julianday(started_at))*86400000 AS INTEGER)
		 WHERE id=? AND completed_at IS NULL`,
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

// IntentExecContainerInsert is one per-container result row for an intent
// execution (Node's addIntentExecutionContainer payload).
type IntentExecContainerInsert struct {
	ExecutionID      int64
	ContainerID      string
	ContainerName    string
	ImageName        string
	SourceInstanceID *int64
	RunnerID         *int64
	Status           string
	OldImage         *string
	NewImage         *string
	OldDigest        *string
	NewDigest        *string
	ErrorMessage     *string
	DurationMs       *int64
}

// InsertIntentExecutionContainer records a per-container result row for an
// intent execution, mirroring Node's addIntentExecutionContainer.
func InsertIntentExecutionContainer(ctx context.Context, database *sql.DB, in IntentExecContainerInsert) error {
	_, err := database.ExecContext(ctx,
		`INSERT INTO intent_execution_containers
		 (execution_id, container_id, container_name, image_name, source_instance_id, runner_id, status,
		  old_image, new_image, old_digest, new_digest, error_message, duration_ms)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		in.ExecutionID, in.ContainerID, in.ContainerName, in.ImageName, in.SourceInstanceID, in.RunnerID, in.Status,
		in.OldImage, in.NewImage, in.OldDigest, in.NewDigest, in.ErrorMessage, in.DurationMs)
	return err
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
