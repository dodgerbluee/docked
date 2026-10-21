package db

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
)

func testDB(t *testing.T) *sql.DB {
	t.Helper()
	dsn := "file:" + filepath.Join(t.TempDir(), "users.db") +
		"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)"
	database, err := sql.Open("sqlite", dsn)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return database
}

func migrate(t *testing.T, database *sql.DB) {
	t.Helper()
	if err := Migrate(context.Background(), database); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
}

func tableExists(t *testing.T, database *sql.DB, table string) bool {
	t.Helper()
	var name string
	err := database.QueryRow("SELECT name FROM sqlite_master WHERE type='table' AND name=?", table).Scan(&name)
	return err == nil
}

func indexExists(t *testing.T, database *sql.DB, index string) bool {
	t.Helper()
	var name string
	err := database.QueryRow("SELECT name FROM sqlite_master WHERE type='index' AND name=?", index).Scan(&name)
	return err == nil
}

func columnInfo(t *testing.T, database *sql.DB, table, column string) (typ string, notNull int) {
	t.Helper()
	err := database.QueryRow(
		"SELECT type, \"notnull\" FROM pragma_table_info(?) WHERE name = ?", table, column).Scan(&typ, &notNull)
	if err != nil {
		t.Fatalf("column %s.%s: %v", table, column, err)
	}
	return typ, notNull
}

func schemaVersion(t *testing.T, database *sql.DB) int {
	t.Helper()
	var v int
	if err := database.QueryRow("SELECT COALESCE(MAX(version), 0) FROM schema_migrations").Scan(&v); err != nil {
		t.Fatalf("schema version: %v", err)
	}
	return v
}

func execOK(t *testing.T, database *sql.DB, stmt string, args ...any) {
	t.Helper()
	if _, err := database.Exec(stmt, args...); err != nil {
		t.Fatalf("exec %q: %v", stmt, err)
	}
}

// TestMigrateFreshSchema verifies a from-nothing Migrate produces the same
// final schema Node's initializeDatabase + migrations 1-15 produce.
func TestMigrateFreshSchema(t *testing.T) {
	database := testDB(t)
	migrate(t, database)
	ctx := context.Background()

	if v := schemaVersion(t, database); v != 15 {
		t.Errorf("schema version = %d, want 15", v)
	}
	var rows int
	if err := database.QueryRow("SELECT COUNT(*) FROM schema_migrations").Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 15 {
		t.Errorf("schema_migrations rows = %d, want 15", rows)
	}

	wantTables := []string{
		"users", "docker_hub_credentials", "repository_access_tokens", "tracked_apps",
		"deployed_images", "registry_image_versions", "containers", "batch_config",
		"settings", "discord_webhooks", "batch_runs", "discord_notifications_sent",
		"upgrade_history", "tracked_app_upgrade_history", "pending_auth_tokens",
		"revoked_tokens", "intents", "intent_executions", "intent_execution_containers",
		"oauth_states", "oauth_providers", "runners", "runner_enrollment_tokens",
		"runner_events", "source_instances",
	}
	for _, table := range wantTables {
		if !tableExists(t, database, table) {
			t.Errorf("missing table %s", table)
		}
	}
	// Migration 13 renamed it away; the ensure block's copy must not survive.
	if tableExists(t, database, "portainer_instances") {
		t.Error("portainer_instances should have been renamed to source_instances")
	}

	// Migration 5: password_hash nullable for OAuth-only users.
	if _, notNull := columnInfo(t, database, "users", "password_hash"); notNull != 0 {
		t.Error("users.password_hash should be nullable")
	}
	// Migration 13/14: containers identity columns and partial-unique indexes.
	columnInfo(t, database, "containers", "source_instance_id")
	columnInfo(t, database, "containers", "runner_id")
	for _, idx := range []string{"idx_containers_source_unique", "idx_containers_runner_unique"} {
		if !indexExists(t, database, idx) {
			t.Errorf("missing index %s", idx)
		}
	}
	// Migration 13: upgrade_history column renames.
	columnInfo(t, database, "upgrade_history", "source_url")
	columnInfo(t, database, "upgrade_history", "source_instance_id")
	// Migration 6/13: intents exclusion columns and typed source matching.
	columnInfo(t, database, "intents", "match_sources")
	columnInfo(t, database, "intents", "exclude_containers")
	// Migration 3/4: OAuth support.
	columnInfo(t, database, "oauth_states", "provider_name")
	columnInfo(t, database, "users", "oauth_provider")
	// Migration 9/12/15: runner health tracking.
	for _, col := range []string{"version", "latest_version", "version_checked_at",
		"docker_enabled", "last_seen", "docker_status", "docker_status_since"} {
		columnInfo(t, database, "runners", col)
	}

	// The ensure block's final CHECK must accept 'docker'.
	execOK(t, database, `INSERT INTO tracked_app_upgrade_history
		(user_id, app_name, provider, repository, old_version, new_version)
		VALUES (1, 'app', 'docker', 'r', 'a', 'b')`)

	// Idempotent: a second pass must be a clean no-op.
	if err := Migrate(ctx, database); err != nil {
		t.Fatalf("second Migrate: %v", err)
	}
	if v := schemaVersion(t, database); v != 15 {
		t.Errorf("schema version after re-run = %d, want 15", v)
	}
}

