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

// SummaryStats.containersWithUpdates counts through GetContainers +
// ContainerHasUpdate; this pins that path's semantics against the traps the
// old standalone SQL fell into: stale deploy-time digests (repo_digests is
// sync-updated and current -> NO update), docker.io-normalized joins, and
// wrong-tag registry rows (must not flag a container pinned to another tag).
func TestCountContainersWithUpdateParity(t *testing.T) {
	database := testDB(t)
	minimalContainersSchema(t, database)
	ctx := context.Background()

	seed := func(q string, args ...any) {
		t.Helper()
		if _, err := database.ExecContext(ctx, q, args...); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
	seed(`INSERT INTO deployed_images (id, user_id, image_repo, image_tag, image_digest, repo_digests) VALUES
		(1, 1, 'r/a',       '1.0', 'sha256:aaa', '["sha256:bbb"]'),
		(2, 1, 'r/b',       '1.0', 'sha256:ccc', '["sha256:ccc"]'),
		(3, 1, 'docker.io/library/x', '1.0', 'sha256:e1', '["sha256:e1"]'),
		(4, 1, 'r/d',       '1.0', 'sha256:f1', NULL),
		(5, 1, 'r/e',       '1.0', 'sha256:g1', '["sha256:g1"]')`)
	seed(`INSERT INTO registry_image_versions (user_id, image_repo, tag, latest_digest) VALUES
		(1, 'r/a',  '1.0', 'sha256:bbb'),
		(1, 'r/b',  '1.0', 'sha256:ddd'),
		(1, 'library/x', '1.0', 'sha256:e2'),
		(1, 'r/d',  '1.0', 'sha256:h2'),
		(1, 'r/e',  '2.0', 'sha256:i2')`)
	seed(`INSERT INTO containers (id, user_id, container_id, container_name, deployed_image_id) VALUES
		(1, 1, 'c1', 'one', 1), (2, 1, 'c2', 'two', 2), (3, 1, 'c3', 'three', 3),
		(4, 1, 'c4', 'four', 4), (5, 1, 'c5', 'five', 5), (6, 1, 'c6', 'six', NULL)`)

	rows, err := GetContainers(ctx, database, 1)
	if err != nil {
		t.Fatalf("GetContainers: %v", err)
	}
	seen := map[int64]bool{}
	count := 0
	for i := range rows {
		if seen[rows[i].ID] {
			continue
		}
		seen[rows[i].ID] = true
		if ContainerHasUpdate(rows[i]) {
			count++
		}
	}
	// c1 repo_digests current -> no; c2 differs -> yes; c3 docker.io join +
	// differs -> yes; c4 no repo_digests but a differing current digest -> yes
	// (fallback comparison); c5 wrong-tag riv -> no.
	if count != 3 {
		t.Errorf("withUpdates = %d, want 3", count)
	}
}

// The deployed_images -> registry_image_versions join must canonicalize the
// docker.io hub prefix ONLY as a prefix. The old REPLACE/OR form also stripped
// the prefix from the middle of a repository name and truncated registry-hosted
// repos at their first colon, so "localhost:5000/app" joined the hub row for
// "localhost" and "mydocker.io/x" joined "myx" - a container then showed
// another image's update.
func TestContainersQueryCanonicalRepoJoin(t *testing.T) {
	database := testDB(t)
	minimalContainersSchema(t, database)
	ctx := context.Background()

	seed := func(q string, args ...any) {
		t.Helper()
		if _, err := database.ExecContext(ctx, q, args...); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
	seed(`INSERT INTO deployed_images (id, user_id, image_repo, image_tag, image_digest, repo_digests) VALUES
		(1, 1, 'localhost:5000/app', '1.0', 'sha256:a1', '["sha256:a1"]'),
		(2, 1, 'mydocker.io/x',      '1.0', 'sha256:b1', '["sha256:b1"]'),
		(3, 1, 'docker.io/library/nginx', '1.0', 'sha256:c1', '["sha256:c1"]')`)
	seed(`INSERT INTO registry_image_versions (user_id, image_repo, tag, latest_digest) VALUES
		(1, 'localhost',        '1.0', 'sha256:WRONG'),
		(1, 'myx',              '1.0', 'sha256:WRONG'),
		(1, 'localhost:5000/app', '1.0', 'sha256:a2'),
		(1, 'library/nginx',    '1.0', 'sha256:c2')`)
	seed(`INSERT INTO containers (id, user_id, container_id, container_name, deployed_image_id) VALUES
		(1, 1, 'c1', 'registry-hosted', 1),
		(2, 1, 'c2', 'lookalike', 2),
		(3, 1, 'c3', 'hub', 3)`)

	rows, err := GetContainers(ctx, database, 1)
	if err != nil {
		t.Fatalf("GetContainers: %v", err)
	}
	latest := map[string]string{}
	for _, r := range rows {
		latest[r.ContainerName] = r.LatestDigest.String
	}
	if got := latest["registry-hosted"]; got != "sha256:a2" {
		t.Errorf("localhost:5000/app joined %q, want its own registry row", got)
	}
	if got := latest["lookalike"]; got != "" {
		t.Errorf("mydocker.io/x joined %q, want no registry row", got)
	}
	if got := latest["hub"]; got != "sha256:c2" {
		t.Errorf("docker.io/library/nginx joined %q, want the hub row (prefix strip)", got)
	}
}
