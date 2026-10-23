package db

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
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

// CanonicalRepoKey normalizes a docker.io repo for registry lookups, the same
// way the containers↔registry_image_versions SQL join does (see
// canonicalRepoSQL). Scans store Hub repos without the host ("library/nginx"),
// while live Docker refs may carry it ("docker.io/library/nginx"); without
// this the live join misses.
func CanonicalRepoKey(repo string) string {
	return strings.TrimPrefix(repo, "docker.io/")
}

// GetRegistryData looks up the latest registry version info for a given image repo/tag.
func GetRegistryData(ctx context.Context, database *sql.DB, userID int64, imageRepo, imageTag string) (*RegistryData, error) {
	// ORDER BY keeps the precedence explicit: an exact tag row wins over the
	// tag-agnostic (NULL tag) row. Without it SQLite returns whichever row it
	// scans first, so a repo with both can report the tag-agnostic version.
	row := database.QueryRowContext(ctx,
		`SELECT latest_digest, latest_version, tag, latest_publish_date, provider, last_checked
		 FROM registry_image_versions
		 WHERE user_id = ? AND REPLACE(image_repo, 'docker.io/', '') = ? AND (tag = ? OR tag IS NULL)
		 ORDER BY CASE WHEN tag = ? THEN 0 ELSE 1 END
		 LIMIT 1`,
		userID, CanonicalRepoKey(imageRepo), imageTag, imageTag)

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

// RegistryDataMap holds every registry_image_versions row for one user so a
// live container listing can join registry data with a single query instead
// of one GetRegistryData per container. Get mirrors GetRegistryData's match
// semantics: exact repo+tag first, then a tag-agnostic (NULL tag) row.
type RegistryDataMap struct {
	exact    map[string]*RegistryData // image_repo + "\x00" + tag
	fallback map[string]*RegistryData // image_repo, for rows with NULL tag
}

func GetRegistryDataMap(ctx context.Context, database *sql.DB, userID int64) (*RegistryDataMap, error) {
	rows, err := database.QueryContext(ctx,
		`SELECT image_repo, tag, latest_digest, latest_version, latest_publish_date, provider, last_checked
		 FROM registry_image_versions WHERE user_id = ?`, userID)
	if err != nil {
		return nil, fmt.Errorf("get registry data map: %w", err)
	}
	defer rows.Close()

	m := &RegistryDataMap{
		exact:    make(map[string]*RegistryData),
		fallback: make(map[string]*RegistryData),
	}
	for rows.Next() {
		var repo string
		var tag sql.NullString
		var d RegistryData
		if err := rows.Scan(&repo, &tag, &d.LatestDigest, &d.LatestVersion,
			&d.LatestPublishDate, &d.Provider, &d.LastChecked); err != nil {
			return nil, fmt.Errorf("scan registry data map: %w", err)
		}
		d.LatestTag = tag
		// Key on the canonical (host-stripped) repo so live lookups with a
		// docker.io-prefixed ref still hit rows stored without it.
		repo = CanonicalRepoKey(repo)
		if tag.Valid {
			m.exact[repo+"\x00"+tag.String] = &d
		} else {
			m.fallback[repo] = &d
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read registry data map: %w", err)
	}
	return m, nil
}

// Get returns the registry row matching (repo, tag) with the same precedence
// as GetRegistryData, or nil when nothing matches.
func (m *RegistryDataMap) Get(repo, tag string) *RegistryData {
	repo = CanonicalRepoKey(repo)
	if d, ok := m.exact[repo+"\x00"+tag]; ok {
		return d
	}
	if d, ok := m.fallback[repo]; ok {
		return d
	}
	return nil
}

// GetAssociatedImages returns the distinct image repos associated with a
// repository access token (deployed_images.repository_token_id).
func GetAssociatedImages(ctx context.Context, database *sql.DB, userID, tokenID int64) ([]string, error) {
	rows, err := database.QueryContext(ctx,
		"SELECT DISTINCT image_repo FROM deployed_images WHERE user_id = ? AND repository_token_id = ?",
		userID, tokenID)
	if err != nil {
		return nil, fmt.Errorf("get associated images: %w", err)
	}
	defer rows.Close()

	var result []string
	for rows.Next() {
		var repo string
		if err := rows.Scan(&repo); err != nil {
			return nil, fmt.Errorf("scan associated image: %w", err)
		}
		result = append(result, repo)
	}
	return result, rows.Err()
}

// AssociateImagesWithToken replaces the image associations for a token
// (clear existing, then set the new list), mirroring Node's
// associateImagesWithToken. An empty list just clears all associations.
//
// The clear and the set are one write transaction: two concurrent
// replacements otherwise interleave and leave the union of both lists, so the
// token ends up authorizing images neither caller asked for.
func AssociateImagesWithToken(ctx context.Context, database *sql.DB, userID, tokenID int64, imageRepos []string) error {
	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin token associations: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx,
		`UPDATE deployed_images SET repository_token_id = NULL, updated_at = CURRENT_TIMESTAMP
		 WHERE user_id = ? AND repository_token_id = ?`, userID, tokenID); err != nil {
		return fmt.Errorf("clear token associations: %w", err)
	}
	if len(imageRepos) > 0 {
		placeholders := strings.Repeat("?, ", len(imageRepos))
		placeholders = placeholders[:len(placeholders)-2]
		args := make([]any, 0, len(imageRepos)+2)
		args = append(args, tokenID, userID)
		for _, repo := range imageRepos {
			args = append(args, repo)
		}
		if _, err := tx.ExecContext(ctx,
			`UPDATE deployed_images SET repository_token_id = ?, updated_at = CURRENT_TIMESTAMP
			 WHERE user_id = ? AND image_repo IN (`+placeholders+`)`, args...); err != nil {
			return fmt.Errorf("set token associations: %w", err)
		}
	}
	return tx.Commit()
}
