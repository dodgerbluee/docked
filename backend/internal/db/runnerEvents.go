package db

import (
	"context"
	"database/sql"
)

// Runner event log (append-only), mirroring Node's db/runnerEvents.js.

const (
	EventStatusChange     = "status_change"
	EventDockerChange     = "docker_change"
	EventHeartbeat        = "heartbeat"
	EventHeartbeatError   = "heartbeat_error"
	EventHealthCheck      = "health_check"
	EventHealthCheckError = "health_check_error"
	EventFetchError       = "fetch_error"
	EventURLChange        = "url_change"
	EventVersionChange    = "version_change"
	EventEnrolled         = "enrolled"
	EventReEnrolled       = "re_enrolled"
	EventUpdated          = "updated"
	EventInfo             = "info"
)

// RunnerEventRow is a row from the runner_events table.
type RunnerEventRow struct {
	ID        int64
	RunnerID  int64
	EventType string
	Message   sql.NullString
	Details   sql.NullString
	CreatedAt sql.NullString
}

// InsertRunnerEvent appends an event. details should already be a JSON string
// (or plain text); empty strings are stored as NULL.
func InsertRunnerEvent(ctx context.Context, database *sql.DB, runnerID int64, eventType, message, details string) error {
	var msg, det any
	if message != "" {
		msg = message
	}
	if details != "" {
		det = details
	}
	_, err := database.ExecContext(ctx,
		"INSERT INTO runner_events (runner_id, event_type, message, details) VALUES (?, ?, ?, ?)",
		runnerID, eventType, msg, det)
	return err
}

// FetchRunnerEvents returns events newest-first with optional type filter.
func FetchRunnerEvents(ctx context.Context, database *sql.DB, runnerID int64, limit, offset int, eventType string) ([]RunnerEventRow, error) {
	if limit <= 0 {
		limit = 50
	}
	query := "SELECT id, runner_id, event_type, message, details, created_at FROM runner_events WHERE runner_id = ?"
	args := []any{runnerID}
	if eventType != "" {
		query += " AND event_type = ?"
		args = append(args, eventType)
	}
	query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
	args = append(args, limit, offset)

	rows, err := database.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []RunnerEventRow
	for rows.Next() {
		var r RunnerEventRow
		if err := rows.Scan(&r.ID, &r.RunnerID, &r.EventType, &r.Message, &r.Details, &r.CreatedAt); err != nil {
			return nil, err
		}
		result = append(result, r)
	}
	return result, rows.Err()
}

// CountRunnerEvents returns the total event count for pagination.
func CountRunnerEvents(ctx context.Context, database *sql.DB, runnerID int64, eventType string) (int, error) {
	query := "SELECT COUNT(*) FROM runner_events WHERE runner_id = ?"
	args := []any{runnerID}
	if eventType != "" {
		query += " AND event_type = ?"
		args = append(args, eventType)
	}
	var count int
	err := database.QueryRowContext(ctx, query, args...).Scan(&count)
	return count, err
}

// PruneRunnerEvents keeps the newest keepPerRunner events per runner and
// deletes the rest. Parity with Node's db/runnerEvents.pruneRunnerEvents.
func PruneRunnerEvents(ctx context.Context, database *sql.DB, keepPerRunner int) (int64, error) {
	res, err := database.ExecContext(ctx,
		`DELETE FROM runner_events WHERE id NOT IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY runner_id ORDER BY created_at DESC) as rn
            FROM runner_events
          ) WHERE rn <= ?
        )`, keepPerRunner)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// UpdateRunnerLastSeen bumps the runner's last_seen timestamp.
func UpdateRunnerLastSeen(ctx context.Context, database *sql.DB, runnerID int64) error {
	_, err := database.ExecContext(ctx,
		"UPDATE runners SET last_seen = datetime('now') WHERE id = ?", runnerID)
	return err
}

// UpdateRunnerDockerStatus sets docker_status (and docker_status_since when the
// value actually changed). Returns true when the status transitioned.
func UpdateRunnerDockerStatus(ctx context.Context, database *sql.DB, runnerID int64, status string) (bool, error) {
	var old string
	err := database.QueryRowContext(ctx,
		"SELECT COALESCE(docker_status, 'unknown') FROM runners WHERE id = ?", runnerID).Scan(&old)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if old == status {
		return false, nil
	}
	_, err = database.ExecContext(ctx,
		"UPDATE runners SET docker_status = ?, docker_status_since = datetime('now'), updated_at = CURRENT_TIMESTAMP WHERE id = ?",
		status, runnerID)
	return err == nil, err
}
