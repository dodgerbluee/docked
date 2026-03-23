package db

import (
	"context"
	"database/sql"
	"fmt"
)

// ContainerRow is the raw data read from the database JOIN query.
// It maps 1:1 with query columns and is intentionally not the API shape.
type ContainerRow struct {
	ContainerID     string
	ContainerName   string
	ImageName       sql.NullString
	ImageRepo       sql.NullString
	Status          sql.NullString
	State           sql.NullString
	StackName       sql.NullString
	EndpointID      sql.NullInt64
	RunnerID        sql.NullInt64
	UsesNetworkMode bool
	ProvidesNetwork bool
	LastSeen        sql.NullString
	CreatedAt       sql.NullString

	// From deployed_images
	CurrentDigest sql.NullString
	ImageTag      sql.NullString
	RepoDigests   sql.NullString // JSON array stored as TEXT

	// From registry_image_versions
	LatestDigest      sql.NullString
	LatestVersion     sql.NullString
	LatestTag         sql.NullString
	LatestPublishDate sql.NullString
	Provider          sql.NullString
	LastChecked       sql.NullString
	NoDigest          bool

	// From source_instances / runners
	SourceName sql.NullString
	SourceURL  sql.NullString
	RunnerName sql.NullString
	RunnerURL  sql.NullString
}

// The query is a direct port of the Node.js getContainersWithUpdates function.
// It handles image_repo normalisation (docker.io/ prefix) and tag normalisation
// (@sha256 suffix) to match deployed_images against registry_image_versions.
const containersQuery = `
SELECT
    c.container_id,
    c.container_name,
    c.image_name,
    c.image_repo,
    c.status,
    c.state,
    c.stack_name,
    c.endpoint_id,
    c.runner_id,
    COALESCE(c.uses_network_mode, 0),
    COALESCE(c.provides_network, 0),
    c.last_seen,
    c.created_at,

    di.image_digest          AS current_digest,
    di.image_tag,
    di.repo_digests,

    riv.latest_digest,
    riv.latest_version,
    riv.tag                  AS latest_tag,
    riv.latest_publish_date,
    riv.provider,
    riv.last_checked,
    CASE
        WHEN di.id IS NOT NULL AND riv.id IS NOT NULL AND riv.latest_digest IS NULL THEN 1
        ELSE 0
    END AS no_digest,

    si.name  AS source_name,
    si.url   AS source_url,
    r.name   AS runner_name,
    r.url    AS runner_url

FROM containers c
LEFT JOIN deployed_images di ON c.deployed_image_id = di.id
LEFT JOIN registry_image_versions riv
    ON  di.user_id = riv.user_id
    AND (
        (di.image_repo = riv.image_repo)
        OR (REPLACE(di.image_repo, 'docker.io/', '') = REPLACE(riv.image_repo, 'docker.io/', ''))
        OR (
            CASE
                WHEN INSTR(di.image_repo, ':') > 0
                    THEN SUBSTR(di.image_repo, 1, INSTR(di.image_repo, ':') - 1)
                WHEN INSTR(di.image_repo, '@') > 0
                    THEN SUBSTR(di.image_repo, 1, INSTR(di.image_repo, '@') - 1)
                ELSE di.image_repo
            END = REPLACE(riv.image_repo, 'docker.io/', '')
        )
        OR (
            REPLACE(di.image_repo, 'docker.io/', '') =
            CASE
                WHEN INSTR(riv.image_repo, ':') > 0
                    THEN SUBSTR(riv.image_repo, 1, INSTR(riv.image_repo, ':') - 1)
                WHEN INSTR(riv.image_repo, '@') > 0
                    THEN SUBSTR(riv.image_repo, 1, INSTR(riv.image_repo, '@') - 1)
                ELSE REPLACE(riv.image_repo, 'docker.io/', '')
            END
        )
    )
    AND (
        (di.image_tag = riv.tag)
        OR (di.image_tag = REPLACE(riv.tag, '@sha256', ''))
        OR (riv.tag = di.image_tag || '@sha256')
        OR (
            REPLACE(COALESCE(di.image_tag, ''), '@sha256', '') =
            REPLACE(COALESCE(riv.tag, ''), '@sha256', '')
        )
    )
LEFT JOIN source_instances si ON c.source_instance_id = si.id
LEFT JOIN runners         r  ON c.runner_id           = r.id
WHERE c.user_id = ?
ORDER BY c.last_seen DESC
`

// GetContainers returns all containers for the given user with their full update info.
func GetContainers(ctx context.Context, database *sql.DB, userID int64) ([]ContainerRow, error) {
	rows, err := database.QueryContext(ctx, containersQuery, userID)
	if err != nil {
		return nil, fmt.Errorf("query containers: %w", err)
	}
	defer rows.Close()

	var result []ContainerRow
	for rows.Next() {
		row, err := scanRow(rows)
		if err != nil {
			return nil, fmt.Errorf("scan container row: %w", err)
		}
		result = append(result, row)
	}

	return result, rows.Err()
}

func scanRow(rows *sql.Rows) (ContainerRow, error) {
	var (
		row             ContainerRow
		usesNetworkMode int
		providesNetwork int
		noDigest        int
	)

	err := rows.Scan(
		&row.ContainerID,
		&row.ContainerName,
		&row.ImageName,
		&row.ImageRepo,
		&row.Status,
		&row.State,
		&row.StackName,
		&row.EndpointID,
		&row.RunnerID,
		&usesNetworkMode,
		&providesNetwork,
		&row.LastSeen,
		&row.CreatedAt,
		&row.CurrentDigest,
		&row.ImageTag,
		&row.RepoDigests,
		&row.LatestDigest,
		&row.LatestVersion,
		&row.LatestTag,
		&row.LatestPublishDate,
		&row.Provider,
		&row.LastChecked,
		&noDigest,
		&row.SourceName,
		&row.SourceURL,
		&row.RunnerName,
		&row.RunnerURL,
	)
	if err != nil {
		return ContainerRow{}, err
	}

	row.UsesNetworkMode = usesNetworkMode == 1
	row.ProvidesNetwork = providesNetwork == 1
	row.NoDigest = noDigest == 1

	return row, nil
}
