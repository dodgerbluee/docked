package db

import (
	"context"
	"database/sql"
	"path/filepath"
	"strings"
	"testing"
)

func strPtr(s string) *string { return &s }

func newSyncTestDB(t *testing.T) *sql.DB {
	t.Helper()
	database, err := Open(filepath.Join(t.TempDir(), "sync-test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	stmts := []string{
		`CREATE TABLE deployed_images (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			image_repo TEXT NOT NULL,
			image_tag TEXT NOT NULL,
			image_digest TEXT,
			image_created_date TEXT,
			registry TEXT,
			namespace TEXT,
			repository TEXT,
			first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
			last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			repo_digests TEXT,
			UNIQUE(user_id, image_repo, image_tag, image_digest)
		)`,
		`CREATE TABLE containers (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			source_instance_id INTEGER,
			runner_id INTEGER,
			container_id TEXT NOT NULL,
			container_name TEXT NOT NULL,
			endpoint_id INTEGER,
			image_name TEXT NOT NULL,
			image_repo TEXT NOT NULL,
			status TEXT,
			state TEXT,
			stack_name TEXT,
			deployed_image_id INTEGER,
			uses_network_mode INTEGER DEFAULT 0,
			provides_network INTEGER DEFAULT 0,
			last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(user_id, container_id, runner_id)
		)`,
		`CREATE TABLE registry_image_versions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			image_repo TEXT NOT NULL,
			registry TEXT NOT NULL,
			provider TEXT,
			namespace TEXT,
			repository TEXT NOT NULL,
			tag TEXT,
			latest_digest TEXT,
			latest_version TEXT,
			latest_publish_date TEXT,
			exists_in_registry INTEGER DEFAULT 0,
			last_checked DATETIME DEFAULT CURRENT_TIMESTAMP,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(user_id, image_repo, tag)
		)`,
		`CREATE TABLE discord_notifications_sent (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			deduplication_key TEXT NOT NULL,
			notification_type TEXT NOT NULL,
			sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(user_id, deduplication_key)
		)`,
		`CREATE TABLE batch_runs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			job_type TEXT DEFAULT 'docker-hub-pull',
			status TEXT NOT NULL,
			is_manual INTEGER DEFAULT 0,
			started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			completed_at DATETIME,
			duration_ms INTEGER,
			containers_checked INTEGER DEFAULT 0,
			containers_updated INTEGER DEFAULT 0,
			error_message TEXT,
			logs TEXT,
			heartbeat_at DATETIME
		)`,
	}
	for _, s := range stmts {
		if _, err := database.Exec(s); err != nil {
			t.Fatalf("create schema: %v", err)
		}
	}
	return database
}

func TestUpsertContainerWithVersion(t *testing.T) {
	database := newSyncTestDB(t)
	ctx := context.Background()

	data := &ContainerVersionUpsert{
		ContainerID:   "abc123def",
		ContainerName: "nginx",
		ImageName:     "nginx:1.25",
		ImageRepo:     "nginx",
		ImageTag:      "1.25",
		Status:        strPtr("running"),
		State:         strPtr("running"),
		CurrentDigest: strPtr("sha256:aaa"),
		Registry:      "docker.io",
		Repository:    "nginx",
		RepoDigests:   []string{"sha256:aaa"},
	}
	version := &VersionData{
		CurrentTag:   "1.25",
		LatestTag:    "1.26",
		LatestDigest: strPtr("sha256:bbb"),
	}

	id1, err := UpsertContainerWithVersion(ctx, database, 1, data, version, 7)
	if err != nil {
		t.Fatalf("first upsert: %v", err)
	}
	if id1 == 0 {
		t.Fatal("expected container record id")
	}

	// Second pass with an updated image: same container row must be reused.
	data.CurrentDigest = strPtr("sha256:bbb")
	data.RepoDigests = []string{"sha256:bbb"}
	id2, err := UpsertContainerWithVersion(ctx, database, 1, data, version, 7)
	if err != nil {
		t.Fatalf("second upsert: %v", err)
	}
	if id2 != id1 {
		t.Errorf("container id changed: %d -> %d", id1, id2)
	}

	var deployedCount, deployedRows int
	if err := database.QueryRow(`SELECT COUNT(*) FROM containers`).Scan(&deployedCount); err != nil {
		t.Fatal(err)
	}
	if deployedCount != 1 {
		t.Errorf("containers rows = %d, want 1", deployedCount)
	}
	if err := database.QueryRow(`SELECT COUNT(*) FROM deployed_images`).Scan(&deployedRows); err != nil {
		t.Fatal(err)
	}
	if deployedRows != 2 {
		t.Errorf("deployed_images rows = %d, want 2 (digest changed)", deployedRows)
	}

	// registry_image_versions upserted keyed (user, repo, tag=currentTag).
	var versions int
	var latestDigest string
	if err := database.QueryRow(`SELECT COUNT(*), MAX(latest_digest) FROM registry_image_versions
		WHERE user_id = 1 AND image_repo = 'nginx' AND tag = '1.25'`).Scan(&versions, &latestDigest); err != nil {
		t.Fatal(err)
	}
	if versions != 1 {
		t.Errorf("registry_image_versions rows = %d, want 1", versions)
	}
	if latestDigest != "sha256:bbb" {
		t.Errorf("latest_digest = %q, want sha256:bbb", latestDigest)
	}
}

func TestUpsertDeployedImageNullDigestReuse(t *testing.T) {
	database := newSyncTestDB(t)
	ctx := context.Background()

	// Node's "= ?" with a null digest never matches, creating a new row per
	// scan; the Go port matches with IS NULL and reuses the row.
	data := &ContainerVersionUpsert{
		ContainerID:   "c1",
		ContainerName: "local",
		ImageName:     "myapp",
		ImageRepo:     "myapp",
		ImageTag:      "latest",
		CurrentDigest: nil,
		Registry:      "docker.io",
		Repository:    "myapp",
	}
	for i := 0; i < 3; i++ {
		if _, err := UpsertContainerWithVersion(ctx, database, 1, data, nil, 7); err != nil {
			t.Fatalf("upsert %d: %v", i, err)
		}
	}

	var rows int
	if err := database.QueryRow(`SELECT COUNT(*) FROM deployed_images WHERE image_digest IS NULL`).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 1 {
		t.Errorf("deployed_images rows = %d, want 1 (NULL-digest reuse)", rows)
	}

	// No version data supplied -> no registry_image_versions rows.
	var versions int
	if err := database.QueryRow(`SELECT COUNT(*) FROM registry_image_versions`).Scan(&versions); err != nil {
		t.Fatal(err)
	}
	if versions != 0 {
		t.Errorf("registry_image_versions rows = %d, want 0", versions)
	}
}

func TestDiscordDedup(t *testing.T) {
	database := newSyncTestDB(t)
	ctx := context.Background()

	sent, err := HasDiscordNotificationBeenSent(ctx, database, 1, "1:nginx:nginx:abc")
	if err != nil {
		t.Fatal(err)
	}
	if sent {
		t.Fatal("expected not sent initially")
	}
	if err := RecordDiscordNotificationSent(ctx, database, 1, "1:nginx:nginx:abc", "portainer-container"); err != nil {
		t.Fatal(err)
	}
	// INSERT OR IGNORE: duplicate record must not error.
	if err := RecordDiscordNotificationSent(ctx, database, 1, "1:nginx:nginx:abc", "portainer-container"); err != nil {
		t.Fatalf("duplicate record: %v", err)
	}
	sent, err = HasDiscordNotificationBeenSent(ctx, database, 1, "1:nginx:nginx:abc")
	if err != nil {
		t.Fatal(err)
	}
	if !sent {
		t.Fatal("expected sent after record")
	}
	// Different user: independent namespace.
	sent, err = HasDiscordNotificationBeenSent(ctx, database, 2, "1:nginx:nginx:abc")
	if err != nil {
		t.Fatal(err)
	}
	if sent {
		t.Fatal("dedup must be per-user")
	}
}

func TestBatchRunLockHelpers(t *testing.T) {
	database := newSyncTestDB(t)
	ctx := context.Background()

	runID, err := CreateBatchRun(ctx, database, 1, "docker-hub-pull", false)
	if err != nil {
		t.Fatal(err)
	}

	running, err := GetRunningBatchRun(ctx, database, 1, "docker-hub-pull")
	if err != nil {
		t.Fatal(err)
	}
	if running == nil || running.ID != runID {
		t.Fatalf("expected running run %d, got %+v", runID, running)
	}

	// Fresh run is not stale.
	n, err := MarkStaleBatchRunsFailed(ctx, database, "docker-hub-pull", 300)
	if err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("fresh run marked stale: %d", n)
	}

	// Age it past the threshold and retry.
	if _, err := database.Exec(`UPDATE batch_runs SET started_at = datetime('now', '-10 minutes') WHERE id = ?`, runID); err != nil {
		t.Fatal(err)
	}
	n, err = MarkStaleBatchRunsFailed(ctx, database, "docker-hub-pull", 300)
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Errorf("stale runs marked = %d, want 1", n)
	}

	running, err = GetRunningBatchRun(ctx, database, 1, "docker-hub-pull")
	if err != nil {
		t.Fatal(err)
	}
	if running != nil {
		t.Errorf("expected no running run after stale cleanup, got %+v", running)
	}

	// Complete a run and seed lastRunTimes from it.
	id2, err := CreateBatchRun(ctx, database, 1, "docker-hub-pull", true)
	if err != nil {
		t.Fatal(err)
	}
	if err := CompleteBatchRun(ctx, database, id2, "completed", 10, 2, nil); err != nil {
		t.Fatal(err)
	}
	latest, err := GetLatestBatchRunByJobType(ctx, database, 1, "docker-hub-pull")
	if err != nil {
		t.Fatal(err)
	}
	if latest == nil || latest.ID != id2 || latest.Status != "completed" || !latest.CompletedAt.Valid {
		t.Fatalf("unexpected latest run: %+v", latest)
	}
}

