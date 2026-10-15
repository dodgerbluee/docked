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

	q := "SELECT id, intent_id, user_id, status, trigger_type, containers_matched, containers_upgraded, containers_failed, containers_skipped, error_message, started_at, completed_at, duration_ms FROM intent_executions WHERE user_id = ?"
	args2 := []any{userID}
	if intentID != nil {
		q += " AND intent_id = ?"
		args2 = append(args2, *intentID)
	}
	q += " ORDER BY started_at DESC LIMIT ? OFFSET ?"
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
			&r.ErrorMessage, &r.StartedAt, &r.CompletedAt, &r.DurationMs); err != nil {
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
