package db

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
)

func newContainerDataTestDB(t *testing.T) *sql.DB {
	t.Helper()
	database, err := Open(filepath.Join(t.TempDir(), "containerdata-test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	stmts := []string{
		`CREATE TABLE source_instances (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			name TEXT NOT NULL,
			url TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
			deployed_image_id INTEGER,
			last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE deployed_images (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			image_repo TEXT NOT NULL,
			image_tag TEXT NOT NULL,
			last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE registry_image_versions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			image_repo TEXT NOT NULL,
			tag TEXT NOT NULL,
			last_checked DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE tracked_apps (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			name TEXT NOT NULL
		)`,
		`INSERT INTO source_instances (id, user_id, name, url) VALUES
			(1, 1, 'toybox', 'https://portainer.example'),
			(2, 2, 'other', 'https://other.example')`,
		`INSERT INTO deployed_images (id, user_id, image_repo, image_tag, last_seen) VALUES
			(10, 1, 'ghcr.io/foo/app', '1.2.3', '2026-01-02 00:00:00'),
			(11, 2, 'ghcr.io/bar/app', '1.0.0', '2026-01-02 00:00:00')`,
		`INSERT INTO containers (id, user_id, source_instance_id, container_id, container_name, endpoint_id, image_name, image_repo, deployed_image_id, last_seen, updated_at) VALUES
			(1, 1, 1, 'abc123def456', 'app', 2, 'ghcr.io/foo/app:1.2.3', 'ghcr.io/foo/app', 10, '2026-01-01 00:00:00', '2026-01-01 00:00:00'),
			(2, 1, 1, 'def456ghi789', 'sidecar', 2, 'ghcr.io/foo/app:1.2.3', 'ghcr.io/foo/app', 10, '2026-01-03 00:00:00', '2026-01-03 00:00:00'),
			(3, 2, 2, 'zzz123', 'other', 1, 'ghcr.io/bar/app:1.0.0', 'ghcr.io/bar/app', 11, '2026-01-04 00:00:00', '2026-01-04 00:00:00')`,
		`INSERT INTO registry_image_versions (id, user_id, image_repo, tag, last_checked) VALUES
			(20, 1, 'ghcr.io/foo/app', '1.2.3', '2026-01-05 00:00:00'),
			(21, 2, 'ghcr.io/bar/app', '1.0.0', '2026-01-05 00:00:00')`,
		`INSERT INTO tracked_apps (id, user_id, name) VALUES (30, 1, 'arr'), (31, 2, 'other')`,
	}
	for _, stmt := range stmts {
		if _, err := database.Exec(stmt); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
	return database
}

func TestGetRawDatabaseRecords(t *testing.T) {
	database := newContainerDataTestDB(t)

	records, err := GetRawDatabaseRecords(context.Background(), database, 1)
	if err != nil {
		t.Fatalf("GetRawDatabaseRecords: %v", err)
	}

	for _, table := range []string{"source_instances", "containers", "deployed_images", "registry_image_versions", "tracked_apps"} {
		if _, ok := records[table]; !ok {
			t.Fatalf("missing table %q in %#v", table, records)
		}
		if _, ok := records[table].([]map[string]any); !ok {
			t.Fatalf("table %q is %T, want []map[string]any", table, records[table])
		}
	}

	containers := records["containers"].([]map[string]any)
	if len(containers) != 2 {
		t.Fatalf("containers: got %d rows, want 2 (other users must be excluded)", len(containers))
	}
	// ORDER BY last_seen DESC
	if containers[0]["container_name"] != "sidecar" {
		t.Fatalf("containers not ordered by last_seen DESC: %#v", containers[0])
	}
	// Values must be JSON-friendly: DATETIME columns come back as strings and
	// INTEGER columns as int64, never []byte.
	if _, ok := containers[0]["last_seen"].(string); !ok {
		t.Fatalf("last_seen is %T, want string", containers[0]["last_seen"])
	}
	if id, ok := containers[0]["deployed_image_id"].(int64); !ok || id != 10 {
		t.Fatalf("deployed_image_id is %T (%v), want int64(10)", containers[0]["deployed_image_id"], containers[0]["deployed_image_id"])
	}

	if instances := records["source_instances"].([]map[string]any); len(instances) != 1 || instances[0]["name"] != "toybox" {
		t.Fatalf("source_instances: unexpected %#v", instances)
	}
	if apps := records["tracked_apps"].([]map[string]any); len(apps) != 1 {
		t.Fatalf("tracked_apps: got %d rows, want 1", len(apps))
	}
}

func TestGetRawDatabaseRecordsMissingTable(t *testing.T) {
	database, err := Open(filepath.Join(t.TempDir(), "missing-table.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer database.Close()
	if _, err := database.Exec(`CREATE TABLE containers (id INTEGER PRIMARY KEY, user_id INTEGER)`); err != nil {
		t.Fatalf("create: %v", err)
	}

	records, err := GetRawDatabaseRecords(context.Background(), database, 1)
	if err != nil {
		t.Fatalf("GetRawDatabaseRecords: %v", err)
	}
	if rows, ok := records["tracked_apps"].([]map[string]any); !ok || len(rows) != 0 {
		t.Fatalf("tracked_apps should be an empty list, got %#v", records["tracked_apps"])
	}
	msg, ok := records["tracked_apps_error"].(string)
	if !ok || msg == "" {
		t.Fatalf("expected tracked_apps_error to be set, got %#v", records["tracked_apps_error"])
	}
}

func TestClearUserContainerData(t *testing.T) {
	database := newContainerDataTestDB(t)

	if err := ClearUserContainerData(context.Background(), database, 1); err != nil {
		t.Fatalf("ClearUserContainerData: %v", err)
	}

	count := func(table string, args ...any) int {
		t.Helper()
		var n int
		if err := database.QueryRow("SELECT COUNT(*) FROM "+table+" WHERE user_id = ?", args...).Scan(&n); err != nil {
			t.Fatalf("count %s: %v", table, err)
		}
		return n
	}

	for _, table := range []string{"containers", "deployed_images", "registry_image_versions"} {
		if got := count(table, 1); got != 0 {
			t.Fatalf("%s: got %d rows for user 1, want 0", table, got)
		}
		if got := count(table, 2); got == 0 {
			t.Fatalf("%s: user 2 rows must survive a user 1 clear", table)
		}
	}
	// tracked_apps are managed separately and must not be cleared.
	if got := count("tracked_apps", 1); got != 1 {
		t.Fatalf("tracked_apps: got %d rows for user 1, want 1", got)
	}
}
