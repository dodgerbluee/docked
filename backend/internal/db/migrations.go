package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
)

// Each function below ports one Node migration file (server/db/migrations/
// 00XX_*.js) statement-for-statement. All are guarded/idempotent so they are
// safe no-ops on databases where the ensure block already created the final
// schema (fresh installs) — exactly like Node's runner.

// migrateBaseline (0001): the schema comes from ensureSchema; this only marks
// version 1 as applied.
func migrateBaseline(_ context.Context, _ *sql.Tx) error { return nil }

// migrateIntentsTables (0002).
func migrateIntentsTables(ctx context.Context, tx *sql.Tx) error {
	if ok, err := txTableExists(ctx, tx, "intents"); err != nil {
		return err
	} else if !ok {
		if _, err := tx.ExecContext(ctx, `
        CREATE TABLE intents (
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
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`); err != nil {
			return err
		}
	}

	if ok, err := txTableExists(ctx, tx, "intent_executions"); err != nil {
		return err
	} else if !ok {
		if _, err := tx.ExecContext(ctx, `
        CREATE TABLE intent_executions (
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
          duration_ms INTEGER,
          FOREIGN KEY (intent_id) REFERENCES intents(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`); err != nil {
			return err
		}
	}

	if ok, err := txTableExists(ctx, tx, "intent_execution_containers"); err != nil {
		return err
	} else if !ok {
		if _, err := tx.ExecContext(ctx, `
        CREATE TABLE intent_execution_containers (
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
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (execution_id) REFERENCES intent_executions(id) ON DELETE CASCADE
        )`); err != nil {
			return err
		}
	}

	if err := txAddColumn(ctx, tx, "upgrade_history", "intent_id", "INTEGER"); err != nil {
		return err
	}

	for _, idx := range []struct{ name, table, cols string }{
		{"idx_intents_user_id", "intents", "user_id"},
		{"idx_intents_enabled", "intents", "user_id, enabled"},
		{"idx_intent_executions_intent_id", "intent_executions", "intent_id"},
		{"idx_intent_executions_user_id", "intent_executions", "user_id"},
		{"idx_intent_executions_status", "intent_executions", "intent_id, status"},
		{"idx_intent_exec_containers_execution_id", "intent_execution_containers", "execution_id"},
		{"idx_upgrade_history_intent_id", "upgrade_history", "intent_id"},
	} {
		if err := txCreateIndex(ctx, tx, idx.name, idx.table, idx.cols, false); err != nil {
			return err
		}
	}
	return nil
}

// migrateOAuthSupport (0003).
func migrateOAuthSupport(ctx context.Context, tx *sql.Tx) error {
	if err := txAddColumn(ctx, tx, "users", "oauth_provider", "TEXT"); err != nil {
		return err
	}
	if err := txAddColumn(ctx, tx, "users", "oauth_provider_id", "TEXT"); err != nil {
		return err
	}
	// Unique only when both are non-null (SQLite ignores NULLs in unique indexes).
	if err := txCreateIndex(ctx, tx, "idx_users_oauth_provider_id", "users",
		"oauth_provider, oauth_provider_id", true); err != nil {
		return err
	}

	if ok, err := txTableExists(ctx, tx, "oauth_states"); err != nil {
		return err
	} else if !ok {
		if _, err := tx.ExecContext(ctx, `
        CREATE TABLE oauth_states (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          state TEXT UNIQUE NOT NULL,
          code_verifier TEXT NOT NULL,
          nonce TEXT NOT NULL,
          redirect_uri TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`); err != nil {
			return err
		}
	}

	if err := txCreateIndex(ctx, tx, "idx_oauth_states_state", "oauth_states", "state", true); err != nil {
		return err
	}
	return txCreateIndex(ctx, tx, "idx_oauth_states_created_at", "oauth_states", "created_at", false)
}

