package db

import (
	"context"
	"database/sql"
	"fmt"
)

// GetContainerDetailRecords restores the old per-container inspector without
// dumping unrelated user data. Every query includes ownership and histories
// additionally include the runner (Docker IDs and names repeat across hosts).
func GetContainerDetailRecords(ctx context.Context, database *sql.DB, userID int64, c *ContainerRow) (map[string]any, error) {
	if !c.RunnerID.Valid {
		return nil, fmt.Errorf("container runner is required")
	}
	query := func(stmt string, args ...any) ([]map[string]any, error) {
		rows, err := database.QueryContext(ctx, stmt, args...)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		return scanRawRows(rows)
	}
	result := map[string]any{}
	for _, spec := range []struct {
		key, sql string
		args     []any
	}{
		{"containerRecords", "SELECT * FROM containers WHERE user_id = ? AND runner_id = ? AND container_id = ? LIMIT 1", []any{userID, c.RunnerID.Int64, c.ContainerID}},
		{"allDeployedImages", "SELECT * FROM deployed_images WHERE user_id = ? AND image_repo = ? AND image_tag = ? ORDER BY last_seen DESC, id DESC LIMIT 100", []any{userID, c.ImageRepo.String, c.ImageTag.String}},
		{"allRegistryImageVersions", "SELECT * FROM registry_image_versions WHERE user_id = ? AND REPLACE(image_repo, 'docker.io/', '') = REPLACE(?, 'docker.io/', '') ORDER BY last_checked DESC, id DESC LIMIT 100", []any{userID, c.ImageRepo.String}},
		{"upgradeHistory", "SELECT * FROM upgrade_history WHERE user_id = ? AND runner_id = ? AND (container_id = ? OR container_name = ?) ORDER BY created_at DESC, id DESC LIMIT 20", []any{userID, c.RunnerID.Int64, c.ContainerID, c.ContainerName}},
		{"allContainersWithSameName", "SELECT * FROM containers WHERE user_id = ? AND runner_id = ? AND container_name = ? ORDER BY last_seen DESC, id DESC LIMIT 100", []any{userID, c.RunnerID.Int64, c.ContainerName}},
	} {
		rows, err := query(spec.sql, spec.args...)
		if err != nil {
			return nil, fmt.Errorf("container details %s: %w", spec.key, err)
		}
		result[spec.key] = rows
	}
	if c.DeployedImageID.Valid {
		rows, err := query("SELECT * FROM deployed_images WHERE user_id = ? AND id = ?", userID, c.DeployedImageID.Int64)
		if err != nil {
			return nil, err
		}
		if len(rows) > 0 {
			result["deployedImage"] = rows[0]
		}
	}
	return result, nil
}
