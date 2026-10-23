package db

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// UpgradeHistoryRow is a row from the upgrade_history table.
type UpgradeHistoryRow struct {
	ID               int64
	UserID           int64
	SourceInstanceID sql.NullInt64
	SourceName       sql.NullString
	RunnerID         sql.NullInt64
	RunnerName       sql.NullString
	ContainerID      string
	ContainerName    string
	EndpointID       sql.NullString
	SourceURL        sql.NullString
	OldImage         string
	NewImage         string
	OldDigest        sql.NullString
	NewDigest        sql.NullString
	OldVersion       sql.NullString
	NewVersion       sql.NullString
	ImageRepo        sql.NullString
	Registry         sql.NullString
	Namespace        sql.NullString
	Repository       sql.NullString
	Status           string
	ErrorMessage     sql.NullString
	UpgradeDuration  sql.NullInt64
	IntentID         sql.NullInt64
	CreatedAt        string
}

const upgradeCols = `id, user_id, source_instance_id, source_instance_name, runner_id, runner_name,
	container_id, container_name, endpoint_id, source_url,
	old_image, new_image, old_digest, new_digest, old_version, new_version,
	image_repo, registry, namespace, repository,
	status, error_message, upgrade_duration_ms, intent_id, created_at`

func scanUpgrade(row interface{ Scan(...any) error }) (UpgradeHistoryRow, error) {
	var r UpgradeHistoryRow
	err := row.Scan(&r.ID, &r.UserID, &r.SourceInstanceID, &r.SourceName, &r.RunnerID, &r.RunnerName,
		&r.ContainerID, &r.ContainerName, &r.EndpointID, &r.SourceURL,
		&r.OldImage, &r.NewImage, &r.OldDigest, &r.NewDigest, &r.OldVersion, &r.NewVersion,
		&r.ImageRepo, &r.Registry, &r.Namespace, &r.Repository,
		&r.Status, &r.ErrorMessage, &r.UpgradeDuration, &r.IntentID, &r.CreatedAt)
	return r, err
}

// UpgradeHistoryStats aggregates the upgrade_history table for one user,
// mirroring Node's getUpgradeHistoryStats.
type UpgradeHistoryStats struct {
	Total        int
	Successful   int
	Failed       int
	AvgDuration  sql.NullFloat64
	FirstUpgrade sql.NullString
	LastUpgrade  sql.NullString
}

func GetUpgradeHistoryStats(ctx context.Context, database *sql.DB, userID int64) (*UpgradeHistoryStats, error) {
	var s UpgradeHistoryStats
	err := database.QueryRowContext(ctx,
		`SELECT COUNT(*),
			COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0),
			AVG(upgrade_duration_ms), MIN(created_at), MAX(created_at)
		 FROM upgrade_history WHERE user_id = ?`, userID).
		Scan(&s.Total, &s.Successful, &s.Failed, &s.AvgDuration, &s.FirstUpgrade, &s.LastUpgrade)
	if err != nil {
		return nil, fmt.Errorf("upgrade history stats: %w", err)
	}
	return &s, nil
}

// UpgradeHistoryInsert carries one upgrade_history row, mirroring the fields
// Node's createUpgradeHistory writes (status domain: "success" | "failed").
type UpgradeHistoryInsert struct {
	UserID            int64
	SourceInstanceID  *int64
	SourceName        string
	RunnerID          *int64
	RunnerName        string
	ContainerID       string
	ContainerName     string
	EndpointID        *int64
	SourceURL         string
	OldImage          string
	NewImage          string
	Status            string
	ErrorMessage      string
	UpgradeDurationMs *int64
	IntentID          *int64
}

