package db

import (
	"context"
	"database/sql"
	"fmt"
)

// RegistryData holds the latest version info for an image from registry_image_versions.
type RegistryData struct {
	LatestDigest      sql.NullString
	LatestVersion     sql.NullString
	LatestTag         sql.NullString
	LatestPublishDate sql.NullString
	Provider          sql.NullString
	LastChecked       sql.NullString
}

// GetRegistryData looks up the latest registry version info for a given image repo/tag.
func GetRegistryData(ctx context.Context, database *sql.DB, userID int64, imageRepo, imageTag string) (*RegistryData, error) {
	row := database.QueryRowContext(ctx,
		`SELECT latest_digest, latest_version, tag, latest_publish_date, provider, last_checked
		 FROM registry_image_versions
		 WHERE user_id = ? AND image_repo = ? AND (tag = ? OR tag IS NULL)
		 LIMIT 1`,
		userID, imageRepo, imageTag)

	var d RegistryData
	err := row.Scan(&d.LatestDigest, &d.LatestVersion, &d.LatestTag,
		&d.LatestPublishDate, &d.Provider, &d.LastChecked)
	if err == sql.ErrNoRows {
		return &d, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get registry data: %w", err)
	}
	return &d, nil
}