// The stale-run reap must re-check lease staleness INSIDE the UPDATE: a
// heartbeat landing at the last moment protects the run instead of a
// read-check-write race marking a healthy run failed.
func TestReapStaleBatchRunIsConditional(t *testing.T) {
	database := newMigratedTestDB(t)
	ctx := context.Background()
	id, err := CreateBatchRun(ctx, database, 1, "docker-hub-pull", false)
	if err != nil {
		t.Fatal(err)
	}

	// Old start but a fresh heartbeat: the lease is alive, do not reap.
	if _, err := database.ExecContext(ctx,
		`UPDATE batch_runs SET started_at = datetime('now','-30 minutes'),
		 heartbeat_at = datetime('now','-10 seconds') WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	reaped, err := ReapStaleBatchRun(ctx, database, id, 300)
	if err != nil {
		t.Fatal(err)
	}
	if reaped {
		t.Fatal("run with a fresh heartbeat must not be reaped")
	}
	var status string
	if err := database.QueryRowContext(ctx, `SELECT status FROM batch_runs WHERE id = ?`, id).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "running" {
		t.Fatalf("status = %q, want running", status)
	}

	// Heartbeat goes silent past the threshold: the reap wins.
	if _, err := database.ExecContext(ctx,
		`UPDATE batch_runs SET heartbeat_at = datetime('now','-10 minutes') WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	if reaped, err := ReapStaleBatchRun(ctx, database, id, 300); err != nil || !reaped {
		t.Fatalf("stale run reap = (%v, %v), want true", reaped, err)
	}
	var errMsg sql.NullString
	if err := database.QueryRowContext(ctx,
		`SELECT status, error_message FROM batch_runs WHERE id = ?`, id).Scan(&status, &errMsg); err != nil {
		t.Fatal(err)
	}
	if status != "failed" || !strings.Contains(errMsg.String, "stale running job detected") {
		t.Errorf("reaped run: status=%q error=%v", status, errMsg)
	}

	// Re-reaping a finalized row is a no-op (completion is monotonic).
	if reaped, err := ReapStaleBatchRun(ctx, database, id, 300); err != nil || reaped {
		t.Fatalf("re-reap of finalized run = (%v, %v), want false", reaped, err)
	}
}
