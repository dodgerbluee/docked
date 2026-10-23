package db

import (
	"context"
	"crypto/subtle"
	"database/sql"
	"fmt"
)

// RunnerRow is a row from the runners table.
type RunnerRow struct {
	ID                int64
	UserID            int64
	Name              string
	URL               string
	APIKey            string
	Enabled           bool
	Version           sql.NullString
	LatestVersion     sql.NullString
	VersionCheckedAt  sql.NullString
	DockerEnabled     sql.NullInt64
	LastSeen          sql.NullString
	DockerStatus      sql.NullString
	DockerStatusSince sql.NullString
	CreatedAt         string
	UpdatedAt         string
}

const runnerCols = `id, user_id, name, url, api_key, enabled, version, latest_version, version_checked_at, docker_enabled, last_seen, docker_status, docker_status_since, created_at, updated_at`

func scanRunner(row interface{ Scan(...any) error }) (RunnerRow, error) {
	var r RunnerRow
	var enabled int
	err := row.Scan(&r.ID, &r.UserID, &r.Name, &r.URL, &r.APIKey, &enabled,
		&r.Version, &r.LatestVersion, &r.VersionCheckedAt, &r.DockerEnabled, &r.LastSeen,
		&r.DockerStatus, &r.DockerStatusSince, &r.CreatedAt, &r.UpdatedAt)
	r.Enabled = enabled == 1
	return r, err
}

