package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"strings"
)

// Migrate brings the SQLite database to the current schema. It is a faithful
// port of Node's initializeDatabase() ensure block (db/connection.js) plus the
// versioned migration runner (db/migrations/). Both are idempotent: the ensure
// block creates anything missing, and the runner applies only migrations with
// version > MAX(schema_migrations.version).
//
// Unlike Node (which runs each migration as loose serialized statements), Go
// wraps each migration plus its schema_migrations record in one transaction:
// same net effect, but a crash mid-migration cannot leave a half-applied
// version stamped.
func Migrate(ctx context.Context, database *sql.DB) error {
	if err := ensureSchema(ctx, database); err != nil {
		return err
	}
	return runMigrations(ctx, database)
}

// ensureSchema ports the CREATE TABLE IF NOT EXISTS / best-effort ALTER /
// CREATE INDEX IF NOT EXISTS block from Node's initializeDatabase(), keeping
// the original statement order and best-effort semantics.
func ensureSchema(ctx context.Context, database *sql.DB) error {
	hard := func(label, stmt string) error {
		if _, err := database.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("ensure %s: %w", label, err)
		}
		return nil
	}
	// soft runs a statement whose failure Node logs and swallows.
	soft := func(label, stmt string) {
		if _, err := database.ExecContext(ctx, stmt); err != nil {
			slog.Debug("ensure: ignored statement failure", "step", label, "error", err)
		}
	}
	// addColumn ignores only the duplicate-column error.
	addColumn := func(table, column, def string) error {
		if _, err := database.ExecContext(ctx,
			fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", table, column, def)); err != nil &&
			!strings.Contains(err.Error(), "duplicate column name") {
			return fmt.Errorf("ensure %s.%s: %w", table, column, err)
		}
		return nil
	}

	// Orphan repair: FK enforcement is deliberately OFF (see db.go — the
	// migration scar makes enabling it unsafe), so deletes must cascade by
	// hand and the early Go era could accumulate child rows whose parents
	// were deleted. Those rows would now fail UPDATEs and the containers
	// table rebuilds, so clear them before anything else touches the
	// schema. Every statement is soft: on a fresh DB the referenced tables
	// or columns may not exist yet, and on a healthy DB they are no-ops.
	// Order matters: a parent's deletion must run BEFORE its children's
	// orphan sweep, so one pass leaves no newly-orphaned rows behind
	// (intents before intent_executions before intent_execution_containers;
	// tracked_apps before tracked_app_upgrade_history; deployed_images
	// before the containers.deployed_image_id dangling clear).
	for _, repair := range []struct{ label, stmt string }{
		{"containers orphans (v14 shape)", `DELETE FROM containers WHERE
			(runner_id IS NOT NULL AND runner_id NOT IN (SELECT id FROM runners))
			OR (source_instance_id IS NOT NULL AND source_instance_id NOT IN (SELECT id FROM source_instances))
			OR user_id NOT IN (SELECT id FROM users)`},
		{"containers orphans (legacy shape)", `DELETE FROM containers WHERE
			portainer_instance_id NOT IN (SELECT id FROM portainer_instances)
			OR user_id NOT IN (SELECT id FROM users)`},
		{"deployed_images orphans", `DELETE FROM deployed_images WHERE user_id NOT IN (SELECT id FROM users)`},
		{"containers dangling deployed_image_id", `UPDATE containers SET deployed_image_id = NULL
			WHERE deployed_image_id IS NOT NULL
			AND deployed_image_id NOT IN (SELECT id FROM deployed_images)`},
		{"runner_events orphans", `DELETE FROM runner_events WHERE runner_id NOT IN (SELECT id FROM runners)`},
		{"intents orphans", `DELETE FROM intents WHERE user_id NOT IN (SELECT id FROM users)`},
		{"intent_executions orphans", `DELETE FROM intent_executions
			WHERE intent_id NOT IN (SELECT id FROM intents) OR user_id NOT IN (SELECT id FROM users)`},
		{"intent_execution_containers orphans", `DELETE FROM intent_execution_containers
			WHERE execution_id NOT IN (SELECT id FROM intent_executions)`},
		{"upgrade_history dangling runner", `UPDATE upgrade_history SET runner_id = NULL
			WHERE runner_id IS NOT NULL AND runner_id NOT IN (SELECT id FROM runners)`},
		{"upgrade_history dangling instance", `UPDATE upgrade_history SET portainer_instance_id = NULL
			WHERE portainer_instance_id IS NOT NULL
			AND portainer_instance_id NOT IN (SELECT id FROM portainer_instances)`},
		{"upgrade_history orphans", `DELETE FROM upgrade_history WHERE user_id NOT IN (SELECT id FROM users)`},
		{"tracked_apps orphans", `DELETE FROM tracked_apps WHERE user_id NOT IN (SELECT id FROM users)`},
		{"tracked_app_upgrade_history dangling app", `UPDATE tracked_app_upgrade_history SET tracked_app_id = NULL
			WHERE tracked_app_id IS NOT NULL AND tracked_app_id NOT IN (SELECT id FROM tracked_apps)`},
		{"tracked_app_upgrade_history orphans", `DELETE FROM tracked_app_upgrade_history
			WHERE user_id NOT IN (SELECT id FROM users)`},
		{"registry_image_versions orphans", `DELETE FROM registry_image_versions WHERE user_id NOT IN (SELECT id FROM users)`},
	} {
		soft(repair.label, repair.stmt)
	}

	if err := hard("users", `CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT,
            email TEXT,
            role TEXT DEFAULT 'Administrator',
            password_changed INTEGER DEFAULT 0,
            instance_admin INTEGER DEFAULT 0,
            verification_token TEXT,
            last_login DATETIME,
            token_version INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )`); err != nil {
		return err
	}
	// Session eviction on password change: tokens carry a tokenVersion
	// claim that must match this column (bumped by UpdateUserPassword).
	if err := addColumn("users", "token_version", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	soft("idx_users_username", "CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)")

	if err := hard("portainer_instances", `CREATE TABLE IF NOT EXISTS portainer_instances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
            url TEXT NOT NULL,
            username TEXT,
            password TEXT,
            api_key TEXT,
            auth_type TEXT DEFAULT 'password',
            ip_address TEXT,
        display_order INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, url)
      )`); err != nil {
		return err
	}
	soft("idx_portainer_user_id", "CREATE INDEX IF NOT EXISTS idx_portainer_user_id ON portainer_instances(user_id)")
	soft("idx_portainer_url", "CREATE INDEX IF NOT EXISTS idx_portainer_url ON portainer_instances(url)")
	soft("idx_portainer_display_order", "CREATE INDEX IF NOT EXISTS idx_portainer_display_order ON portainer_instances(display_order)")

	if err := hard("docker_hub_credentials", `CREATE TABLE IF NOT EXISTS docker_hub_credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        username TEXT,
        token TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id)
      )`); err != nil {
		return err
	}

	if err := hard("repository_access_tokens", `CREATE TABLE IF NOT EXISTS repository_access_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        provider TEXT NOT NULL CHECK(provider IN ('github', 'gitlab')),
        name TEXT NOT NULL,
        access_token TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, provider, name),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`); err != nil {
		return err
	}
	// Pre-name column databases: add the column, then backfill display names.
	if err := addColumn("repository_access_tokens", "name", "TEXT"); err != nil {
		return err
	}
	soft("repository_access_tokens name backfill",
		"UPDATE repository_access_tokens SET name = provider || ' Token' WHERE name IS NULL OR name = ''")
	soft("idx_repo_tokens_user_id", "CREATE INDEX IF NOT EXISTS idx_repo_tokens_user_id ON repository_access_tokens(user_id)")
	soft("idx_repo_tokens_provider", "CREATE INDEX IF NOT EXISTS idx_repo_tokens_provider ON repository_access_tokens(provider)")

	if err := hard("tracked_apps", `CREATE TABLE IF NOT EXISTS tracked_apps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        image_name TEXT,
        github_repo TEXT,
            source_type TEXT DEFAULT 'docker',
            gitlab_token TEXT,
        current_version TEXT,
        current_digest TEXT,
        latest_version TEXT,
        latest_digest TEXT,
        has_update INTEGER DEFAULT 0,
        current_version_publish_date TEXT,
            latest_version_publish_date TEXT,
        last_checked DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, image_name, github_repo)
      )`); err != nil {
		return err
	}
	if err := addColumn("tracked_apps", "repository_token_id", "INTEGER"); err != nil {
		return err
	}
	if err := addColumn("tracked_apps", "source_type", "TEXT DEFAULT 'docker'"); err != nil {
		return err
	}
	soft("idx_tracked_apps_user_id", "CREATE INDEX IF NOT EXISTS idx_tracked_apps_user_id ON tracked_apps(user_id)")
	soft("idx_tracked_apps_name", "CREATE INDEX IF NOT EXISTS idx_tracked_apps_name ON tracked_apps(name)")
	soft("idx_tracked_apps_image_name", "CREATE INDEX IF NOT EXISTS idx_tracked_apps_image_name ON tracked_apps(image_name)")
	soft("idx_tracked_apps_github_repo", "CREATE INDEX IF NOT EXISTS idx_tracked_apps_github_repo ON tracked_apps(github_repo)")

	if err := hard("deployed_images", `CREATE TABLE IF NOT EXISTS deployed_images (
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
        UNIQUE(user_id, image_repo, image_tag, image_digest),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`); err != nil {
		return err
	}
	if err := addColumn("deployed_images", "repo_digests", "TEXT"); err != nil {
		return err
	}
	soft("idx_deployed_images_user_id", "CREATE INDEX IF NOT EXISTS idx_deployed_images_user_id ON deployed_images(user_id)")
	soft("idx_deployed_images_image_repo", "CREATE INDEX IF NOT EXISTS idx_deployed_images_image_repo ON deployed_images(image_repo)")
	soft("idx_deployed_images_last_seen", "CREATE INDEX IF NOT EXISTS idx_deployed_images_last_seen ON deployed_images(last_seen)")
	if err := addColumn("deployed_images", "repository_token_id", "INTEGER"); err != nil {
		return err
	}
	soft("idx_deployed_images_repository_token_id", "CREATE INDEX IF NOT EXISTS idx_deployed_images_repository_token_id ON deployed_images(repository_token_id)")

	if err := hard("registry_image_versions", `CREATE TABLE IF NOT EXISTS registry_image_versions (
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
        UNIQUE(user_id, image_repo, tag),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`); err != nil {
		return err
	}
	if err := addColumn("registry_image_versions", "provider", "TEXT"); err != nil {
		return err
	}
	soft("idx_registry_image_versions_user_id", "CREATE INDEX IF NOT EXISTS idx_registry_image_versions_user_id ON registry_image_versions(user_id)")
	soft("idx_registry_image_versions_image_repo", "CREATE INDEX IF NOT EXISTS idx_registry_image_versions_image_repo ON registry_image_versions(image_repo)")
	soft("idx_registry_image_versions_last_checked", "CREATE INDEX IF NOT EXISTS idx_registry_image_versions_last_checked ON registry_image_versions(last_checked)")

	if err := hard("containers", `CREATE TABLE IF NOT EXISTS containers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        portainer_instance_id INTEGER NOT NULL,
        container_id TEXT NOT NULL,
        container_name TEXT NOT NULL,
        endpoint_id TEXT NOT NULL,
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
        UNIQUE(user_id, container_id, portainer_instance_id, endpoint_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (portainer_instance_id) REFERENCES portainer_instances(id) ON DELETE CASCADE,
        FOREIGN KEY (deployed_image_id) REFERENCES deployed_images(id) ON DELETE SET NULL
      )`); err != nil {
		return err
	}
	soft("idx_containers_user_id", "CREATE INDEX IF NOT EXISTS idx_containers_user_id ON containers(user_id)")
	// On a fresh database the containers table still uses portainer_instance_id
	// here; migration 0013 renames the column and creates this index. Node
	// swallows the "no such column" error the same way.
	soft("idx_containers_instance", "CREATE INDEX IF NOT EXISTS idx_containers_instance ON containers(source_instance_id)")
	soft("idx_containers_deployed_image", "CREATE INDEX IF NOT EXISTS idx_containers_deployed_image ON containers(deployed_image_id)")
	soft("idx_containers_image_repo", "CREATE INDEX IF NOT EXISTS idx_containers_image_repo ON containers(image_repo)")
	soft("idx_containers_last_seen", "CREATE INDEX IF NOT EXISTS idx_containers_last_seen ON containers(last_seen)")

	if err := hard("batch_config", `CREATE TABLE IF NOT EXISTS batch_config (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        job_type TEXT NOT NULL,
        enabled INTEGER DEFAULT 0,
        interval_minutes INTEGER DEFAULT 60,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, job_type)
      )`); err != nil {
		return err
	}

	if err := hard("settings", `CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            key TEXT NOT NULL,
        value TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, key)
      )`); err != nil {
		return err
	}
	soft("idx_settings_user_id", "CREATE INDEX IF NOT EXISTS idx_settings_user_id ON settings(user_id)")
	soft("idx_settings_key", "CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key)")

	if err := hard("discord_webhooks", `CREATE TABLE IF NOT EXISTS discord_webhooks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        webhook_url TEXT NOT NULL,
        server_name TEXT,
        channel_name TEXT,
        name TEXT,
        avatar_url TEXT,
        guild_id TEXT,
        channel_id TEXT,
        enabled INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`); err != nil {
		return err
	}
	soft("idx_discord_webhooks_user_id", "CREATE INDEX IF NOT EXISTS idx_discord_webhooks_user_id ON discord_webhooks(user_id)")
	soft("idx_discord_webhooks_enabled", "CREATE INDEX IF NOT EXISTS idx_discord_webhooks_enabled ON discord_webhooks(enabled)")

	if err := hard("batch_runs", `CREATE TABLE IF NOT EXISTS batch_runs (
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
        logs TEXT
      )`); err != nil {
		return err
	}
	// Lease heartbeat: a live long-running job refreshes heartbeat_at, so
	// the stale-run reaper never marks a healthy run (in this or another
	// process) failed just because it started long ago.
	if err := addColumn("batch_runs", "heartbeat_at", "DATETIME"); err != nil {
		return err
	}
	soft("idx_batch_runs_started_at", "CREATE INDEX IF NOT EXISTS idx_batch_runs_started_at ON batch_runs(started_at DESC)")
	soft("idx_batch_runs_status", "CREATE INDEX IF NOT EXISTS idx_batch_runs_status ON batch_runs(status)")

	if err := hard("discord_notifications_sent", `CREATE TABLE IF NOT EXISTS discord_notifications_sent (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        deduplication_key TEXT NOT NULL,
        notification_type TEXT NOT NULL,
        sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, deduplication_key),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`); err != nil {
		return err
	}
	soft("idx_discord_notifications_user_key", "CREATE INDEX IF NOT EXISTS idx_discord_notifications_user_key ON discord_notifications_sent(user_id, deduplication_key)")
	soft("idx_discord_notifications_sent_at", "CREATE INDEX IF NOT EXISTS idx_discord_notifications_sent_at ON discord_notifications_sent(sent_at DESC)")

	if err := hard("upgrade_history", `CREATE TABLE IF NOT EXISTS upgrade_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        portainer_instance_id INTEGER,
        portainer_instance_name TEXT,
        container_id TEXT NOT NULL,
        container_name TEXT NOT NULL,
        endpoint_id TEXT,
        portainer_url TEXT,
        old_image TEXT NOT NULL,
        new_image TEXT NOT NULL,
        old_digest TEXT,
        new_digest TEXT,
        old_version TEXT,
        new_version TEXT,
        image_repo TEXT,
        registry TEXT,
        namespace TEXT,
        repository TEXT,
        status TEXT DEFAULT 'success',
        error_message TEXT,
        upgrade_duration_ms INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (portainer_instance_id) REFERENCES portainer_instances(id) ON DELETE SET NULL
      )`); err != nil {
		return err
	}
	soft("idx_upgrade_history_user_id", "CREATE INDEX IF NOT EXISTS idx_upgrade_history_user_id ON upgrade_history(user_id)")
	soft("idx_upgrade_history_created_at", "CREATE INDEX IF NOT EXISTS idx_upgrade_history_created_at ON upgrade_history(created_at DESC)")
	soft("idx_upgrade_history_container_name", "CREATE INDEX IF NOT EXISTS idx_upgrade_history_container_name ON upgrade_history(container_name)")

	if err := hard("tracked_app_upgrade_history", `CREATE TABLE IF NOT EXISTS tracked_app_upgrade_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        tracked_app_id INTEGER,
        app_name TEXT NOT NULL,
        provider TEXT NOT NULL CHECK(provider IN ('github', 'gitlab', 'docker')),
        repository TEXT NOT NULL,
        old_version TEXT NOT NULL,
        new_version TEXT NOT NULL,
        old_tag TEXT,
        new_tag TEXT,
        old_commit_sha TEXT,
        new_commit_sha TEXT,
        release_notes TEXT,
        status TEXT DEFAULT 'success',
        error_message TEXT,
        upgrade_duration_ms INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (tracked_app_id) REFERENCES tracked_apps(id) ON DELETE SET NULL
      )`); err != nil {
		return err
	}
	if err := rebuildTrackedAppUpgradeHistoryIfOldCheck(ctx, database); err != nil {
		return err
	}
	soft("idx_tracked_app_upgrade_history_user_id", "CREATE INDEX IF NOT EXISTS idx_tracked_app_upgrade_history_user_id ON tracked_app_upgrade_history(user_id)")
	soft("idx_tracked_app_upgrade_history_tracked_app_id", "CREATE INDEX IF NOT EXISTS idx_tracked_app_upgrade_history_tracked_app_id ON tracked_app_upgrade_history(tracked_app_id)")
	soft("idx_tracked_app_upgrade_history_created_at", "CREATE INDEX IF NOT EXISTS idx_tracked_app_upgrade_history_created_at ON tracked_app_upgrade_history(created_at DESC)")
	soft("idx_tracked_app_upgrade_history_app_name", "CREATE INDEX IF NOT EXISTS idx_tracked_app_upgrade_history_app_name ON tracked_app_upgrade_history(app_name)")

	if err := hard("pending_auth_tokens", `CREATE TABLE IF NOT EXISTS pending_auth_tokens (
        kind TEXT NOT NULL,
        username TEXT NOT NULL DEFAULT '',
        token TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (kind, username)
      )`); err != nil {
		return err
	}
	if err := hard("revoked_tokens", `CREATE TABLE IF NOT EXISTS revoked_tokens (
        token_hash TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        revoked_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`); err != nil {
		return err
	}
	soft("idx_revoked_tokens_expires", "CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires ON revoked_tokens(expires_at)")

	return nil
}

// rebuildTrackedAppUpgradeHistoryIfOldCheck ports the conditional rebuild from
// the ensure block: databases whose tracked_app_upgrade_history still carries
// the pre-'docker' CHECK constraint are recreated in a transaction.
func rebuildTrackedAppUpgradeHistoryIfOldCheck(ctx context.Context, database *sql.DB) error {
	var tableSQL string
	err := database.QueryRowContext(ctx,
		"SELECT sql FROM sqlite_master WHERE type='table' AND name='tracked_app_upgrade_history'").Scan(&tableSQL)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read tracked_app_upgrade_history schema: %w", err)
	}
	if !strings.Contains(tableSQL, "CHECK(provider IN ('github', 'gitlab'))") &&
		!strings.Contains(tableSQL, "CHECK (provider IN ('github', 'gitlab'))") {
		return nil
	}
	slog.Info("migrate: rebuilding tracked_app_upgrade_history to add 'docker' provider support")
	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck // best-effort after commit
	for _, stmt := range []string{
		`CREATE TABLE tracked_app_upgrade_history_new (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id INTEGER NOT NULL,
                        tracked_app_id INTEGER,
                        app_name TEXT NOT NULL,
                        provider TEXT NOT NULL CHECK(provider IN ('github', 'gitlab', 'docker')),
                        repository TEXT NOT NULL,
                        old_version TEXT NOT NULL,
                        new_version TEXT NOT NULL,
                        old_tag TEXT,
                        new_tag TEXT,
                        old_commit_sha TEXT,
                        new_commit_sha TEXT,
                        release_notes TEXT,
                        status TEXT DEFAULT 'success',
                        error_message TEXT,
                        upgrade_duration_ms INTEGER,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                        FOREIGN KEY (tracked_app_id) REFERENCES tracked_apps(id) ON DELETE SET NULL
                      )`,
		`INSERT INTO tracked_app_upgrade_history_new SELECT * FROM tracked_app_upgrade_history`,
		`DROP TABLE tracked_app_upgrade_history`,
		`ALTER TABLE tracked_app_upgrade_history_new RENAME TO tracked_app_upgrade_history`,
	} {
		if _, err := tx.ExecContext(ctx, stmt); err != nil {
			return fmt.Errorf("tracked_app_upgrade_history rebuild: %w", err)
		}
	}
	return tx.Commit()
}

