package db

import (
	"context"
	"database/sql"
	"errors"
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
	HeartbeatAt       sql.NullString
}

// HeartbeatBatchRun refreshes a running job's lease timestamp. Long-running
// scans tick this so the cross-process stale-run reaper measures silence
// since the last beat, not since the job started.
func HeartbeatBatchRun(ctx context.Context, database *sql.DB, id int64) error {
	_, err := database.ExecContext(ctx,
		`UPDATE batch_runs SET heartbeat_at = CURRENT_TIMESTAMP
		 WHERE id = ? AND status = 'running' AND completed_at IS NULL`, id)
	if err != nil {
		return fmt.Errorf("heartbeat batch run: %w", err)
	}
	return nil
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

// ErrBatchRunActive reports that a 'running' batch_run row already exists for
// the (user, job) pair when an atomic claim was attempted.
var ErrBatchRunActive = errors.New("batch run already active")

// CreateBatchRunIfNoneRunning atomically claims the run slot: the guard
// check and the INSERT are a single statement, so the scheduler process and
// the GraphQL process racing on the same user+job can never both create a
// 'running' row (the previous check-then-insert pair could).
//
// The guard uses the same "still open" definition as every finalize/reap
// predicate (status='running' AND completed_at IS NULL). A row that already
// carries completed_at is finished, whatever its status text says, so it must
// not hold the slot forever: rows written by the older UpdateBatchRun (which
// stamped completed_at on progress updates) would otherwise wedge the job
// with no reaper able to touch them.
func CreateBatchRunIfNoneRunning(ctx context.Context, database *sql.DB, userID int64, jobType string, isManual bool) (int64, error) {
	manual := 0
	if isManual {
		manual = 1
	}
	res, err := database.ExecContext(ctx,
		`INSERT INTO batch_runs (user_id, job_type, status, is_manual)
		 SELECT ?, ?, 'running', ?
		 WHERE NOT EXISTS (
		   SELECT 1 FROM batch_runs
		   WHERE user_id = ? AND job_type = ? AND status = 'running' AND completed_at IS NULL
		 )`,
		userID, jobType, manual, userID, jobType)
	if err != nil {
		return 0, err
	}
	changes, err := res.RowsAffected()
	if err != nil {
		return 0, err
	}
	if changes == 0 {
		return 0, ErrBatchRunActive
	}
	return res.LastInsertId()
}

// CompleteBatchRun finalizes a run. The completed_at IS NULL guard keeps
// completion monotonic: a run already finalized (by a peer's stale-run
// reaper, for example) is never re-written.
func CompleteBatchRun(ctx context.Context, database *sql.DB, id int64, status string, checked, updated int, errMsg *string) error {
	_, err := database.ExecContext(ctx,
		`UPDATE batch_runs SET status=?, completed_at=CURRENT_TIMESTAMP,
		 duration_ms=CAST((julianday(CURRENT_TIMESTAMP)-julianday(started_at))*86400000 AS INTEGER),
		 containers_checked=?, containers_updated=?, error_message=?
		 WHERE id=? AND completed_at IS NULL`,
		status, checked, updated, errMsg, id)
	return err
}

// ReapStaleBatchRun conditionally marks one 'running' batch run failed,
// re-checking staleness INSIDE the UPDATE. The read-check-write pair
// it replaces raced: a heartbeat landing between the staleness check and
// the write used to get a healthy run marked failed anyway. Returns true
// when this caller actually reaped the row.
//
// The predicate keys on status='running' alone, so a row wedged by an older
// write (status still 'running' but completed_at already stamped) can still
// be repaired; completed_at is only filled in when it is missing.
func ReapStaleBatchRun(ctx context.Context, database *sql.DB, id int64, staleSeconds int) (bool, error) {
	res, err := database.ExecContext(ctx,
		`UPDATE batch_runs
		 SET status = 'failed',
			 completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
			 duration_ms = CAST((julianday(COALESCE(completed_at, CURRENT_TIMESTAMP))-julianday(started_at))*86400000 AS INTEGER),
			 containers_checked = 0, containers_updated = 0,
			 error_message = 'Job marked as failed: stale running job detected'
		 WHERE id = ? AND status = 'running'
		   AND datetime(COALESCE(heartbeat_at, completed_at, started_at)) < datetime('now', ?)`,
		id, fmt.Sprintf("-%d seconds", staleSeconds))
	if err != nil {
		return false, fmt.Errorf("reap stale batch run: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, err
	}
	return n == 1, nil
}

// batchRunTerminalStatuses are the statuses that finish a client-driven run.
// Anything else (pending/running) is a progress update.
func batchRunTerminalStatus(status string) bool {
	switch status {
	case "completed", "failed", "cancelled":
		return true
	default:
		return false
	}
}

// UpdateBatchRun records a client-driven batch run's status and counts
// (parity with Node's updateBatchRun: status, duration from started_at,
// counts, error message, and logs; scoped by user).
//
// Only a terminal status finalizes the row. The old version stamped
// completed_at on every call, so a client that reported progress
// (status='running') released the single-running-run slot while its run was
// still going: the next createBatchRun then started a second concurrent run,
// and the progress row itself became a 'running' row with completed_at set,
// which no reaper could fix (they all filter on completed_at IS NULL).
// Completion stays monotonic: a row already finalized is never re-written.
func UpdateBatchRun(ctx context.Context, database *sql.DB, id, userID int64, status string, checked, updated int, errMsg, logs *string) error {
	query := `UPDATE batch_runs SET status = ?,
		 containers_checked = ?, containers_updated = ?, error_message = ?, logs = ?`
	if batchRunTerminalStatus(status) {
		query += `, completed_at = CURRENT_TIMESTAMP,
		 duration_ms = CAST((julianday(CURRENT_TIMESTAMP)-julianday(started_at))*86400000 AS INTEGER)`
	}
	query += ` WHERE id = ? AND user_id = ? AND completed_at IS NULL`
	res, err := database.ExecContext(ctx, query,
		status, checked, updated, errMsg, logs, id, userID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("batch run not found or already finalized")
	}
	return nil
}
