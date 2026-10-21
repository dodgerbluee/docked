package db

import (
	"context"
	"database/sql"
	"encoding/json"
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
}

// VersionData carries the registry version fields (ports the versionData
// argument; only supplied when hasUpdate is true).
type VersionData struct {
	CurrentTag    string
	LatestTag     string
	LatestVersion *string
	LatestDigest  *string
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

	deployedImageID, err := upsertDeployedImageTx(ctx, conn, userID, data.ImageRepo, imageTag,
		data.CurrentDigest, data.Registry, data.Namespace, data.Repository, data.RepoDigests)
	if err != nil {
		return 0, err
	}

	res, err := conn.ExecContext(ctx,
		`UPDATE containers SET
			container_name = ?, image_name = ?, image_repo = ?, status = ?, state = ?,
			stack_name = ?, deployed_image_id = ?, uses_network_mode = ?, provides_network = ?,
			last_seen = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
		 WHERE user_id = ? AND container_id = ? AND runner_id = ?`,
		data.ContainerName, data.ImageName, data.ImageRepo, data.Status, data.State,
		data.StackName, deployedImageID, 0, 0,
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
			 VALUES (?, NULL, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
			userID, runnerID, data.ContainerID, data.ContainerName,
			data.ImageName, data.ImageRepo, data.Status, data.State, data.StackName, deployedImageID)
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
		if _, err := conn.ExecContext(ctx,
			`INSERT OR REPLACE INTO registry_image_versions
				(user_id, image_repo, registry, provider, namespace, repository, tag,
				 latest_digest, latest_version, latest_publish_date, exists_in_registry,
				 last_checked, updated_at)
			 VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
			userID, data.ImageRepo, vRegistry, data.Namespace, vRepository,
			version.CurrentTag, version.LatestDigest, version.LatestVersion); err != nil {
			return 0, err
		}
	}

	if _, err := conn.ExecContext(ctx, "COMMIT"); err != nil {
		return 0, err
	}
	committed = true
	return containerRecordID, nil
}

// upsertDeployedImageTx ports deployedImages.js upsertDeployedImage.
// Deviation from Node: when imageDigest is NULL we match with
// "image_digest IS NULL" and reuse the row. Node's "= ?" with a null
// parameter never matches (SQLite UNIQUE treats NULLs as distinct), which
// created a new deployed_images row on every scan.
func upsertDeployedImageTx(ctx context.Context, conn *sql.Conn, userID int64, imageRepo, imageTag string,
	imageDigest *string, registry, namespace, repository string, repoDigests []string) (int64, error) {

	var repoDigestsJSON any
	if len(repoDigests) > 0 {
		b, err := json.Marshal(repoDigests)
		if err != nil {
			return 0, err
		}
		repoDigestsJSON = string(b)
	}

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
		if repoDigestsJSON != nil {
			_, err = conn.ExecContext(ctx,
				`UPDATE deployed_images
				 SET last_seen = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, repo_digests = ?
				 WHERE id = ?`, repoDigestsJSON, id)
		} else {
			_, err = conn.ExecContext(ctx,
				`UPDATE deployed_images
				 SET last_seen = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
				 WHERE id = ?`, id)
		}
		if err != nil {
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
		userID, imageRepo, imageTag, imageDigest, registry, namespace, vRepository, repoDigestsJSON)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
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
			containers_checked, containers_updated, error_message, logs, is_manual
		 FROM batch_runs
		 WHERE user_id = ? AND job_type = ? AND status = 'running' AND completed_at IS NULL
		 ORDER BY started_at DESC LIMIT 1`,
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
		   AND started_at < datetime('now', ?)`,
		jobType, fmt.Sprintf("-%d seconds", staleSeconds))
	if err != nil {
		return 0, err
	}
	n, err := res.RowsAffected()
	return int(n), err
}