// migration mirrors one Node migration file (db/migrations/00XX_*.js).
type migration struct {
	version int
	name    string
	up      func(ctx context.Context, tx *sql.Tx) error
}

// migrations lists every migration in version order, with the exact names
// Node stamps into schema_migrations.
var migrations = []migration{
	{1, "Initial schema baseline", migrateBaseline},
	{2, "Add intents tables", migrateIntentsTables},
	{3, "Add OAuth support", migrateOAuthSupport},
	{4, "Add OAuth providers table", migrateOAuthProvidersTable},
	{5, "Make password_hash nullable for OAuth users", migratePasswordHashNullable},
	{6, "Add exclusion criteria to intents", migrateExclusionCriteria},
	{7, "Add runners table", migrateRunnersTable},
	{8, "Add runner enrollment tokens table", migrateEnrollmentTokensTable},
	{9, "Add runner version tracking columns", migrateRunnerVersionColumns},
	{10, "Runner container support", migrateRunnerContainerSupport},
	{11, "Fix upgrade_history endpoint_id nullable", migrateUpgradeHistoryEndpointNullable},
	{12, "Add runner docker_enabled column", migrateRunnerDockerEnabled},
	{13, "Rename portainer to sources", migrateRenamePortainerToSources},
	{14, "Restore containers UNIQUE constraint and deduplicate rows", migrateRestoreContainersUnique},
	{15, "Add runner health tracking", migrateRunnerHealthTracking},
}