// TestMigrateLegacyDatabase upgrades a pre-migration-system (v1-era) schema
// with real rows and asserts every data migration preserved and converted
// them the way Node's migrations do.
func TestMigrateLegacyDatabase(t *testing.T) {
	database := testDB(t)

	execOK(t, database, `CREATE TABLE users (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT UNIQUE NOT NULL,
		password_hash TEXT NOT NULL,
		email TEXT,
		role TEXT DEFAULT 'Administrator',
		password_changed INTEGER DEFAULT 0,
		instance_admin INTEGER DEFAULT 0,
		verification_token TEXT,
		last_login DATETIME,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	execOK(t, database, `CREATE TABLE portainer_instances (
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
	)`)
	// Pre-name-column tokens table: the ensure block must add + backfill name.
	execOK(t, database, `CREATE TABLE repository_access_tokens (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		provider TEXT NOT NULL CHECK(provider IN ('github', 'gitlab')),
		access_token TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(user_id, provider)
	)`)
	execOK(t, database, `CREATE TABLE containers (
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
		UNIQUE(user_id, container_id, portainer_instance_id, endpoint_id)
	)`)
	// Old NOT NULL endpoint_id + portainer_* column names (full v1 shape;
	// runner_*/intent_id columns arrive via migrations 10/2 before 11 runs).
	execOK(t, database, `CREATE TABLE upgrade_history (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		portainer_instance_id INTEGER,
		portainer_instance_name TEXT,
		container_id TEXT NOT NULL,
		container_name TEXT NOT NULL,
		endpoint_id TEXT NOT NULL,
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
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	execOK(t, database, `CREATE TABLE intents (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		name TEXT NOT NULL,
		description TEXT,
		enabled INTEGER NOT NULL DEFAULT 1,
		match_containers TEXT,
		match_images TEXT,
		match_instances TEXT,
		match_stacks TEXT,
		match_registries TEXT,
		schedule_type TEXT NOT NULL DEFAULT 'immediate',
		schedule_cron TEXT,
		max_concurrent INTEGER NOT NULL DEFAULT 1,
		dry_run INTEGER NOT NULL DEFAULT 0,
		sequential_delay_sec INTEGER NOT NULL DEFAULT 30,
		last_evaluated_at DATETIME,
		last_execution_id INTEGER,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	execOK(t, database, `CREATE TABLE intent_executions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		intent_id INTEGER NOT NULL,
		user_id INTEGER NOT NULL,
		status TEXT NOT NULL DEFAULT 'pending',
		trigger_type TEXT NOT NULL,
		containers_matched INTEGER DEFAULT 0,
		containers_upgraded INTEGER DEFAULT 0,
		containers_failed INTEGER DEFAULT 0,
		containers_skipped INTEGER DEFAULT 0,
		error_message TEXT,
		started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		completed_at DATETIME,
		duration_ms INTEGER
	)`)
	execOK(t, database, `CREATE TABLE intent_execution_containers (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		execution_id INTEGER NOT NULL,
		container_id TEXT NOT NULL,
		container_name TEXT NOT NULL,
		image_name TEXT NOT NULL,
		portainer_instance_id INTEGER,
		status TEXT NOT NULL,
		old_image TEXT,
		new_image TEXT,
		old_digest TEXT,
		new_digest TEXT,
		error_message TEXT,
		duration_ms INTEGER,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	// Pre-'docker' CHECK constraint: the ensure block must rebuild it. The
	// legacy table has the full 17-column shape (only the CHECK differs),
	// which the rebuild's INSERT ... SELECT * requires.
	execOK(t, database, `CREATE TABLE tracked_app_upgrade_history (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		tracked_app_id INTEGER,
		app_name TEXT NOT NULL,
		provider TEXT NOT NULL CHECK(provider IN ('github', 'gitlab')),
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
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	// Pre-existing runners table (as if migration 7 already ran by hand):
	// docker_enabled must be backfilled into docker_status by migration 15.
	execOK(t, database, `CREATE TABLE runners (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		name TEXT NOT NULL,
		url TEXT NOT NULL,
		api_key TEXT NOT NULL,
		enabled INTEGER NOT NULL DEFAULT 1,
		docker_enabled INTEGER,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)

	// Seed data.
	execOK(t, database, `INSERT INTO users (username, password_hash) VALUES ('olduser', 'hash')`)
	execOK(t, database, `INSERT INTO portainer_instances (user_id, name, url) VALUES (1, 'port', 'http://port:9000')`)
	execOK(t, database, `INSERT INTO repository_access_tokens (user_id, provider, access_token) VALUES (1, 'github', 'tok')`)
	execOK(t, database, `INSERT INTO containers (user_id, portainer_instance_id, container_id, container_name, endpoint_id, image_name, image_repo)
		VALUES (1, 1, 'cid1', 'c1', '4', 'img:1', 'repo')`)
	execOK(t, database, `INSERT INTO upgrade_history (user_id, portainer_instance_id, portainer_instance_name, container_id, container_name, endpoint_id, portainer_url, old_image, new_image)
		VALUES (1, 1, 'port', 'cid1', 'c1', '4', 'http://port:9000', 'a:1', 'a:2')`)
	execOK(t, database, `INSERT INTO intents (user_id, name, match_instances) VALUES (1, 'i1', '[1,5]')`)
	execOK(t, database, `INSERT INTO intent_executions (intent_id, user_id, trigger_type) VALUES (1, 1, 'manual')`)
	execOK(t, database, `INSERT INTO intent_execution_containers (execution_id, container_id, container_name, image_name, portainer_instance_id, status)
		VALUES (1, 'cid1', 'c1', 'img:1', 1, 'success')`)
	execOK(t, database, `INSERT INTO tracked_app_upgrade_history (user_id, app_name, provider, repository, old_version, new_version)
		VALUES (1, 'app', 'github', 'r', '1', '2')`)
	execOK(t, database, `INSERT INTO runners (user_id, name, url, api_key, docker_enabled, updated_at)
		VALUES (1, 'r1', 'http://r1', 'k', 1, '2026-01-01 00:00:00')`)

	migrate(t, database)

	if v := schemaVersion(t, database); v != 15 {
		t.Fatalf("schema version = %d, want 15", v)
	}

	// Migration 5: users rebuilt, row preserved, password_hash now nullable.
	var username string
	if err := database.QueryRow("SELECT username FROM users WHERE id = 1").Scan(&username); err != nil {
		t.Fatalf("user lost: %v", err)
	}
	if username != "olduser" {
		t.Errorf("username = %q", username)
	}
	if _, notNull := columnInfo(t, database, "users", "password_hash"); notNull != 0 {
		t.Error("users.password_hash should be nullable after migration 5")
	}

	// Migration 13: portainer_instances renamed, row preserved.
	if tableExists(t, database, "portainer_instances") {
		t.Error("portainer_instances should be gone")
	}
	var instName string
	if err := database.QueryRow("SELECT name FROM source_instances WHERE id = 1").Scan(&instName); err != nil {
		t.Fatalf("source_instances row lost: %v", err)
	}

	// Migration 10/13: containers rebuilt with renamed column, row preserved.
	var containerName string
	if err := database.QueryRow("SELECT container_name FROM containers WHERE id = 1").Scan(&containerName); err != nil {
		t.Fatalf("containers row lost: %v", err)
	}
	columnInfo(t, database, "containers", "source_instance_id")

	// Migration 11/13: endpoint_id nullable, portainer_url -> source_url.
	if _, notNull := columnInfo(t, database, "upgrade_history", "endpoint_id"); notNull != 0 {
		t.Error("upgrade_history.endpoint_id should be nullable")
	}
	var sourceURL string
	if err := database.QueryRow("SELECT source_url FROM upgrade_history WHERE id = 1").Scan(&sourceURL); err != nil {
		t.Fatalf("upgrade_history row lost or source_url missing: %v", err)
	}
	if sourceURL != "http://port:9000" {
		t.Errorf("source_url = %q", sourceURL)
	}

	// Migration 13: match_instances [1,5] -> match_sources ["portainer:1","portainer:5"].
	var matchSources string
	if err := database.QueryRow("SELECT match_sources FROM intents WHERE id = 1").Scan(&matchSources); err != nil {
		t.Fatalf("intents row lost or match_sources missing: %v", err)
	}
	if matchSources != `["portainer:1","portainer:5"]` {
		t.Errorf("match_sources = %q", matchSources)
	}

	// Migration 13: intent_execution_containers gained runner_id, kept the row.
	columnInfo(t, database, "intent_execution_containers", "runner_id")
	var iecStatus string
	if err := database.QueryRow("SELECT status FROM intent_execution_containers WHERE id = 1").Scan(&iecStatus); err != nil {
		t.Fatalf("intent_execution_containers row lost: %v", err)
	}

	// Ensure block: repository_access_tokens.name added and backfilled.
	var tokenName string
	if err := database.QueryRow("SELECT name FROM repository_access_tokens WHERE id = 1").Scan(&tokenName); err != nil {
		t.Fatalf("repository_access_tokens.name missing: %v", err)
	}
	if tokenName != "github Token" {
		t.Errorf("token name = %q, want 'github Token'", tokenName)
	}

	// Ensure block: old CHECK constraint rebuilt to accept 'docker'.
	execOK(t, database, `INSERT INTO tracked_app_upgrade_history (user_id, app_name, provider, repository, old_version, new_version)
		VALUES (1, 'app2', 'docker', 'r', '1', '2')`)

	// Migration 15: docker_status backfilled from docker_enabled.
	var dockerStatus, dockerSince string
	if err := database.QueryRow(
		"SELECT docker_status, docker_status_since FROM runners WHERE id = 1").Scan(&dockerStatus, &dockerSince); err != nil {
		t.Fatalf("runner health columns missing: %v", err)
	}
	if dockerStatus != "ok" {
		t.Errorf("docker_status = %q, want ok", dockerStatus)
	}
	if dockerSince != "2026-01-01 00:00:00" {
		t.Errorf("docker_status_since = %q", dockerSince)
	}
}

// TestMigrateVersionGate verifies the MAX(version) gate: a database stamped
// through 0013 only runs 0014 (dedup + unique indexes) and 0015.
func TestMigrateVersionGate(t *testing.T) {
	database := testDB(t)

	// v13-era containers: renamed columns, UNIQUE constraint dropped (the bug
	// 0014 fixes), duplicate rows present.
	execOK(t, database, `CREATE TABLE containers (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		source_instance_id INTEGER,
		runner_id INTEGER,
		container_id TEXT NOT NULL,
		container_name TEXT NOT NULL,
		endpoint_id TEXT,
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
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	execOK(t, database, `CREATE TABLE runners (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		name TEXT NOT NULL,
		url TEXT NOT NULL,
		api_key TEXT NOT NULL,
		enabled INTEGER NOT NULL DEFAULT 1,
		version TEXT,
		latest_version TEXT,
		version_checked_at TEXT,
		docker_enabled INTEGER,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	execOK(t, database, `CREATE TABLE schema_migrations (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		version INTEGER NOT NULL UNIQUE,
		name TEXT NOT NULL,
		applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`)
	for v := 1; v <= 13; v++ {
		execOK(t, database, "INSERT INTO schema_migrations (version, name) VALUES (?, ?)", v, "seed")
	}
	// Duplicate source containers (same identity, ids 1-3) plus one runner
	// container duplicate pair (ids 4-5).
	execOK(t, database, `INSERT INTO containers (user_id, source_instance_id, container_id, container_name, endpoint_id, image_name, image_repo)
		VALUES (1, 1, 'dup', 'c', '4', 'i:1', 'r'), (1, 1, 'dup', 'c', '4', 'i:1', 'r'), (1, 1, 'dup', 'c', '4', 'i:1', 'r')`)
	execOK(t, database, `INSERT INTO containers (user_id, runner_id, container_id, container_name, image_name, image_repo)
		VALUES (1, 7, 'rcid', 'rc', 'i:1', 'r'), (1, 7, 'rcid', 'rc', 'i:1', 'r')`)
	execOK(t, database, `INSERT INTO runners (user_id, name, url, api_key, docker_enabled, updated_at)
		VALUES (1, 'r1', 'http://r1', 'k', 0, '2026-02-02 00:00:00')`)

	migrate(t, database)

	if v := schemaVersion(t, database); v != 15 {
		t.Fatalf("schema version = %d, want 15", v)
	}
	// Dedup keeps the highest id per identity: 3+2 rows collapse to 2.
	var count int
	if err := database.QueryRow("SELECT COUNT(*) FROM containers").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 2 {
		t.Errorf("containers rows = %d, want 2 after dedup", count)
	}
	var keptIDs []int
	rows, err := database.Query("SELECT id FROM containers ORDER BY id")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		keptIDs = append(keptIDs, id)
	}
	if len(keptIDs) != 2 || keptIDs[0] != 3 || keptIDs[1] != 5 {
		t.Errorf("kept ids = %v, want [3 5] (MAX(id) per group)", keptIDs)
	}
	if !indexExists(t, database, "idx_containers_source_unique") ||
		!indexExists(t, database, "idx_containers_runner_unique") {
		t.Error("partial unique indexes missing after migration 14")
	}

	var dockerStatus string
	if err := database.QueryRow("SELECT docker_status FROM runners WHERE id = 1").Scan(&dockerStatus); err != nil {
		t.Fatal(err)
	}
	if dockerStatus != "unavailable" {
		t.Errorf("docker_status = %q, want unavailable", dockerStatus)
	}
}

// TestMigrateMatchesNodeSchemaShape compares the table+index name set of a
// Go-migrated fresh database against the reference dump produced by Node's
// own initializeDatabase + migrations (recorded during the 7d smoke test).
func TestMigrateMatchesNodeSchemaShape(t *testing.T) {
	database := testDB(t)
	migrate(t, database)

	rows, err := database.Query("SELECT type, name FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' ORDER BY type, name")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var got []string
	for rows.Next() {
		var typ, name string
		if err := rows.Scan(&typ, &name); err != nil {
			t.Fatal(err)
		}
		got = append(got, typ+":"+name)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}

	// Go-specific cross-process tables that Node's dump does not contain.
	goOnly := map[string]bool{
		"table:upgrade_locks":      true,
		"table:idempotency_claims": true,
	}
	// Node's fresh DB carries the users_old FK scar and its own naming; the
	// name sets must otherwise match the reference list below.
	want := []string{
		"index:idx_batch_runs_started_at", "index:idx_batch_runs_status",
		"index:idx_containers_deployed_image", "index:idx_containers_image_repo",
		"index:idx_containers_last_seen", "index:idx_containers_runner_id",
		"index:idx_containers_runner_unique", "index:idx_containers_source_instance",
		"index:idx_containers_source_unique", "index:idx_containers_user_id",
		"index:idx_deployed_images_image_repo", "index:idx_deployed_images_last_seen",
		"index:idx_deployed_images_repository_token_id", "index:idx_deployed_images_user_id",
		"index:idx_discord_notifications_sent_at", "index:idx_discord_notifications_user_key",
		"index:idx_discord_webhooks_enabled", "index:idx_discord_webhooks_user_id",
		"index:idx_enrollment_token", "index:idx_enrollment_user_id",
		"index:idx_intent_exec_containers_execution_id",
		"index:idx_intent_executions_intent_id", "index:idx_intent_executions_status",
		"index:idx_intent_executions_user_id",
		"index:idx_intents_enabled", "index:idx_intents_user_id",
		"index:idx_oauth_providers_enabled", "index:idx_oauth_providers_name",
		"index:idx_oauth_states_created_at", "index:idx_oauth_states_state",
		"index:idx_registry_image_versions_image_repo", "index:idx_registry_image_versions_last_checked",
		"index:idx_registry_image_versions_user_id",
		"index:idx_repo_tokens_provider", "index:idx_repo_tokens_user_id",
		"index:idx_revoked_tokens_expires",
		"index:idx_runner_events_runner_id", "index:idx_runner_events_type",
		"index:idx_runners_user_id",
		"index:idx_settings_key", "index:idx_settings_user_id",
		"index:idx_source_display_order", "index:idx_source_url", "index:idx_source_user_id",
		"index:idx_tracked_app_upgrade_history_app_name",
		"index:idx_tracked_app_upgrade_history_created_at",
		"index:idx_tracked_app_upgrade_history_tracked_app_id",
		"index:idx_tracked_app_upgrade_history_user_id",
		"index:idx_tracked_apps_github_repo", "index:idx_tracked_apps_image_name",
		"index:idx_tracked_apps_name", "index:idx_tracked_apps_user_id",
		"index:idx_upgrade_history_container_name", "index:idx_upgrade_history_created_at",
		"index:idx_upgrade_history_intent_id", "index:idx_upgrade_history_user_id",
		"index:idx_users_oauth_provider_id", "index:idx_users_username",
		"table:batch_config", "table:batch_runs", "table:containers",
		"table:deployed_images", "table:discord_notifications_sent", "table:discord_webhooks",
		"table:docker_hub_credentials", "table:intent_execution_containers",
		"table:intent_executions", "table:intents", "table:oauth_providers",
		"table:oauth_states", "table:pending_auth_tokens", "table:registry_image_versions",
		"table:repository_access_tokens", "table:revoked_tokens", "table:runner_enrollment_tokens",
		"table:runner_events", "table:runners", "table:schema_migrations",
		"table:settings", "table:source_instances", "table:tracked_app_upgrade_history",
		"table:tracked_apps", "table:upgrade_history", "table:users",
	}
	wantSet := map[string]bool{}
	for _, w := range want {
		wantSet[w] = true
	}
	gotSet := map[string]bool{}
	for _, g := range got {
		if goOnly[g] {
			continue
		}
		gotSet[g] = true
		if !wantSet[g] {
			t.Errorf("unexpected object in migrated schema: %s", g)
		}
	}
	for _, w := range want {
		if !gotSet[w] {
			t.Errorf("missing object from migrated schema: %s", w)
		}
	}
}