// GetAllEnabledRunners returns enabled runners across ALL users — the poller
// is a system-wide job. Parity with Node's db.getAllRunnersWithKeys.
func GetAllEnabledRunners(ctx context.Context, database *sql.DB) ([]RunnerRow, error) {
	rows, err := database.QueryContext(ctx,
		"SELECT "+runnerCols+" FROM runners WHERE enabled = 1 ORDER BY created_at ASC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RunnerRow
	for rows.Next() {
		r, err := scanRunner(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// GetEnabledRunners returns all enabled runners for the given user.
func GetEnabledRunners(ctx context.Context, database *sql.DB, userID int64) ([]RunnerRow, error) {
	rows, err := database.QueryContext(ctx,
		"SELECT "+runnerCols+" FROM runners WHERE user_id = ? AND enabled = 1 ORDER BY created_at ASC", userID)
	if err != nil {
		return nil, fmt.Errorf("query runners: %w", err)
	}
	defer rows.Close()

	var result []RunnerRow
	for rows.Next() {
		r, err := scanRunner(rows)
		if err != nil {
			return nil, fmt.Errorf("scan runner row: %w", err)
		}
		result = append(result, r)
	}
	return result, rows.Err()
}

// GetAllRunners returns all runners (enabled and disabled) for the given user.
func GetAllRunners(ctx context.Context, database *sql.DB, userID int64) ([]RunnerRow, error) {
	rows, err := database.QueryContext(ctx,
		"SELECT "+runnerCols+" FROM runners WHERE user_id = ? ORDER BY created_at ASC", userID)
	if err != nil {
		return nil, fmt.Errorf("query all runners: %w", err)
	}
	defer rows.Close()

	var result []RunnerRow
	for rows.Next() {
		r, err := scanRunner(rows)
		if err != nil {
			return nil, fmt.Errorf("scan runner row: %w", err)
		}
		result = append(result, r)
	}
	return result, rows.Err()
}

// GetRunnerByID returns a single runner by ID, scoped to user.
func GetRunnerByID(ctx context.Context, database *sql.DB, id, userID int64) (*RunnerRow, error) {
	row := database.QueryRowContext(ctx,
		"SELECT "+runnerCols+" FROM runners WHERE id = ? AND user_id = ?", id, userID)

	r, err := scanRunner(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get runner by id: %w", err)
	}
	return &r, nil
}

// CreateRunner inserts a new runner.
func CreateRunner(ctx context.Context, database *sql.DB, userID int64, name, url, apiKey string) (int64, error) {
	result, err := database.ExecContext(ctx,
		"INSERT INTO runners (user_id, name, url, api_key) VALUES (?, ?, ?, ?)",
		userID, name, url, apiKey)
	if err != nil {
		return 0, fmt.Errorf("create runner: %w", err)
	}
	return result.LastInsertId()
}

// UpdateRunner updates fields on a runner.
func UpdateRunner(ctx context.Context, database *sql.DB, id, userID int64, name, url, apiKey *string, enabled *bool) error {
	setClauses := []string{}
	args := []any{}

	if name != nil {
		setClauses = append(setClauses, "name = ?")
		args = append(args, *name)
	}
	if url != nil {
		setClauses = append(setClauses, "url = ?")
		args = append(args, *url)
	}
	if apiKey != nil {
		setClauses = append(setClauses, "api_key = ?")
		args = append(args, *apiKey)
	}
	if enabled != nil {
		v := 0
		if *enabled {
			v = 1
		}
		setClauses = append(setClauses, "enabled = ?")
		args = append(args, v)
	}

	if len(setClauses) == 0 {
		return nil
	}

	setClauses = append(setClauses, "updated_at = datetime('now')")
	args = append(args, id, userID)

	query := fmt.Sprintf("UPDATE runners SET %s WHERE id = ? AND user_id = ?",
		joinStrings(setClauses, ", "))

	_, err := database.ExecContext(ctx, query, args...)
	return err
}

func joinStrings(parts []string, sep string) string {
	result := ""
	for i, p := range parts {
		if i > 0 {
			result += sep
		}
		result += p
	}
	return result
}

// DeleteRunner removes a runner.
// DeleteRunner removes a runner and everything hanging off it. The schema
// declares ON DELETE CASCADE / SET NULL for runner_events, containers and
// upgrade_history, but foreign-key enforcement is OFF (Node parity — see
// db.Open), so the cascades never fire on their own and must be issued
// explicitly, in one transaction. Enrollment tokens are user-scoped, so
// DeleteUser already covers them.
func DeleteRunner(ctx context.Context, database *sql.DB, id, userID int64) error {
	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin delete runner: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck // no-op after commit
	owned := `SELECT id FROM runners WHERE id = ? AND user_id = ?`
	for _, stmt := range []struct{ label, sql string }{
		{"runner_events", "DELETE FROM runner_events WHERE runner_id IN (" + owned + ")"},
		{"containers", "DELETE FROM containers WHERE runner_id IN (" + owned + ")"},
		{"upgrade_history", "UPDATE upgrade_history SET runner_id = NULL WHERE runner_id IN (" + owned + ")"},
	} {
		if _, err := tx.ExecContext(ctx, stmt.sql, id, userID); err != nil {
			return fmt.Errorf("delete runner %s: %w", stmt.label, err)
		}
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM runners WHERE id = ? AND user_id = ?", id, userID); err != nil {
		return fmt.Errorf("delete runner: %w", err)
	}
	return tx.Commit()
}

// UpdateRunnerVersion persists the runner's reported version and the latest
// known release (parity with Node's db/runners.updateRunnerVersion). A nil
// dockerEnabled keeps the stored docker_enabled value (COALESCE), and so does a
// nil latestVersion: a failed release lookup is not an observation that the
// runner has no known latest version, and overwriting with NULL erased the
// value a previous successful lookup stored.
func UpdateRunnerVersion(ctx context.Context, database *sql.DB, id, userID int64, version, latestVersion *string, dockerEnabled *bool) error {
	var dockerEnabledValue any
	if dockerEnabled != nil {
		v := 0
		if *dockerEnabled {
			v = 1
		}
		dockerEnabledValue = v
	}
	_, err := database.ExecContext(ctx,
		`UPDATE runners
		    SET version = ?, latest_version = COALESCE(?, latest_version), docker_enabled = COALESCE(?, docker_enabled), version_checked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
		  WHERE id = ? AND user_id = ?`,
		version, latestVersion, dockerEnabledValue, id, userID)
	return err
}

// GetRunnerByName looks up a runner case-insensitively across all users
// (re-enrollment does not know the owning user). Parity with Node's
// db/runners.getRunnerByName.
func GetRunnerByName(ctx context.Context, database *sql.DB, name string) (*RunnerRow, error) {
	row := database.QueryRowContext(ctx,
		"SELECT "+runnerCols+" FROM runners WHERE LOWER(name) = LOWER(?) LIMIT 1", name)

	r, err := scanRunner(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get runner by name: %w", err)
	}
	return &r, nil
}

// GetRunnerByAPIKey finds the runner that owns an API key (heartbeat auth).
func GetRunnerByAPIKey(ctx context.Context, database *sql.DB, apiKey string) (*RunnerRow, error) {
	row := database.QueryRowContext(ctx,
		"SELECT "+runnerCols+" FROM runners WHERE api_key = ? LIMIT 1", apiKey)

	r, err := scanRunner(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get runner by api key: %w", err)
	}
	return &r, nil
}

// UpdateRunnerURL rewrites only the runner URL (heartbeat IP-change path).
func UpdateRunnerURL(ctx context.Context, database *sql.DB, id int64, url string) error {
	_, err := database.ExecContext(ctx,
		"UPDATE runners SET url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", url, id)
	return err
}

// UpdateRunnerAPIKey rewrites the API key and URL (re-enrollment flow).
func UpdateRunnerAPIKey(ctx context.Context, database *sql.DB, id int64, apiKey, url string) error {
	_, err := database.ExecContext(ctx,
		"UPDATE runners SET api_key = ?, url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", apiKey, url, id)
	return err
}

// APIKeysEqual compares two API keys in constant time. Both sides are padded
// to the max length first so the comparison never early-exits on a length or
// byte mismatch (mirrors Node's timingSafeEqual padding). API keys are
// high-entropy random tokens, so no password hashing is needed.
func APIKeysEqual(a, b string) bool {
	bufA, bufB := []byte(a), []byte(b)
	n := len(bufA)
	if len(bufB) > n {
		n = len(bufB)
	}
	padA := make([]byte, n)
	padB := make([]byte, n)
	copy(padA, bufA)
	copy(padB, bufB)
	return subtle.ConstantTimeCompare(padA, padB) == 1
}
