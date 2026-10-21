package db

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
)

// minimalContainersSchema creates just the tables/columns containersQuery
// touches, enough to exercise the runner-scoped filter without the full
// migration history.
func minimalContainersSchema(t *testing.T, database *sql.DB) {
	t.Helper()
	stmts := []string{
		`CREATE TABLE containers (
			id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL,
			container_id TEXT, container_name TEXT, image_name TEXT, image_repo TEXT,
			status TEXT, state TEXT, stack_name TEXT, endpoint_id INTEGER, runner_id INTEGER,
			uses_network_mode INTEGER DEFAULT 0, provides_network INTEGER DEFAULT 0,
			last_seen TEXT, created_at TEXT, updated_at TEXT, deployed_image_id INTEGER,
			source_instance_id INTEGER
		)`,
		`CREATE TABLE deployed_images (
			id INTEGER PRIMARY KEY, user_id INTEGER, image_digest TEXT, image_tag TEXT,
			repo_digests TEXT, registry TEXT, image_created_date TEXT, image_repo TEXT
		)`,
		`CREATE TABLE registry_image_versions (
			id INTEGER PRIMARY KEY, user_id INTEGER, image_repo TEXT, latest_digest TEXT,
			latest_version TEXT, tag TEXT, latest_publish_date TEXT, provider TEXT, last_checked TEXT
		)`,
		`CREATE TABLE source_instances (id INTEGER PRIMARY KEY, name TEXT, url TEXT)`,
		`CREATE TABLE runners (id INTEGER PRIMARY KEY, name TEXT, url TEXT)`,
	}
	for _, s := range stmts {
		if _, err := database.Exec(s); err != nil {
			t.Fatalf("create schema: %v", err)
		}
	}
}

func TestGetContainersByRunner(t *testing.T) {
	database, err := Open(filepath.Join(t.TempDir(), "containers.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	minimalContainersSchema(t, database)

	mustExec := func(q string, args ...any) {
		t.Helper()
		if _, err := database.Exec(q, args...); err != nil {
			t.Fatalf("exec: %v", err)
		}
	}
	mustExec(`INSERT INTO containers (user_id, container_id, container_name, runner_id, last_seen) VALUES
		(7, 'c1', 'one',   1, '2026-01-02'),
		(7, 'c2', 'two',   1, '2026-01-03'),
		(7, 'c3', 'three', 2, '2026-01-01'),
		(7, 'c4', 'orphan', NULL, '2026-01-04'),
		(8, 'c5', 'other-user', 1, '2026-01-05')`)

	ctx := context.Background()

	rows, err := GetContainersByRunner(ctx, database, 7, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 {
		t.Fatalf("runner 1 rows = %d, want 2", len(rows))
	}
	// last_seen DESC ordering is preserved by the shared query.
	if rows[0].ContainerName != "two" || rows[1].ContainerName != "one" {
		t.Errorf("ordering = %s, %s; want two, one", rows[0].ContainerName, rows[1].ContainerName)
	}

	rows, err = GetContainersByRunner(ctx, database, 7, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].ContainerName != "three" {
		t.Errorf("runner 2 rows = %+v, want [three]", rows)
	}

	// NULL runner_id rows and other users' rows never match.
	rows, err = GetContainersByRunner(ctx, database, 7, 99)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 0 {
		t.Errorf("unknown runner rows = %d, want 0", len(rows))
	}
	rows, err = GetContainersByRunner(ctx, database, 8, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].ContainerName != "other-user" {
		t.Errorf("user isolation broken: %+v", rows)
	}
}
