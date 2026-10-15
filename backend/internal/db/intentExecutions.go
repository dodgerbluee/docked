package db

import (
	"context"
	"database/sql"
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