// migrateOAuthProvidersTable (0004).
func migrateOAuthProvidersTable(ctx context.Context, tx *sql.Tx) error {
	if ok, err := txTableExists(ctx, tx, "oauth_providers"); err != nil {
		return err
	} else if !ok {
		if _, err := tx.ExecContext(ctx, `
        CREATE TABLE oauth_providers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE NOT NULL,
          display_name TEXT NOT NULL,
          provider_type TEXT NOT NULL,
          client_id TEXT NOT NULL,
          client_secret TEXT NOT NULL,
          issuer_url TEXT NOT NULL,
          scopes TEXT DEFAULT 'openid,profile,email',
          auto_register INTEGER DEFAULT 1,
          default_role TEXT DEFAULT 'Administrator',
          enabled INTEGER DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`); err != nil {
			return err
		}
	}

	if err := txCreateIndex(ctx, tx, "idx_oauth_providers_name", "oauth_providers", "name", true); err != nil {
		return err
	}
	if err := txCreateIndex(ctx, tx, "idx_oauth_providers_enabled", "oauth_providers", "enabled", false); err != nil {
		return err
	}
	return txAddColumn(ctx, tx, "oauth_states", "provider_name", "TEXT")
}

// migratePasswordHashNullable (0005) rebuilds users so password_hash becomes
// nullable for OAuth-only users. Like Node, it runs unconditionally; the
// rename rewrites other tables' FK text to "users_old" (harmless: foreign
// keys are not enforced), matching the scar present in every Node-created DB.
//
// Two Go-side deviations from a literal port, both needed because ensureSchema
// runs BEFORE the versioned migrations here:
//   - Skip entirely when password_hash is already nullable (fresh installs:
//     ensureSchema created the final shape; rebuilding would be pointless).
//   - Re-add token_version after the rebuild. ensureSchema adds it up front,
//     but the rebuild's CREATE TABLE predates the column, so without this a
//     first boot on an old DB loses it until the NEXT restart re-adds it —
//     and every userCols SELECT in between fails.
func migratePasswordHashNullable(ctx context.Context, tx *sql.Tx) error {
	var notnull int
	err := tx.QueryRowContext(ctx,
		"SELECT \"notnull\" FROM pragma_table_info('users') WHERE name = 'password_hash'").Scan(&notnull)
	if errors.Is(err, sql.ErrNoRows) {
		return nil // no users table at all: nothing to rebuild
	}
	if err != nil {
		return err
	}
	if notnull == 0 {
		return nil // already nullable: ensureSchema (or Node) did the job
	}
	if _, err := tx.ExecContext(ctx, "ALTER TABLE users RENAME TO users_old"); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `CREATE TABLE users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT,
                email TEXT,
                role TEXT DEFAULT 'Administrator',
                password_changed INTEGER DEFAULT 0,
                instance_admin INTEGER DEFAULT 0,
                verification_token TEXT,
                last_login DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                oauth_provider TEXT,
                oauth_provider_id TEXT
              )`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
                   INSERT INTO users (id, username, password_hash, email, role, password_changed,
                    instance_admin, verification_token, last_login, created_at, updated_at,
                    oauth_provider, oauth_provider_id)
                   SELECT id, username, password_hash, email, role, password_changed,
                    instance_admin, verification_token, last_login, created_at, updated_at,
                    oauth_provider, oauth_provider_id
                   FROM users_old`); err != nil {
		return err
	}
	// Node treats the drop as non-fatal (data is already copied); inside the
	// transaction the whole migration rolls back instead, which is stricter.
	if _, err := tx.ExecContext(ctx, "DROP TABLE users_old"); err != nil {
		return err
	}
	if err := txCreateIndex(ctx, tx, "idx_users_username", "users", "username", false); err != nil {
		return err
	}
	if err := txAddColumn(ctx, tx, "users", "token_version", "INTEGER NOT NULL DEFAULT 0"); err != nil {
		return err
	}
	return txCreateIndex(ctx, tx, "idx_users_oauth_provider_id", "users",
		"oauth_provider, oauth_provider_id", true)
}

// migrateExclusionCriteria (0006).
func migrateExclusionCriteria(ctx context.Context, tx *sql.Tx) error {
	for _, col := range []struct{ name, def string }{
		{"exclude_containers", "TEXT DEFAULT '[]'"},
		{"exclude_images", "TEXT DEFAULT '[]'"},
		{"exclude_stacks", "TEXT DEFAULT '[]'"},
		{"exclude_registries", "TEXT DEFAULT '[]'"},
	} {
		if err := txAddColumn(ctx, tx, "intents", col.name, col.def); err != nil {
			return err
		}
	}
	return nil
}

// migrateRunnersTable (0007).
func migrateRunnersTable(ctx context.Context, tx *sql.Tx) error {
	if ok, err := txTableExists(ctx, tx, "runners"); err != nil {
		return err
	} else if !ok {
		if _, err := tx.ExecContext(ctx, `
        CREATE TABLE runners (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          api_key TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`); err != nil {
			return err
		}
	}
	return txCreateIndex(ctx, tx, "idx_runners_user_id", "runners", "user_id", false)
}

// migrateEnrollmentTokensTable (0008).
func migrateEnrollmentTokensTable(ctx context.Context, tx *sql.Tx) error {
	if ok, err := txTableExists(ctx, tx, "runner_enrollment_tokens"); err != nil {
		return err
	} else if !ok {
		if _, err := tx.ExecContext(ctx, `
        CREATE TABLE runner_enrollment_tokens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          token TEXT NOT NULL UNIQUE,
          expires_at DATETIME NOT NULL,
          used INTEGER NOT NULL DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`); err != nil {
			return err
		}
	}
	if err := txCreateIndex(ctx, tx, "idx_enrollment_token", "runner_enrollment_tokens", "token", true); err != nil {
		return err
	}
	return txCreateIndex(ctx, tx, "idx_enrollment_user_id", "runner_enrollment_tokens", "user_id", false)
}

// migrateRunnerVersionColumns (0009).
func migrateRunnerVersionColumns(ctx context.Context, tx *sql.Tx) error {
	for _, col := range []string{"version", "latest_version", "version_checked_at"} {
		if err := txAddColumn(ctx, tx, "runners", col, "TEXT"); err != nil {
			return err
		}
	}
	return nil
}

// migrateRunnerContainerSupport (0010): nullable portainer_instance_id plus
// runner_id/runner_name, containers rebuilt.
func migrateRunnerContainerSupport(ctx context.Context, tx *sql.Tx) error {
	if err := txAddColumn(ctx, tx, "upgrade_history", "runner_id",
		"INTEGER REFERENCES runners(id) ON DELETE SET NULL"); err != nil {
		return err
	}
	if err := txAddColumn(ctx, tx, "upgrade_history", "runner_name", "TEXT"); err != nil {
		return err
	}

	if exists, err := txColumnExists(ctx, tx, "containers", "runner_id"); err != nil {
		return err
	} else if exists {
		slog.Info("migrate 10: containers.runner_id already exists, skipping recreation")
		return nil
	}

	if _, err := tx.ExecContext(ctx, `
      CREATE TABLE IF NOT EXISTS containers_v10 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        portainer_instance_id INTEGER,
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
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (portainer_instance_id) REFERENCES portainer_instances(id) ON DELETE CASCADE,
        FOREIGN KEY (runner_id) REFERENCES runners(id) ON DELETE CASCADE,
        FOREIGN KEY (deployed_image_id) REFERENCES deployed_images(id) ON DELETE SET NULL
      )`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
      INSERT INTO containers_v10 (
        id, user_id, portainer_instance_id, runner_id,
        container_id, container_name, endpoint_id,
        image_name, image_repo, status, state, stack_name,
        deployed_image_id, uses_network_mode, provides_network,
        last_seen, created_at, updated_at
      )
      SELECT
        id, user_id, portainer_instance_id, NULL,
        container_id, container_name, endpoint_id,
        image_name, image_repo, status, state, stack_name,
        deployed_image_id, uses_network_mode, provides_network,
        last_seen, created_at, updated_at
      FROM containers`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "DROP TABLE containers"); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "ALTER TABLE containers_v10 RENAME TO containers"); err != nil {
		return err
	}

	for _, idx := range []struct{ name, cols string }{
		{"idx_containers_user_id", "user_id"},
		{"idx_containers_instance", "portainer_instance_id"},
		{"idx_containers_runner_id", "runner_id"},
		{"idx_containers_deployed_image", "deployed_image_id"},
		{"idx_containers_image_repo", "image_repo"},
		{"idx_containers_last_seen", "last_seen"},
	} {
		if err := txCreateIndex(ctx, tx, idx.name, "containers", idx.cols, false); err != nil {
			return err
		}
	}
	return nil
}

