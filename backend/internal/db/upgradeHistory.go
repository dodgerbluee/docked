package db

import (
	"context"
	"database/sql"
	"fmt"
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
