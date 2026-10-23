package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// DockerHubImageVersion is the stored version row used by the update-check
// flow (docker_hub_image_versions is a legacy table; nothing writes it in the
// runner sync path, but Node still reads it for storedVersionInfo).
type DockerHubImageVersion struct {
	HasUpdate     bool
	CurrentDigest sql.NullString
	LatestDigest  sql.NullString
}

// GetDockerHubImageVersion ports getDockerHubImageVersion(userId, repo, tag).
func GetDockerHubImageVersion(ctx context.Context, database *sql.DB, userID int64, imageRepo, currentTag string) (*DockerHubImageVersion, error) {
	row := database.QueryRowContext(ctx,
		`SELECT has_update, current_digest, latest_digest
		 FROM docker_hub_image_versions
		 WHERE user_id = ? AND image_repo = ? AND current_tag = ?`,
		userID, imageRepo, currentTag)

	var v DockerHubImageVersion
	err := row.Scan(&v.HasUpdate, &v.CurrentDigest, &v.LatestDigest)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &v, nil
}

// ContainerVersionUpsert carries the container fields for
// UpsertContainerWithVersion (ports the containerData argument).
type ContainerVersionUpsert struct {
	ContainerID   string
	ContainerName string
	ImageName     string
	ImageRepo     string
	ImageTag      string
	Status        *string
	State         *string
	StackName     *string
	CurrentDigest *string
	Registry      string
	Namespace     string
	Repository    string
	RepoDigests   []string // clean "sha256:..." form

	// UsesNetworkMode / ProvidesNetwork mirror the domain shape: the container
	// depends on another container's network stack, respectively is depended
	// on for one. They drive the UI's network-mode warning.
	UsesNetworkMode bool
	ProvidesNetwork bool
}

// VersionData carries the registry version fields (ports the versionData
// argument; only supplied for a confirmed registry observation).
type VersionData struct {
	CurrentTag        string
	LatestTag         string
	LatestVersion     *string
	LatestDigest      *string
	LatestPublishDate *string
	Provider          string
}

// ErrRunnerGone reports that the runner a scan is writing for no longer exists
// (it was deleted while the scan was in flight). Callers must stop rather than
// keep re-creating container rows nothing will ever clean up.
var ErrRunnerGone = errors.New("runner no longer exists")

