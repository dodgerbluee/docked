package db

import (
	"context"
	"database/sql"
)

type DeployedImageRow struct {
	ID          int64
	ImageRepo   string
	ImageTag    string
	ImageDigest sql.NullString
	Registry    sql.NullString
	Namespace   sql.NullString
	Repository  sql.NullString
	LastSeen    string
}

// GetUnusedImages returns deployed_images that are not referenced by any container.
func GetUnusedImages(ctx context.Context, database *sql.DB, userID int64) ([]DeployedImageRow, error) {
	q := `SELECT di.id, di.image_repo, di.image_tag, di.image_digest, di.registry, di.namespace, di.repository, di.last_seen
		FROM deployed_images di
		WHERE di.user_id = ?
		AND di.image_repo NOT IN (
			SELECT COALESCE(image_repo, '') FROM containers WHERE user_id = ?
		)
		ORDER BY di.last_seen DESC`
	rows, err := database.QueryContext(ctx, q, userID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []DeployedImageRow
	for rows.Next() {
		var r DeployedImageRow
		if err := rows.Scan(&r.ID, &r.ImageRepo, &r.ImageTag, &r.ImageDigest,
			&r.Registry, &r.Namespace, &r.Repository, &r.LastSeen); err != nil {
			return nil, err
		}
		result = append(result, r)
	}
	return result, rows.Err()
}

// GetContainersMatchingIntent returns container rows matching the intent's match/exclude criteria.
func GetContainersMatchingIntent(ctx context.Context, database *sql.DB, userID int64,
	matchContainers, matchImages, matchSources, matchStacks, matchRegistries []string,
	excludeContainers, excludeImages, excludeStacks, excludeRegistries []string,
	limit, offset int) ([]ContainerRow, int, error) {

	// Build WHERE clause dynamically
	base := "SELECT id, user_id, source_instance_id, runner_id, container_id, container_name, endpoint_id, image_name, image_repo, status, state, stack_name, current_digest, uses_network_mode, provides_network, last_seen, created_at FROM containers WHERE user_id = ?"
	args := []any{userID}

	if len(matchContainers) > 0 {
		base += " AND container_name IN (" + placeholders(len(matchContainers)) + ")"
		for _, v := range matchContainers {
			args = append(args, v)
		}
	}
	if len(matchImages) > 0 {
		base += " AND image_repo IN (" + placeholders(len(matchImages)) + ")"
		for _, v := range matchImages {
			args = append(args, v)
		}
	}
	if len(matchStacks) > 0 {
		base += " AND stack_name IN (" + placeholders(len(matchStacks)) + ")"
		for _, v := range matchStacks {
			args = append(args, v)
		}
	}
	if len(excludeContainers) > 0 {
		base += " AND container_name NOT IN (" + placeholders(len(excludeContainers)) + ")"
		for _, v := range excludeContainers {
			args = append(args, v)
		}
	}
	if len(excludeImages) > 0 {
		base += " AND image_repo NOT IN (" + placeholders(len(excludeImages)) + ")"
		for _, v := range excludeImages {
			args = append(args, v)
		}
	}
	if len(excludeStacks) > 0 {
		base += " AND (stack_name IS NULL OR stack_name NOT IN (" + placeholders(len(excludeStacks)) + "))"
		for _, v := range excludeStacks {
			args = append(args, v)
		}
	}

	// Count
	countQ := "SELECT COUNT(*) FROM (" + base + ")"
	var total int
	database.QueryRowContext(ctx, countQ, args...).Scan(&total)

	base += " ORDER BY container_name LIMIT ? OFFSET ?"
	args = append(args, limit, offset)

	rows, err := database.QueryContext(ctx, base, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var result []ContainerRow
	for rows.Next() {
		r, err := scanRow(rows)
		if err != nil {
			return nil, 0, err
		}
		result = append(result, r)
	}
	return result, total, rows.Err()
}

func placeholders(n int) string {
	s := ""
	for i := 0; i < n; i++ {
		if i > 0 {
			s += ","
		}
		s += "?"
	}
	return s
}
