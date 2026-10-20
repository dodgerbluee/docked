package db

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// ParseSQLiteTime parses timestamp strings read back from SQLite. Values
// written by CURRENT_TIMESTAMP ("2006-01-02 15:04:05", UTC) come back in
// that form for TEXT columns, but the modernc driver normalizes
// DATETIME-affinity columns (batch_runs.started_at/completed_at) to RFC3339
// ("2006-01-02T15:04:05Z"). Both forms are accepted; the result is UTC.
func ParseSQLiteTime(s string) (time.Time, error) {
	s = strings.Replace(s, " ", "T", 1)
	if !strings.HasSuffix(s, "Z") {
		s += "Z"
	}
	return time.Parse(time.RFC3339, s)
}

// BatchConfigRow is a row from the batch_config table.
type BatchConfigRow struct {
	ID              int64
	UserID          int64
	JobType         string
	Enabled         int
	IntervalMinutes int
	CreatedAt       string
	UpdatedAt       string
}

// BatchRunRow is a row from the batch_runs table.
type BatchRunRow struct {
	ID                int64
	UserID            int64
	JobType           string
	Status            string
	StartedAt         string
	CompletedAt       sql.NullString
	DurationMs        sql.NullInt64
	ContainersChecked int
	ContainersUpdated int
	ErrorMessage      sql.NullString
	Logs              sql.NullString
	IsManual          int
}

func GetBatchConfigs(ctx context.Context, database *sql.DB, userID int64) ([]BatchConfigRow, error) {
	rows, err := database.QueryContext(ctx,
		`SELECT id, user_id, job_type, enabled, interval_minutes, created_at, updated_at
		 FROM batch_config WHERE user_id = ?`, userID)
	if err != nil {
		return nil, fmt.Errorf("get batch configs: %w", err)
	}
	defer rows.Close()

	var results []BatchConfigRow
	for rows.Next() {
		var r BatchConfigRow
		if err := rows.Scan(&r.ID, &r.UserID, &r.JobType, &r.Enabled,
			&r.IntervalMinutes, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan batch config: %w", err)
		}
		results = append(results, r)
	}
	return results, rows.Err()
}

func UpdateBatchConfig(ctx context.Context, database *sql.DB, userID int64, jobType string, enabled bool, intervalMinutes int) error {
	enabledInt := 0
	if enabled {
		enabledInt = 1
	}
	_, err := database.ExecContext(ctx,
		`INSERT INTO batch_config (user_id, job_type, enabled, interval_minutes)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(user_id, job_type) DO UPDATE SET enabled = ?, interval_minutes = ?, updated_at = datetime('now')`,
		userID, jobType, enabledInt, intervalMinutes, enabledInt, intervalMinutes)
	return err
}

func GetBatchRuns(ctx context.Context, database *sql.DB, userID int64, jobType *string, limit int, offset int) ([]BatchRunRow, int, error) {
	// Count
	countQuery := "SELECT COUNT(*) FROM batch_runs WHERE user_id = ?"
	countArgs := []any{userID}
	if jobType != nil {
		countQuery += " AND job_type = ?"
		countArgs = append(countArgs, *jobType)
	}
	var total int
	if err := database.QueryRowContext(ctx, countQuery, countArgs...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count batch runs: %w", err)
	}

	// Fetch
	query := `SELECT id, user_id, job_type, status, started_at, completed_at,
	          duration_ms, containers_checked, containers_updated, error_message, logs, is_manual
	          FROM batch_runs WHERE user_id = ?`
	args := []any{userID}
	if jobType != nil {
		query += " AND job_type = ?"
		args = append(args, *jobType)
	}
	query += " ORDER BY started_at DESC LIMIT ? OFFSET ?"
	args = append(args, limit, offset)

	rows, err := database.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("get batch runs: %w", err)
	}
	defer rows.Close()

	var results []BatchRunRow
	for rows.Next() {
		var r BatchRunRow
		if err := rows.Scan(&r.ID, &r.UserID, &r.JobType, &r.Status, &r.StartedAt,
			&r.CompletedAt, &r.DurationMs, &r.ContainersChecked,
			&r.ContainersUpdated, &r.ErrorMessage, &r.Logs, &r.IsManual); err != nil {
			return nil, 0, fmt.Errorf("scan batch run: %w", err)
		}
		results = append(results, r)
	}
	return results, total, rows.Err()
}

func GetBatchRunByID(ctx context.Context, database *sql.DB, id, userID int64) (*BatchRunRow, error) {
	row := database.QueryRowContext(ctx,
		`SELECT id, user_id, job_type, status, started_at, completed_at,
		        duration_ms, containers_checked, containers_updated, error_message, logs, is_manual
		 FROM batch_runs WHERE id = ? AND user_id = ?`, id, userID)

	var r BatchRunRow
	err := row.Scan(&r.ID, &r.UserID, &r.JobType, &r.Status, &r.StartedAt,
		&r.CompletedAt, &r.DurationMs, &r.ContainersChecked,
		&r.ContainersUpdated, &r.ErrorMessage, &r.Logs, &r.IsManual)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get batch run: %w", err)
	}
	return &r, nil
}

func CreateBatchRun(ctx context.Context, database *sql.DB, userID int64, jobType string, isManual bool) (int64, error) {
	manual := 0
	if isManual {
		manual = 1
	}
	res, err := database.ExecContext(ctx,
		"INSERT INTO batch_runs (user_id, job_type, status, is_manual) VALUES (?, ?, 'running', ?)",
		userID, jobType, manual)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func CompleteBatchRun(ctx context.Context, database *sql.DB, id int64, status string, checked, updated int, errMsg *string) error {
	_, err := database.ExecContext(ctx,
		`UPDATE batch_runs SET status=?, completed_at=CURRENT_TIMESTAMP,
		 duration_ms=CAST((julianday(CURRENT_TIMESTAMP)-julianday(started_at))*86400000 AS INTEGER),
		 containers_checked=?, containers_updated=?, error_message=?
		 WHERE id=?`,
		status, checked, updated, errMsg, id)
	return err
}

// UpdateBatchRun finalizes a client-driven batch run (parity with Node's updateBatchRun:
// status, duration from started_at, counts, error message, and logs; scoped by user).
func UpdateBatchRun(ctx context.Context, database *sql.DB, id, userID int64, status string, checked, updated int, errMsg, logs *string) error {
	res, err := database.ExecContext(ctx,
		`UPDATE batch_runs SET status = ?, completed_at = CURRENT_TIMESTAMP,
		 duration_ms = CAST((julianday(CURRENT_TIMESTAMP)-julianday(started_at))*86400000 AS INTEGER),
		 containers_checked = ?, containers_updated = ?, error_message = ?, logs = ?
		 WHERE id = ? AND user_id = ?`,
		status, checked, updated, errMsg, logs, id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("batch run not found")
	}
	return nil
}
