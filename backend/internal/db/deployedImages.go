package db

import (
	"context"
	"database/sql"
	"strings"
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
// Uses the same JOIN structure as containersQuery so scanRow works correctly.
func GetContainersMatchingIntent(ctx context.Context, database *sql.DB, userID int64,
	matchContainers, matchImages, matchSources, matchStacks, matchRegistries []string,
	excludeContainers, excludeImages, excludeStacks, excludeRegistries []string,
	limit, offset int) ([]ContainerRow, int, error) {

	// Build extra AND clauses for intent matching
	var extra string
	args := []any{userID}

	if len(matchContainers) > 0 {
		extra += " AND c.container_name IN (" + placeholders(len(matchContainers)) + ")"
		for _, v := range matchContainers {
			args = append(args, v)
		}
	}
	if len(matchImages) > 0 {
		extra += " AND c.image_repo IN (" + placeholders(len(matchImages)) + ")"
		for _, v := range matchImages {
			args = append(args, v)
		}
	}
	if len(matchStacks) > 0 {
		extra += " AND c.stack_name IN (" + placeholders(len(matchStacks)) + ")"
		for _, v := range matchStacks {
			args = append(args, v)
		}
	}
	if len(matchSources) > 0 {
		extra += " AND c.source_instance_id IN (" + placeholders(len(matchSources)) + ")"
		for _, v := range matchSources {
			args = append(args, v)
		}
	}
	if len(excludeContainers) > 0 {
		extra += " AND c.container_name NOT IN (" + placeholders(len(excludeContainers)) + ")"
		for _, v := range excludeContainers {
			args = append(args, v)
		}
	}
	if len(excludeImages) > 0 {
		extra += " AND c.image_repo NOT IN (" + placeholders(len(excludeImages)) + ")"
		for _, v := range excludeImages {
			args = append(args, v)
		}
	}
	if len(excludeStacks) > 0 {
		extra += " AND (c.stack_name IS NULL OR c.stack_name NOT IN (" + placeholders(len(excludeStacks)) + "))"
		for _, v := range excludeStacks {
			args = append(args, v)
		}
	}

	// Count using the same FROM/JOIN structure
	countQ := `SELECT COUNT(*) FROM containers c
		LEFT JOIN deployed_images di ON c.deployed_image_id = di.id
		WHERE c.user_id = ?` + extra
	var total int
	database.QueryRowContext(ctx, countQ, args...).Scan(&total)

	// Main query: reuse containersQuery structure with extra clauses
	query := containersQuery
	// Strip trailing backtick and ORDER BY, then inject extra conditions
	if end := strings.LastIndex(query, "`"); end != -1 {
		query = query[:end]
	}
	if idx := strings.LastIndex(query, "WHERE c.user_id = ?"); idx != -1 {
		query = query[:idx+len("WHERE c.user_id = ?")] + extra + " ORDER BY c.container_name LIMIT ? OFFSET ?"
	} else {
		query += extra + " ORDER BY c.container_name LIMIT ? OFFSET ?"
	}
	args = append(args, limit, offset)

	rows, err := database.QueryContext(ctx, query, args...)
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
