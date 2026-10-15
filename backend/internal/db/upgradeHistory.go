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
	ContainerName    *string
	Status           *string
	IntentID         *int64
	SourceInstanceID *int64
	RunnerID         *int64
	From             *time.Time
	To               *time.Time
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
		if f.SourceInstanceID != nil {
			where = append(where, "source_instance_id = ?")
			args = append(args, *f.SourceInstanceID)
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