// migrateUpgradeHistoryEndpointNullable (0011): endpoint_id becomes nullable
// so runner-backed history rows fit; table rebuilt.
func migrateUpgradeHistoryEndpointNullable(ctx context.Context, tx *sql.Tx) error {
	if _, err := tx.ExecContext(ctx, `
      CREATE TABLE IF NOT EXISTS upgrade_history_v11 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        portainer_instance_id INTEGER,
        portainer_instance_name TEXT,
        runner_id INTEGER,
        runner_name TEXT,
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
        intent_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (portainer_instance_id) REFERENCES portainer_instances(id) ON DELETE SET NULL,
        FOREIGN KEY (runner_id) REFERENCES runners(id) ON DELETE SET NULL
      )`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
      INSERT INTO upgrade_history_v11 (
        id, user_id, portainer_instance_id, portainer_instance_name,
        runner_id, runner_name,
        container_id, container_name, endpoint_id, portainer_url,
        old_image, new_image, old_digest, new_digest,
        old_version, new_version, image_repo, registry, namespace, repository,
        status, error_message, upgrade_duration_ms, intent_id, created_at
      )
      SELECT
        id, user_id, portainer_instance_id, portainer_instance_name,
        runner_id, runner_name,
        container_id, container_name, endpoint_id, portainer_url,
        old_image, new_image, old_digest, new_digest,
        old_version, new_version, image_repo, registry, namespace, repository,
        status, error_message, upgrade_duration_ms, intent_id, created_at
      FROM upgrade_history`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "DROP TABLE upgrade_history"); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "ALTER TABLE upgrade_history_v11 RENAME TO upgrade_history"); err != nil {
		return err
	}

	for _, idx := range []struct{ name, cols string }{
		{"idx_upgrade_history_user_id", "user_id"},
		{"idx_upgrade_history_created_at", "created_at"},
		{"idx_upgrade_history_container_name", "container_name"},
		{"idx_upgrade_history_intent_id", "intent_id"},
	} {
		if err := txCreateIndex(ctx, tx, idx.name, "upgrade_history", idx.cols, false); err != nil {
			return err
		}
	}
	return nil
}

// migrateRunnerDockerEnabled (0012).
func migrateRunnerDockerEnabled(ctx context.Context, tx *sql.Tx) error {
	return txAddColumn(ctx, tx, "runners", "docker_enabled", "INTEGER")
}

// migrateRenamePortainerToSources (0013).
func migrateRenamePortainerToSources(ctx context.Context, tx *sql.Tx) error {
	// 1. portainer_instances -> source_instances
	if ok, err := txTableExists(ctx, tx, "portainer_instances"); err != nil {
		return err
	} else if ok {
		if _, err := tx.ExecContext(ctx, `
        CREATE TABLE IF NOT EXISTS source_instances (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          username TEXT DEFAULT '',
          password TEXT DEFAULT '',
          api_key TEXT,
          auth_type TEXT DEFAULT 'password',
          ip_address TEXT,
          display_order INTEGER DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          UNIQUE(user_id, url)
        )`); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
        INSERT INTO source_instances (
          id, user_id, name, url, username, password, api_key, auth_type,
          ip_address, display_order, created_at, updated_at
        )
        SELECT
          id, user_id, name, url, username, password, api_key, auth_type,
          ip_address, display_order, created_at, updated_at
        FROM portainer_instances`); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "DROP TABLE portainer_instances"); err != nil {
			return err
		}
		for _, idx := range []struct{ name, cols string }{
			{"idx_source_user_id", "user_id"},
			{"idx_source_url", "user_id, url"},
			{"idx_source_display_order", "user_id, display_order"},
		} {
			if err := txCreateIndex(ctx, tx, idx.name, "source_instances", idx.cols, false); err != nil {
				return err
			}
		}
	}

	// 2. containers.portainer_instance_id -> source_instance_id
	if ok, err := txColumnExists(ctx, tx, "containers", "portainer_instance_id"); err != nil {
		return err
	} else if ok {
		if _, err := tx.ExecContext(ctx, `
        CREATE TABLE IF NOT EXISTS containers_v13 (
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
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (source_instance_id) REFERENCES source_instances(id) ON DELETE CASCADE,
          FOREIGN KEY (runner_id) REFERENCES runners(id) ON DELETE CASCADE,
          FOREIGN KEY (deployed_image_id) REFERENCES deployed_images(id) ON DELETE SET NULL
        )`); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
        INSERT INTO containers_v13 (
          id, user_id, source_instance_id, runner_id,
          container_id, container_name, endpoint_id,
          image_name, image_repo, status, state, stack_name,
          deployed_image_id, uses_network_mode, provides_network,
          last_seen, created_at, updated_at
        )
        SELECT
          id, user_id, portainer_instance_id, runner_id,
          container_id, container_name, endpoint_id,
          image_name, image_repo, status, state, stack_name,
          deployed_image_id, uses_network_mode, provides_network,
          last_seen, created_at, updated_at
        FROM containers`); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "DROP TABLE containers"); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "ALTER TABLE containers_v13 RENAME TO containers"); err != nil {
			return err
		}
		for _, idx := range []struct{ name, cols string }{
			{"idx_containers_user_id", "user_id"},
			{"idx_containers_source_instance", "source_instance_id"},
			{"idx_containers_runner_id", "runner_id"},
			{"idx_containers_deployed_image", "deployed_image_id"},
			{"idx_containers_image_repo", "image_repo"},
			{"idx_containers_last_seen", "last_seen"},
		} {
			if err := txCreateIndex(ctx, tx, idx.name, "containers", idx.cols, false); err != nil {
				return err
			}
		}
	}

	// 3. upgrade_history portainer_* -> source_*
	if ok, err := txColumnExists(ctx, tx, "upgrade_history", "portainer_instance_id"); err != nil {
		return err
	} else if ok {
		if _, err := tx.ExecContext(ctx, `
        CREATE TABLE IF NOT EXISTS upgrade_history_v13 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          source_instance_id INTEGER,
          source_instance_name TEXT,
          runner_id INTEGER,
          runner_name TEXT,
          container_id TEXT NOT NULL,
          container_name TEXT NOT NULL,
          endpoint_id TEXT,
          source_url TEXT,
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
          intent_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (source_instance_id) REFERENCES source_instances(id) ON DELETE SET NULL,
          FOREIGN KEY (runner_id) REFERENCES runners(id) ON DELETE SET NULL
        )`); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
        INSERT INTO upgrade_history_v13 (
          id, user_id, source_instance_id, source_instance_name,
          runner_id, runner_name,
          container_id, container_name, endpoint_id, source_url,
          old_image, new_image, old_digest, new_digest,
          old_version, new_version, image_repo, registry, namespace, repository,
          status, error_message, upgrade_duration_ms, intent_id, created_at
        )
        SELECT
          id, user_id, portainer_instance_id, portainer_instance_name,
          runner_id, runner_name,
          container_id, container_name, endpoint_id, portainer_url,
          old_image, new_image, old_digest, new_digest,
          old_version, new_version, image_repo, registry, namespace, repository,
          status, error_message, upgrade_duration_ms, intent_id, created_at
        FROM upgrade_history`); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "DROP TABLE upgrade_history"); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "ALTER TABLE upgrade_history_v13 RENAME TO upgrade_history"); err != nil {
			return err
		}
		for _, idx := range []struct{ name, cols string }{
			{"idx_upgrade_history_user_id", "user_id"},
			{"idx_upgrade_history_created_at", "created_at"},
			{"idx_upgrade_history_container_name", "container_name"},
			{"idx_upgrade_history_intent_id", "intent_id"},
		} {
			if err := txCreateIndex(ctx, tx, idx.name, "upgrade_history", idx.cols, false); err != nil {
				return err
			}
		}
	}

	// 4. intent_execution_containers: rename FK column, add runner_id
	if ok, err := txColumnExists(ctx, tx, "intent_execution_containers", "portainer_instance_id"); err != nil {
		return err
	} else if ok {
		if _, err := tx.ExecContext(ctx, `
        CREATE TABLE IF NOT EXISTS intent_execution_containers_v13 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          execution_id INTEGER NOT NULL,
          container_id TEXT NOT NULL,
          container_name TEXT NOT NULL,
          image_name TEXT NOT NULL,
          source_instance_id INTEGER,
          runner_id INTEGER,
          status TEXT NOT NULL,
          old_image TEXT,
          new_image TEXT,
          old_digest TEXT,
          new_digest TEXT,
          error_message TEXT,
          duration_ms INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (execution_id) REFERENCES intent_executions(id) ON DELETE CASCADE
        )`); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
        INSERT INTO intent_execution_containers_v13 (
          id, execution_id, container_id, container_name, image_name,
          source_instance_id, runner_id, status,
          old_image, new_image, old_digest, new_digest,
          error_message, duration_ms, created_at
        )
        SELECT
          id, execution_id, container_id, container_name, image_name,
          portainer_instance_id, NULL, status,
          old_image, new_image, old_digest, new_digest,
          error_message, duration_ms, created_at
        FROM intent_execution_containers`); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "DROP TABLE intent_execution_containers"); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx,
			"ALTER TABLE intent_execution_containers_v13 RENAME TO intent_execution_containers"); err != nil {
			return err
		}
		if err := txCreateIndex(ctx, tx, "idx_intent_exec_containers_execution_id",
			"intent_execution_containers", "execution_id", false); err != nil {
			return err
		}
	}

	// 5. intents.match_instances -> match_sources, converting plain numeric
	// IDs to typed "portainer:<id>" source IDs.
	if ok, err := txColumnExists(ctx, tx, "intents", "match_instances"); err != nil {
		return err
	} else if ok {
		if _, err := tx.ExecContext(ctx, `
        CREATE TABLE IF NOT EXISTS intents_v13 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          match_containers TEXT,
          match_images TEXT,
          match_sources TEXT,
          match_stacks TEXT,
          match_registries TEXT,
          exclude_containers TEXT,
          exclude_images TEXT,
          exclude_stacks TEXT,
          exclude_registries TEXT,
          schedule_type TEXT NOT NULL DEFAULT 'immediate',
          schedule_cron TEXT,
          max_concurrent INTEGER NOT NULL DEFAULT 1,
          dry_run INTEGER NOT NULL DEFAULT 0,
          sequential_delay_sec INTEGER NOT NULL DEFAULT 30,
          last_evaluated_at DATETIME,
          last_execution_id INTEGER,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `
        INSERT INTO intents_v13 (
          id, user_id, name, description, enabled,
          match_containers, match_images, match_sources, match_stacks, match_registries,
          exclude_containers, exclude_images, exclude_stacks, exclude_registries,
          schedule_type, schedule_cron, max_concurrent, dry_run, sequential_delay_sec,
          last_evaluated_at, last_execution_id, created_at, updated_at
        )
        SELECT
          id, user_id, name, description, enabled,
          match_containers, match_images,
          CASE
            WHEN match_instances IS NOT NULL AND match_instances != '[]' AND match_instances != 'null'
            THEN replace(replace(replace(match_instances, '[', '["portainer:'), ',', '","portainer:'), ']', '"]')
            ELSE match_instances
          END,
          match_stacks, match_registries,
          exclude_containers, exclude_images, exclude_stacks, exclude_registries,
          schedule_type, schedule_cron, max_concurrent, dry_run, sequential_delay_sec,
          last_evaluated_at, last_execution_id, created_at, updated_at
        FROM intents`); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "DROP TABLE intents"); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "ALTER TABLE intents_v13 RENAME TO intents"); err != nil {
			return err
		}
		if err := txCreateIndex(ctx, tx, "idx_intents_user_id", "intents", "user_id", false); err != nil {
			return err
		}
		if err := txCreateIndex(ctx, tx, "idx_intents_enabled", "intents", "user_id, enabled", false); err != nil {
			return err
		}
	}
	return nil
}