// runMigrations ports db/migrations/index.js: create the tracking table,
// compute MAX(version) as the current version, and apply every pending
// migration in order. A failing migration aborts startup, same as Node.
func runMigrations(ctx context.Context, database *sql.DB) error {
	if _, err := database.ExecContext(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            version INTEGER NOT NULL UNIQUE,
            name TEXT NOT NULL,
            applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
          )`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}
	var current int
	if err := database.QueryRowContext(ctx,
		"SELECT COALESCE(MAX(version), 0) FROM schema_migrations").Scan(&current); err != nil {
		return fmt.Errorf("read schema version: %w", err)
	}
	slog.Info("migrate: current database schema version", "version", current)

	pending := 0
	for _, m := range migrations {
		if m.version <= current {
			continue
		}
		pending++
		slog.Info("migrate: running migration", "version", m.version, "name", m.name)
		tx, err := database.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		if err := m.up(ctx, tx); err != nil {
			tx.Rollback() //nolint:errcheck
			return fmt.Errorf("migration %d (%s) failed: %w", m.version, m.name, err)
		}
		if _, err := tx.ExecContext(ctx,
			"INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
			m.version, m.name); err != nil {
			tx.Rollback() //nolint:errcheck
			return fmt.Errorf("record migration %d: %w", m.version, err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit migration %d: %w", m.version, err)
		}
	}
	if pending == 0 {
		slog.Info("migrate: no pending migrations")
		return nil
	}
	var newVersion int
	if err := database.QueryRowContext(ctx,
		"SELECT COALESCE(MAX(version), 0) FROM schema_migrations").Scan(&newVersion); err != nil {
		return fmt.Errorf("read schema version: %w", err)
	}
	slog.Info("migrate: database schema updated", "version", newVersion)
	return nil
}

// ── migration helpers (port of db/migrations/helpers.js) ───────────────────

func txTableExists(ctx context.Context, tx *sql.Tx, table string) (bool, error) {
	var name string
	err := tx.QueryRowContext(ctx,
		"SELECT name FROM sqlite_master WHERE type='table' AND name=?", table).Scan(&name)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func txColumnExists(ctx context.Context, tx *sql.Tx, table, column string) (bool, error) {
	var name string
	err := tx.QueryRowContext(ctx,
		"SELECT name FROM pragma_table_info(?) WHERE name = ?", table, column).Scan(&name)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// txAddColumn mirrors addColumnIfNotExists; def may include a DEFAULT clause.
func txAddColumn(ctx context.Context, tx *sql.Tx, table, column, def string) error {
	exists, err := txColumnExists(ctx, tx, table, column)
	if err != nil {
		return err
	}
	if exists {
		return nil
	}
	_, err = tx.ExecContext(ctx, fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", table, column, def))
	return err
}

// txCreateIndex mirrors createIndexIfNotExists.
func txCreateIndex(ctx context.Context, tx *sql.Tx, name, table, columns string, unique bool) error {
	uniq := ""
	if unique {
		uniq = "UNIQUE "
	}
	_, err := tx.ExecContext(ctx,
		fmt.Sprintf("CREATE %sINDEX IF NOT EXISTS %s ON %s(%s)", uniq, name, table, columns))
	return err
}
