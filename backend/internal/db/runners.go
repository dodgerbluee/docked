package db

import (
	"context"
	"database/sql"
	"fmt"
)

// RunnerRow is a row from the runners table.
type RunnerRow struct {
	ID      int64
	Name    string
	URL     string
	APIKey  string
	Enabled bool
}

// GetEnabledRunners returns all enabled runners for the given user.
func GetEnabledRunners(ctx context.Context, database *sql.DB, userID int64) ([]RunnerRow, error) {
	const q = `
SELECT id, name, url, api_key, enabled
FROM runners
WHERE user_id = ? AND enabled = 1
ORDER BY created_at ASC`

	rows, err := database.QueryContext(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("query runners: %w", err)
	}
	defer rows.Close()

	var result []RunnerRow
	for rows.Next() {
		var runner RunnerRow
		var enabled int
		if err := rows.Scan(&runner.ID, &runner.Name, &runner.URL, &runner.APIKey, &enabled); err != nil {
			return nil, fmt.Errorf("scan runner row: %w", err)
		}
		runner.Enabled = enabled == 1
		result = append(result, runner)
	}

	return result, rows.Err()
}

// RegistryData holds the registry_image_versions fields for a given image+tag.
type RegistryData struct {
	LatestDigest      sql.NullString
	LatestVersion     sql.NullString
	LatestTag         sql.NullString
	LatestPublishDate sql.NullString
	Provider          sql.NullString
	LastChecked       sql.NullString
}

// GetRegistryData looks up registry update info for a normalized image repo+tag
// for a specific user. Returns zero-value RegistryData if no match found.
func GetRegistryData(ctx context.Context, database *sql.DB, userID int64, imageRepo, imageTag string) (RegistryData, error) {
	const q = `
SELECT latest_digest, latest_version, tag, latest_publish_date, provider, last_checked
FROM registry_image_versions
WHERE user_id = ?
  AND (
      image_repo = ?
      OR REPLACE(image_repo, 'docker.io/', '') = REPLACE(?, 'docker.io/', '')
  )
  AND (
      tag = ?
      OR REPLACE(tag, '@sha256', '') = REPLACE(?, '@sha256', '')
  )
LIMIT 1`

	var registryData RegistryData
	err := database.QueryRowContext(ctx, q, userID, imageRepo, imageRepo, imageTag, imageTag).Scan(
		&registryData.LatestDigest,
		&registryData.LatestVersion,
		&registryData.LatestTag,
		&registryData.LatestPublishDate,
		&registryData.Provider,
		&registryData.LastChecked,
	)
	if err == sql.ErrNoRows {
		return RegistryData{}, nil
	}
	if err != nil {
		return RegistryData{}, fmt.Errorf("query registry data: %w", err)
	}
	return registryData, nil
}