// migrateRestoreContainersUnique (0014): deduplicate containers and restore
// the partial-unique indexes dropped by 0013.
func migrateRestoreContainersUnique(ctx context.Context, tx *sql.Tx) error {
	var before int
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM containers").Scan(&before); err != nil {
		return err
	}

	if _, err := tx.ExecContext(ctx, `
      CREATE TABLE IF NOT EXISTS containers_v14 (
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
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (source_instance_id) REFERENCES source_instances(id) ON DELETE CASCADE,
        FOREIGN KEY (runner_id) REFERENCES runners(id) ON DELETE CASCADE,
        FOREIGN KEY (deployed_image_id) REFERENCES deployed_images(id) ON DELETE SET NULL
      )`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
      INSERT INTO containers_v14 (
        id, user_id, source_instance_id, runner_id,
        container_id, container_name, endpoint_id,
        image_name, image_repo, status, state, stack_name,
        deployed_image_id, uses_network_mode, provides_network,
        last_seen, created_at, updated_at
      )
      SELECT
        id, user_id, source_instance_id, runner_id,
        container_id, container_name, endpoint_id,
        image_name, image_repo, status, state, stack_name,
        deployed_image_id, uses_network_mode, provides_network,
        last_seen, created_at, updated_at
      FROM containers
      WHERE id IN (
        SELECT MAX(id) FROM containers
        WHERE source_instance_id IS NOT NULL
        GROUP BY user_id, container_id, source_instance_id, endpoint_id
        UNION ALL
        SELECT MAX(id) FROM containers
        WHERE runner_id IS NOT NULL
        GROUP BY user_id, container_id, runner_id
      )`); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "DROP TABLE containers"); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "ALTER TABLE containers_v14 RENAME TO containers"); err != nil {
		return err
	}

	if err := txCreateIndex(ctx, tx, "idx_containers_source_unique", "containers",
		"user_id, container_id, source_instance_id, endpoint_id", true); err != nil {
		return err
	}
	if err := txCreateIndex(ctx, tx, "idx_containers_runner_unique", "containers",
		"user_id, container_id, runner_id", true); err != nil {
		return err
	}
	for _, idx := range []struct{ name, cols string }{
		{"idx_containers_user_id", "user_id"},
		{"idx_containers_source_instance", "source_instance_id"},
		{"idx_containers_runner_id", "runner_id"},
		{"idx_containers_deployed_image", "deployed_image_id"},
		{"idx_containers_image_repo", "image_repo"},
		{"idx_containers_last_seen", "last_seen"},
	} {
		if err := txCreateIndex(ctx, tx, idx.name, "containers", idx.cols, false); err != nil {
			return err
		}
	}

	var after int
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM containers").Scan(&after); err != nil {
		return err
	}
	slog.Info("migrate 14: containers deduplicated", "before", before, "after", after)
	return nil
}

// migrateIntentScheduleTimezone (0016).
func migrateIntentScheduleTimezone(ctx context.Context, tx *sql.Tx) error {
	// The GraphQL schema has always advertised intent scheduleTimezone; the
	// resolvers had no column to put it in and rejected every write.
	if ok, err := txTableExists(ctx, tx, "intents"); err != nil {
		return err
	} else if !ok {
		return nil
	}
	return txAddColumn(ctx, tx, "intents", "schedule_timezone", "TEXT")
}

// migrateRunnerHealthTracking (0015).
func migrateRunnerHealthTracking(ctx context.Context, tx *sql.Tx) error {
	if err := txAddColumn(ctx, tx, "runners", "last_seen", "TEXT"); err != nil {
		return err
	}
	if err := txAddColumn(ctx, tx, "runners", "docker_status", "TEXT DEFAULT 'unknown'"); err != nil {
		return err
	}
	if err := txAddColumn(ctx, tx, "runners", "docker_status_since", "TEXT"); err != nil {
		return err
	}

	if ok, err := txTableExists(ctx, tx, "runner_events"); err != nil {
		return err
	} else if !ok {
		if _, err := tx.ExecContext(ctx, `
        CREATE TABLE runner_events (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          runner_id  INTEGER NOT NULL REFERENCES runners(id) ON DELETE CASCADE,
          event_type TEXT    NOT NULL,
          message    TEXT,
          details    TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`); err != nil {
			return err
		}
	}

	if err := txCreateIndex(ctx, tx, "idx_runner_events_runner_id", "runner_events",
		"runner_id, created_at DESC", false); err != nil {
		return err
	}
	if err := txCreateIndex(ctx, tx, "idx_runner_events_type", "runner_events",
		"event_type, created_at DESC", false); err != nil {
		return err
	}

	// Backfill docker_status from existing docker_enabled values.
	_, err := tx.ExecContext(ctx, `
      UPDATE runners SET
        docker_status = CASE
          WHEN docker_enabled = 1 THEN 'ok'
          WHEN docker_enabled = 0 THEN 'unavailable'
          ELSE 'unknown'
        END,
        docker_status_since = COALESCE(version_checked_at, updated_at)
      WHERE docker_status IS NULL OR docker_status = 'unknown'
    `)
	return err
}

// migrateTrackedAppsNullSafeUnique (0017): the table-level
// UNIQUE(user_id, image_name, github_repo) never fires when github_repo is
// NULL, because SQLite treats NULLs as distinct in unique constraints. Re-adding
// the same image therefore inserted a second row every time instead of hitting
// the duplicate error, and the update path then wrote to an arbitrary one of
// them. Deduplicate what already exists and add an expression index that
// collapses NULL and '' into the same identity.
//
// The index is partial on image_name: an app tracked by repository alone has no
// image identity at all, and those must stay allowed to coexist.
func migrateTrackedAppsNullSafeUnique(ctx context.Context, tx *sql.Tx) error {
	if ok, err := txTableExists(ctx, tx, "tracked_apps"); err != nil {
		return err
	} else if !ok {
		return nil
	}

	var before int
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM tracked_apps").Scan(&before); err != nil {
		return err
	}

	// Keep the newest row per identity: it carries the most recent check
	// results. History rows are re-pointed at the survivor before the losers
	// go, so no upgrade history is orphaned by the dedupe.
	if _, err := tx.ExecContext(ctx, `
      WITH app_identity AS (
        SELECT id, MAX(id) OVER (
                 PARTITION BY user_id, image_name, COALESCE(github_repo, '')
               ) AS keep_id
          FROM tracked_apps
         WHERE image_name IS NOT NULL AND image_name <> ''
      )
      UPDATE tracked_app_upgrade_history
         SET tracked_app_id = (
           SELECT ai.keep_id FROM app_identity ai WHERE ai.id = tracked_app_upgrade_history.tracked_app_id
         )
       WHERE tracked_app_id IS NOT NULL
         AND EXISTS (
           SELECT 1 FROM app_identity ai
            WHERE ai.id = tracked_app_upgrade_history.tracked_app_id AND ai.id <> ai.keep_id
         )
    `); err != nil {
		return fmt.Errorf("re-point tracked app history: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `
      DELETE FROM tracked_apps
       WHERE image_name IS NOT NULL AND image_name <> ''
         AND id NOT IN (
           SELECT MAX(id) FROM tracked_apps
            WHERE image_name IS NOT NULL AND image_name <> ''
            GROUP BY user_id, image_name, COALESCE(github_repo, '')
         )
    `); err != nil {
		return fmt.Errorf("deduplicate tracked_apps: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tracked_apps_identity_unique
        ON tracked_apps(user_id, image_name, COALESCE(github_repo, ''))
       WHERE image_name IS NOT NULL AND image_name <> ''
    `); err != nil {
		return fmt.Errorf("create tracked_apps identity index: %w", err)
	}

	var after int
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM tracked_apps").Scan(&after); err != nil {
		return err
	}
	slog.Info("migrate 17: tracked_apps deduplicated", "before", before, "after", after)
	return nil
}