// InsertUpgradeHistory writes one upgrade_history row. Node refuses rows that
// lack userId/containerId/containerName/oldImage/newImage; mirror that guard
// so the shared table never gets partial rows from either backend.
func InsertUpgradeHistory(ctx context.Context, database *sql.DB, in *UpgradeHistoryInsert) (int64, error) {
	if in.UserID == 0 || in.ContainerID == "" || in.ContainerName == "" || in.OldImage == "" || in.NewImage == "" {
		return 0, fmt.Errorf("upgrade history requires userId, containerId, containerName, oldImage and newImage")
	}
	status := in.Status
	if status == "" {
		status = "success"
	}
	nullStr := func(s string) any {
		if s == "" {
			return nil
		}
		return s
	}
	nullInt := func(p *int64) any {
		if p == nil {
			return nil
		}
		return *p
	}
	res, err := database.ExecContext(ctx,
		`INSERT INTO upgrade_history (
			user_id, source_instance_id, source_instance_name, runner_id, runner_name,
			container_id, container_name, endpoint_id, source_url,
			old_image, new_image, status, error_message, upgrade_duration_ms, intent_id
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		in.UserID, nullInt(in.SourceInstanceID), nullStr(in.SourceName), nullInt(in.RunnerID), nullStr(in.RunnerName),
		in.ContainerID, in.ContainerName, nullInt(in.EndpointID), nullStr(in.SourceURL),
		in.OldImage, in.NewImage, status, nullStr(in.ErrorMessage), nullInt(in.UpgradeDurationMs), nullInt(in.IntentID))
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func GetUpgradeHistory(ctx context.Context, database *sql.DB, userID int64, limit, offset int) ([]UpgradeHistoryRow, int, error) {
	var total int
	err := database.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM upgrade_history WHERE user_id = ?", userID).Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("count upgrade history: %w", err)
	}

	rows, err := database.QueryContext(ctx,
		"SELECT "+upgradeCols+" FROM upgrade_history WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
		userID, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("get upgrade history: %w", err)
	}
	defer rows.Close()

	var results []UpgradeHistoryRow
	for rows.Next() {
		r, err := scanUpgrade(rows)
		if err != nil {
			return nil, 0, fmt.Errorf("scan upgrade history: %w", err)
		}
		results = append(results, r)
	}
	return results, total, rows.Err()
}

// UpgradeHistoryFilter narrows GetUpgradeHistoryFiltered results. All fields
// are optional; nil means "no constraint". Status must already be a DB domain
// value (e.g. "success"), not the GraphQL enum.
type UpgradeHistoryFilter struct {
	ContainerName *string
	Status        *string
	IntentID      *int64
	RunnerID      *int64
	From          *time.Time
	To            *time.Time
}

// GetUpgradeHistoryFiltered returns upgrade history matching every set field
// of the filter. created_at is stored as "YYYY-MM-DD HH:MM:SS" (UTC) by both
// backends, so range bounds are formatted the same way for lexicographic
// comparison.
func GetUpgradeHistoryFiltered(ctx context.Context, database *sql.DB, userID int64, limit, offset int, f *UpgradeHistoryFilter) ([]UpgradeHistoryRow, int, error) {
	where := []string{"user_id = ?"}
	args := []any{userID}
	if f != nil {
		if f.ContainerName != nil && *f.ContainerName != "" {
			where = append(where, "container_name LIKE ?")
			args = append(args, "%"+*f.ContainerName+"%")
		}
		if f.Status != nil {
			where = append(where, "status = ?")
			args = append(args, *f.Status)
		}
		if f.IntentID != nil {
			where = append(where, "intent_id = ?")
			args = append(args, *f.IntentID)
		}
		if f.RunnerID != nil {
			where = append(where, "runner_id = ?")
			args = append(args, *f.RunnerID)
		}
		if f.From != nil {
			where = append(where, "created_at >= ?")
			args = append(args, f.From.UTC().Format("2006-01-02 15:04:05"))
		}
		if f.To != nil {
			where = append(where, "created_at <= ?")
			args = append(args, f.To.UTC().Format("2006-01-02 15:04:05"))
		}
	}
	cond := strings.Join(where, " AND ")

	var total int
	if err := database.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM upgrade_history WHERE "+cond, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count upgrade history: %w", err)
	}

	q := "SELECT " + upgradeCols + " FROM upgrade_history WHERE " + cond + " ORDER BY created_at DESC LIMIT ? OFFSET ?"
	rows, err := database.QueryContext(ctx, q, append(args, limit, offset)...)
	if err != nil {
		return nil, 0, fmt.Errorf("get upgrade history: %w", err)
	}
	defer rows.Close()

	var results []UpgradeHistoryRow
	for rows.Next() {
		r, err := scanUpgrade(rows)
		if err != nil {
			return nil, 0, fmt.Errorf("scan upgrade history: %w", err)
		}
		results = append(results, r)
	}
	return results, total, rows.Err()
}

// GetUpgradeHistoryBy returns upgrade history filtered by a single column
// (one of: source_instance_id, runner_id, container_id). The column name is an
// internal constant, never user input, so it is safe to interpolate.
func GetUpgradeHistoryBy(ctx context.Context, database *sql.DB, userID int64, limit, offset int, col string, val any) ([]UpgradeHistoryRow, int, error) {
	var total int
	if err := database.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM upgrade_history WHERE user_id = ? AND "+col+" = ?", userID, val).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count upgrade history: %w", err)
	}

	rows, err := database.QueryContext(ctx,
		"SELECT "+upgradeCols+" FROM upgrade_history WHERE user_id = ? AND "+col+" = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
		userID, val, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("get upgrade history: %w", err)
	}
	defer rows.Close()

	var results []UpgradeHistoryRow
	for rows.Next() {
		r, err := scanUpgrade(rows)
		if err != nil {
			return nil, 0, fmt.Errorf("scan upgrade history: %w", err)
		}
		results = append(results, r)
	}
	return results, total, rows.Err()
}

// GetUpgradeHistoryForContainer returns the history rows belonging to one
// container, matched on its stable identity (host + name) rather than its
// Docker container id.
//
// An upgrade removes the old container and recreates it under the same name,
// so the row written by that upgrade records the id of the container that was
// REPLACED. Matching on the live container's current id finds nothing after
// the very upgrade the row describes, and every upgraded container's history
// goes empty.
func GetUpgradeHistoryForContainer(ctx context.Context, database *sql.DB, userID int64, limit, offset int, runnerID, endpointID *int64, name string) ([]UpgradeHistoryRow, int, error) {
	if name == "" {
		return nil, 0, fmt.Errorf("get upgrade history for container: name required")
	}
	where := []string{"user_id = ?", "container_name = ?"}
	args := []any{userID, name}
	switch {
	case runnerID != nil:
		where = append(where, "runner_id = ?")
		args = append(args, *runnerID)
	case endpointID != nil:
		where = append(where, "endpoint_id = ?")
		args = append(args, *endpointID)
	}
	cond := strings.Join(where, " AND ")

	var total int
	if err := database.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM upgrade_history WHERE "+cond, args...).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count upgrade history: %w", err)
	}

	rows, err := database.QueryContext(ctx,
		"SELECT "+upgradeCols+" FROM upgrade_history WHERE "+cond+" ORDER BY created_at DESC LIMIT ? OFFSET ?",
		append(args, limit, offset)...)
	if err != nil {
		return nil, 0, fmt.Errorf("get upgrade history: %w", err)
	}
	defer rows.Close()

	var results []UpgradeHistoryRow
	for rows.Next() {
		r, err := scanUpgrade(rows)
		if err != nil {
			return nil, 0, fmt.Errorf("scan upgrade history: %w", err)
		}
		results = append(results, r)
	}
	return results, total, rows.Err()
}
