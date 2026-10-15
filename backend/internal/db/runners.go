package db

import (
	"context"
	"database/sql"
	"fmt"
)

// RunnerRow is a row from the runners table.
type RunnerRow struct {
	ID            int64
	UserID        int64
	Name          string
	URL           string
	APIKey        string
	Enabled       bool
	Version       sql.NullString
	LatestVersion sql.NullString
	DockerEnabled sql.NullInt64
	LastSeen      sql.NullString
	DockerStatus  sql.NullString
	CreatedAt     string
	UpdatedAt     string
}

const runnerCols = `id, user_id, name, url, api_key, enabled, version, latest_version, docker_enabled, last_seen, docker_status, created_at, updated_at`

func scanRunner(row interface{ Scan(...any) error }) (RunnerRow, error) {
	var r RunnerRow
	var enabled int
	err := row.Scan(&r.ID, &r.UserID, &r.Name, &r.URL, &r.APIKey, &enabled,
		&r.Version, &r.LatestVersion, &r.DockerEnabled, &r.LastSeen, &r.DockerStatus,
		&r.CreatedAt, &r.UpdatedAt)
	r.Enabled = enabled == 1
	return r, err
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

// DeleteRunner removes a runner.
func DeleteRunner(ctx context.Context, database *sql.DB, id, userID int64) error {
	_, err := database.ExecContext(ctx,
		"DELETE FROM runners WHERE id = ? AND user_id = ?", id, userID)
	return err
}
