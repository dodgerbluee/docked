package db

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// ContainerRow is the raw data read from the database JOIN query.
// It maps 1:1 with query columns and is intentionally not the API shape.
type ContainerRow struct {
	ID              int64
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
	UpdatedAt       sql.NullString
	DeployedImageID sql.NullInt64

	// From deployed_images
	CurrentDigest sql.NullString
	ImageTag      sql.NullString
	RepoDigests   sql.NullString // JSON array stored as TEXT
	Registry      sql.NullString

	ImageCreatedDate sql.NullString

	// From registry_image_versions
	LatestDigest      sql.NullString
	LatestVersion     sql.NullString
	LatestTag         sql.NullString
	LatestPublishDate sql.NullString
	Provider          sql.NullString
	LastChecked       sql.NullString
	NoDigest          bool

	// From source_instances / runners
	SourceName       sql.NullString
	SourceURL        sql.NullString
	SourceInstanceID sql.NullInt64
	RunnerName       sql.NullString
	RunnerURL        sql.NullString
}

// The query is a direct port of the Node.js getContainersWithUpdates function.
// It handles image_repo normalisation (docker.io/ prefix) and tag normalisation
// (@sha256 suffix) to match deployed_images against registry_image_versions.
const containersQuery = `
SELECT
    c.id,
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
    c.updated_at,
    c.deployed_image_id,

	    di.image_digest          AS current_digest,
	    di.image_tag,
	    di.repo_digests,
	    di.registry,
	    di.image_created_date,

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
    c.source_instance_id,
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
	return scanContainerRows(rows)
}

// GetContainersByRunner returns the containers owned by a single runner.
// The Runner.containers GraphQL field uses this instead of re-fetching the
// user's entire container list once per runner (N+1 full scans on pages
// that render several runners).
func GetContainersByRunner(ctx context.Context, database *sql.DB, userID, runnerID int64) ([]ContainerRow, error) {
	q := strings.Replace(containersQuery, "WHERE c.user_id = ?", "WHERE c.user_id = ? AND c.runner_id = ?", 1)
	rows, err := database.QueryContext(ctx, q, userID, runnerID)
	if err != nil {
		return nil, fmt.Errorf("query containers by runner: %w", err)
	}
	defer rows.Close()
	return scanContainerRows(rows)
}

func scanContainerRows(rows *sql.Rows) ([]ContainerRow, error) {
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
		&row.ID,
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
		&row.UpdatedAt,
		&row.DeployedImageID,
		&row.CurrentDigest,
		&row.ImageTag,
		&row.RepoDigests,
		&row.Registry,
		&row.ImageCreatedDate,
		&row.LatestDigest,
		&row.LatestVersion,
		&row.LatestTag,
		&row.LatestPublishDate,
		&row.Provider,
		&row.LastChecked,
		&noDigest,
		&row.SourceName,
		&row.SourceURL,
		&row.SourceInstanceID,
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

// GetContainersPaginated returns a page of containers for the given user.
func GetContainersPaginated(ctx context.Context, database *sql.DB, userID int64, limit, offset int) ([]ContainerRow, int, error) {
	var total int
	err := database.QueryRowContext(ctx, "SELECT COUNT(*) FROM containers WHERE user_id = ?", userID).Scan(&total)
	if err != nil {
		return nil, 0, fmt.Errorf("count containers: %w", err)
	}

	query := containersQuery + " LIMIT ? OFFSET ?"
	rows, err := database.QueryContext(ctx, query, userID, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("query containers paginated: %w", err)
	}
	defer rows.Close()

	var result []ContainerRow
	for rows.Next() {
		row, err := scanRow(rows)
		if err != nil {
			return nil, 0, fmt.Errorf("scan container row: %w", err)
		}
		result = append(result, row)
	}
	return result, total, rows.Err()
}

// GetContainerByID returns a single container by primary key, scoped to user.
func GetContainerByID(ctx context.Context, database *sql.DB, id, userID int64) (*ContainerRow, error) {
	// Inject the id predicate into the WHERE clause (containersQuery already
	// ends with "WHERE c.user_id = ? ORDER BY ...", so appending "AND ..." after
	// it would land past the ORDER BY and produce invalid SQL).
	query := strings.Replace(containersQuery, "WHERE c.user_id = ?", "WHERE c.user_id = ? AND c.id = ?", 1)
	rows, err := database.QueryContext(ctx, query, userID, id)
	if err != nil {
		return nil, fmt.Errorf("get container by id: %w", err)
	}
	defer rows.Close()

	if !rows.Next() {
		if err := rows.Err(); err != nil {
			return nil, fmt.Errorf("get container by id: %w", err)
		}
		return nil, nil
	}
	r, err := scanRow(rows)
	if err != nil {
		return nil, fmt.Errorf("get container by id: %w", err)
	}
	return &r, nil
}

// GetContainerByDockerID resolves a Docker container id within one explicit
// runner identity. Docker ids are not globally unique across runners, so both
// user ownership and backend identity are part of the predicate.
func GetContainerByDockerID(ctx context.Context, database *sql.DB, userID int64, containerID string, runnerID *int64) (*ContainerRow, error) {
	predicate := "WHERE c.user_id = ? AND c.container_id = ?"
	args := []any{userID, containerID}
	if runnerID != nil {
		predicate += " AND c.runner_id = ?"
		args = append(args, *runnerID)
	} else {
		return nil, fmt.Errorf("container backend identity is required")
	}
	query := strings.Replace(containersQuery, "WHERE c.user_id = ?", predicate, 1)
	rows, err := database.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("get container by docker id: %w", err)
	}
	defer rows.Close()

	if !rows.Next() {
		if err := rows.Err(); err != nil {
			return nil, fmt.Errorf("get container by docker id: %w", err)
		}
		return nil, nil
	}
	r, err := scanRow(rows)
	if err != nil {
		return nil, fmt.Errorf("get container by docker id: %w", err)
	}
	return &r, nil
}