// runnerExists reports whether runnerID is enrolled for userID. Checked inside
// the write transaction: DeleteRunner removes the runner row and its container
// rows explicitly (foreign-key enforcement is off), so a scan that started
// before a delete would otherwise resurrect orphaned container rows.
func runnerExists(ctx context.Context, tx *sql.Conn, userID, runnerID int64) (bool, error) {
	var one int
	err := tx.QueryRowContext(ctx, `SELECT 1 FROM runners WHERE id = ? AND user_id = ?`, runnerID, userID).Scan(&one)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// UpsertContainerWithVersion ports db/containers.js upsertContainerWithVersion
// for the runner path (identity = user_id + container_id + runner_id).
// One BEGIN IMMEDIATE transaction: deployed_images upsert, containers
// UPDATE-then-INSERT, optional registry_image_versions upsert, COMMIT.
func UpsertContainerWithVersion(ctx context.Context, database *sql.DB, userID int64, data *ContainerVersionUpsert, version *VersionData, runnerID int64) (int64, error) {
	imageTag := data.ImageTag
	if imageTag == "" {
		parts := strings.Split(data.ImageName, ":")
		if len(parts) > 1 {
			imageTag = parts[1]
		} else {
			imageTag = "latest"
		}
	}

	conn, err := database.Conn(ctx)
	if err != nil {
		return 0, err
	}
	defer conn.Close()

	if _, err := conn.ExecContext(ctx, "BEGIN IMMEDIATE TRANSACTION"); err != nil {
		return 0, err
	}
	committed := false
	defer func() {
		if !committed {
			_, _ = conn.ExecContext(context.WithoutCancel(ctx), "ROLLBACK")
		}
	}()

	if ok, err := runnerExists(ctx, conn, userID, runnerID); err != nil {
		return 0, err
	} else if !ok {
		return 0, ErrRunnerGone
	}

	var deployedImageID int64
	if data.CurrentDigest == nil {
		// This scan could not determine a digest. If the container already has
		// a digest-bearing image row for the same repo/tag, keep pointing at
		// it: re-pointing at a NULL-digest row makes containerHasUpdate reject
		// the row forever, so the container silently stops being update
		// tracked.
		if id, ok, err := existingBaselineImageID(ctx, conn, userID, data.ContainerID, runnerID,
			data.ImageRepo, imageTag); err != nil {
			return 0, err
		} else if ok {
			if err := touchDeployedImageTx(ctx, conn, id, repoDigestsJSON(data.RepoDigests)); err != nil {
				return 0, err
			}
			deployedImageID = id
		}
	}
	if deployedImageID == 0 {
		deployedImageID, err = upsertDeployedImageTx(ctx, conn, userID, data.ImageRepo, imageTag,
			data.CurrentDigest, data.Registry, data.Namespace, data.Repository, data.RepoDigests)
		if err != nil {
			return 0, err
		}
	}

	usesNetwork, providesNetwork := 0, 0
	if data.UsesNetworkMode {
		usesNetwork = 1
	}
	if data.ProvidesNetwork {
		providesNetwork = 1
	}

	res, err := conn.ExecContext(ctx,
		`UPDATE containers SET
			container_name = ?, image_name = ?, image_repo = ?, status = ?, state = ?,
			stack_name = ?, deployed_image_id = ?, uses_network_mode = ?, provides_network = ?,
			last_seen = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
		 WHERE user_id = ? AND container_id = ? AND runner_id = ?`,
		data.ContainerName, data.ImageName, data.ImageRepo, data.Status, data.State,
		data.StackName, deployedImageID, usesNetwork, providesNetwork,
		userID, data.ContainerID, runnerID)
	if err != nil {
		return 0, err
	}

	var containerRecordID int64
	changes, err := res.RowsAffected()
	if err != nil {
		return 0, err
	}

	if changes > 0 {
		if err := conn.QueryRowContext(ctx,
			"SELECT id FROM containers WHERE user_id = ? AND container_id = ? AND runner_id = ?",
			userID, data.ContainerID, runnerID).Scan(&containerRecordID); err != nil {
			return 0, err
		}
	} else {
		ins, err := conn.ExecContext(ctx,
			`INSERT INTO containers
				(user_id, source_instance_id, runner_id, container_id, container_name, endpoint_id,
				 image_name, image_repo, status, state, stack_name, deployed_image_id,
				 uses_network_mode, provides_network, last_seen, updated_at)
			 VALUES (?, NULL, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
			userID, runnerID, data.ContainerID, data.ContainerName,
			data.ImageName, data.ImageRepo, data.Status, data.State, data.StackName, deployedImageID,
			usesNetwork, providesNetwork)
		if err != nil {
			return 0, err
		}
		containerRecordID, err = ins.LastInsertId()
		if err != nil {
			return 0, err
		}
	}

	if version != nil && data.ImageRepo != "" {
		vRegistry := data.Registry
		if vRegistry == "" {
			vRegistry = "docker.io"
		}
		vRepository := data.Repository
		if vRepository == "" {
			vRepository = data.ImageRepo
		}
		var vProvider any
		if version.Provider != "" {
			vProvider = version.Provider
		}
		var vNamespace any
		if data.Namespace != "" {
			vNamespace = data.Namespace
		}
		var vPublishDate any
		if version.LatestPublishDate != nil {
			vPublishDate = *version.LatestPublishDate
		}
		// A row accumulates metadata across lookups: no single provider
		// reports every column (dockerhub has a digest but no version, GitHub
		// releases the reverse, and a sparser later observation must not wipe
		// what an earlier one learned). INSERT OR REPLACE dropped the whole
		// row and rebuilt it from the newest, possibly partial, result.
		if _, err := conn.ExecContext(ctx,
			`INSERT INTO registry_image_versions
				(user_id, image_repo, registry, provider, namespace, repository, tag,
				 latest_digest, latest_version, latest_publish_date, exists_in_registry,
				 last_checked, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
			 ON CONFLICT(user_id, image_repo, tag) DO UPDATE SET
				 registry            = COALESCE(excluded.registry, registry),
				 provider            = COALESCE(excluded.provider, provider),
				 namespace           = COALESCE(excluded.namespace, namespace),
				 repository          = COALESCE(excluded.repository, repository),
				 latest_digest       = COALESCE(excluded.latest_digest, latest_digest),
				 latest_version      = COALESCE(excluded.latest_version, latest_version),
				 latest_publish_date = COALESCE(excluded.latest_publish_date, latest_publish_date),
				 exists_in_registry  = 1,
				 last_checked        = CURRENT_TIMESTAMP,
				 updated_at          = CURRENT_TIMESTAMP`,
			userID, data.ImageRepo, vRegistry, vProvider, vNamespace, vRepository,
			version.CurrentTag, version.LatestDigest, version.LatestVersion, vPublishDate); err != nil {
			return 0, err
		}
	}

	if _, err := conn.ExecContext(ctx, "COMMIT"); err != nil {
		return 0, err
	}
	committed = true
	return containerRecordID, nil
}

// repoDigestsJSON encodes the repo_digests column value (NULL for an empty
// list, so a scan that reports nothing does not erase a known list).
func repoDigestsJSON(repoDigests []string) any {
	if len(repoDigests) == 0 {
		return nil
	}
	b, err := json.Marshal(repoDigests)
	if err != nil {
		return nil
	}
	return string(b)
}

// touchDeployedImageTx bumps last_seen (and repo_digests when the scan brought
// a list) on an already matched deployed_images row.
func touchDeployedImageTx(ctx context.Context, conn *sql.Conn, id int64, repoDigestsJSON any) error {
	if repoDigestsJSON != nil {
		_, err := conn.ExecContext(ctx,
			`UPDATE deployed_images
			 SET last_seen = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, repo_digests = ?
			 WHERE id = ?`, repoDigestsJSON, id)
		return err
	}
	_, err := conn.ExecContext(ctx,
		`UPDATE deployed_images
		 SET last_seen = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
		 WHERE id = ?`, id)
	return err
}

// existingBaselineImageID returns the deployed_images row a container already
// points at, when that row carries a digest for the same repo/tag. Used to
// keep a known digest baseline alive across a scan that could not observe one.
func existingBaselineImageID(ctx context.Context, conn *sql.Conn, userID int64,
	containerID string, runnerID int64, imageRepo, imageTag string) (int64, bool, error) {

	var id int64
	err := conn.QueryRowContext(ctx,
		`SELECT c.deployed_image_id
		 FROM containers c
		 JOIN deployed_images di ON di.id = c.deployed_image_id
		 WHERE c.user_id = ? AND c.container_id = ? AND c.runner_id = ?
		   AND di.image_digest IS NOT NULL AND di.image_repo = ? AND di.image_tag = ?`,
		userID, containerID, runnerID, imageRepo, imageTag).Scan(&id)
	if err == sql.ErrNoRows {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, err
	}
	return id, true, nil
}

// upsertDeployedImageTx ports deployedImages.js upsertDeployedImage.
// Deviation from Node: when imageDigest is NULL we match with
// "image_digest IS NULL" and reuse the row. Node's "= ?" with a null
// parameter never matches (SQLite UNIQUE treats NULLs as distinct), which
// created a new deployed_images row on every scan.
func upsertDeployedImageTx(ctx context.Context, conn *sql.Conn, userID int64, imageRepo, imageTag string,
	imageDigest *string, registry, namespace, repository string, repoDigests []string) (int64, error) {

	digestsJSON := repoDigestsJSON(repoDigests)

	var id int64
	var err error
	if imageDigest != nil {
		err = conn.QueryRowContext(ctx,
			`SELECT id FROM deployed_images
			 WHERE user_id = ? AND image_repo = ? AND image_tag = ? AND image_digest = ?`,
			userID, imageRepo, imageTag, *imageDigest).Scan(&id)
	} else {
		err = conn.QueryRowContext(ctx,
			`SELECT id FROM deployed_images
			 WHERE user_id = ? AND image_repo = ? AND image_tag = ? AND image_digest IS NULL`,
			userID, imageRepo, imageTag).Scan(&id)
	}

	if err == nil {
		if err := touchDeployedImageTx(ctx, conn, id, digestsJSON); err != nil {
			return 0, err
		}
		return id, nil
	}
	if err != sql.ErrNoRows {
		return 0, err
	}

	vRepository := repository
	if vRepository == "" {
		vRepository = imageRepo
	}
	res, err := conn.ExecContext(ctx,
		`INSERT INTO deployed_images
			(user_id, image_repo, image_tag, image_digest, image_created_date, registry,
			 namespace, repository, repo_digests, first_seen, last_seen, created_at, updated_at)
		 VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
		userID, imageRepo, imageTag, imageDigest, registry, namespace, vRepository, digestsJSON)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// ReconcileRunnerSnapshot deletes the containers stored for a runner that the
// runner's own inventory no longer reports. A scan is a snapshot: containers
// removed on the runner would otherwise linger in the UI forever, and a runner
// that reports nothing must end up with no container rows at all.
//
// The runner is revalidated inside the transaction: when it has been deleted
// concurrently, DeleteRunner already removed the rows and this is a no-op.
func ReconcileRunnerSnapshot(ctx context.Context, database *sql.DB, userID, runnerID int64, snapshotIDs []string) (int, error) {
	conn, err := database.Conn(ctx)
	if err != nil {
		return 0, err
	}
	defer conn.Close()

	if _, err := conn.ExecContext(ctx, "BEGIN IMMEDIATE TRANSACTION"); err != nil {
		return 0, err
	}
	committed := false
	defer func() {
		if !committed {
			_, _ = conn.ExecContext(context.WithoutCancel(ctx), "ROLLBACK")
		}
	}()

	if ok, err := runnerExists(ctx, conn, userID, runnerID); err != nil {
		return 0, err
	} else if !ok {
		return 0, nil
	}

	query := `DELETE FROM containers WHERE user_id = ? AND runner_id = ?`
	args := []any{userID, runnerID}
	if len(snapshotIDs) > 0 {
		placeholders := strings.Repeat("?,", len(snapshotIDs))
		query += ` AND container_id NOT IN (` + strings.TrimSuffix(placeholders, ",") + `)`
		for _, id := range snapshotIDs {
			args = append(args, id)
		}
	}

	res, err := conn.ExecContext(ctx, query, args...)
	if err != nil {
		return 0, err
	}
	if _, err := conn.ExecContext(ctx, "COMMIT"); err != nil {
		return 0, err
	}
	committed = true
	n, err := res.RowsAffected()
	return int(n), err
}

// HasDiscordNotificationBeenSent ports the DB half of discordService.isDuplicate.
func HasDiscordNotificationBeenSent(ctx context.Context, database *sql.DB, userID int64, dedupKey string) (bool, error) {
	var count int
	err := database.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM discord_notifications_sent WHERE user_id = ? AND deduplication_key = ?",
		userID, dedupKey).Scan(&count)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// RecordDiscordNotificationSent ports recordDiscordNotificationSent.
func RecordDiscordNotificationSent(ctx context.Context, database *sql.DB, userID int64, dedupKey, notificationType string) error {
	_, err := database.ExecContext(ctx,
		"INSERT OR IGNORE INTO discord_notifications_sent (user_id, deduplication_key, notification_type) VALUES (?, ?, ?)",
		userID, dedupKey, notificationType)
	return err
}

// GetEnabledDiscordWebhooks returns only enabled webhooks for a user.
// NOTE: must select the full webhookCols list - scanWebhook scans all 12.
func GetEnabledDiscordWebhooks(ctx context.Context, database *sql.DB, userID int64) ([]DiscordWebhookRow, error) {
	rows, err := database.QueryContext(ctx,
		"SELECT "+webhookCols+" FROM discord_webhooks WHERE user_id = ? AND enabled = 1 ORDER BY created_at DESC", userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []DiscordWebhookRow
	for rows.Next() {
		w, err := scanWebhook(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, w)
	}
	return result, rows.Err()
}

// GetLatestBatchRunByJobType returns the most recent run for a job type,
// used by the scheduler to seed lastRunTimes on startup.
func GetLatestBatchRunByJobType(ctx context.Context, database *sql.DB, userID int64, jobType string) (*BatchRunRow, error) {
	row := database.QueryRowContext(ctx,
		`SELECT id, user_id, job_type, status, started_at, completed_at, duration_ms,
			containers_checked, containers_updated, error_message, logs, is_manual
		 FROM batch_runs WHERE user_id = ? AND job_type = ? ORDER BY started_at DESC LIMIT 1`,
		userID, jobType)

	var r BatchRunRow
	err := row.Scan(&r.ID, &r.UserID, &r.JobType, &r.Status, &r.StartedAt, &r.CompletedAt,
		&r.DurationMs, &r.ContainersChecked, &r.ContainersUpdated, &r.ErrorMessage, &r.Logs, &r.IsManual)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// GetRunningBatchRun ports the running-job check inside
// checkAndAcquireBatchJobLock: an uncompleted 'running' row.
func GetRunningBatchRun(ctx context.Context, database *sql.DB, userID int64, jobType string) (*BatchRunRow, error) {
	row := database.QueryRowContext(ctx,
		`SELECT id, user_id, job_type, status, started_at, completed_at, duration_ms,
			containers_checked, containers_updated, error_message, logs, is_manual,
			heartbeat_at
		 FROM batch_runs
		 WHERE user_id = ? AND job_type = ? AND status = 'running' AND completed_at IS NULL
		 ORDER BY started_at DESC LIMIT 1`,
		userID, jobType)

	var r BatchRunRow
	err := row.Scan(&r.ID, &r.UserID, &r.JobType, &r.Status, &r.StartedAt, &r.CompletedAt,
		&r.DurationMs, &r.ContainersChecked, &r.ContainersUpdated, &r.ErrorMessage, &r.Logs, &r.IsManual,
		&r.HeartbeatAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// MarkStaleBatchRunsFailed ports cleanupStaleBatchJobs / the stale branch of
// checkAndAcquireBatchJobLock: 'running' rows older than the threshold are
// marked failed. Scoped to one job type so it never touches the other
// stack's in-flight jobs.
func MarkStaleBatchRunsFailed(ctx context.Context, database *sql.DB, jobType string, staleSeconds int) (int, error) {
	res, err := database.ExecContext(ctx,
		`UPDATE batch_runs
		 SET status = 'failed', completed_at = CURRENT_TIMESTAMP,
			 error_message = 'Job marked as failed: stale running job detected'
		 WHERE job_type = ? AND status = 'running' AND completed_at IS NULL
		   AND COALESCE(heartbeat_at, started_at) < datetime('now', ?)`,
		jobType, fmt.Sprintf("-%d seconds", staleSeconds))
	if err != nil {
		return 0, err
	}
	n, err := res.RowsAffected()
	return int(n), err
}
