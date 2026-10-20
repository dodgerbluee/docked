package graph

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/dockedapp/backend/internal/db"
)

func newContainerDataGraphDB(t *testing.T) *sql.DB {
	t.Helper()
	database, err := db.Open(filepath.Join(t.TempDir(), "containerdata.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	stmts := []string{
		`CREATE TABLE runners (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, url TEXT)`,
		`CREATE TABLE source_instances (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			name TEXT NOT NULL,
			url TEXT NOT NULL
		)`,
		`CREATE TABLE deployed_images (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			image_repo TEXT NOT NULL,
			image_tag TEXT,
			image_digest TEXT,
			image_created_date TEXT,
			registry TEXT,
			repo_digests TEXT,
			last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE registry_image_versions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			image_repo TEXT NOT NULL,
			tag TEXT NOT NULL,
			latest_digest TEXT,
			latest_version TEXT,
			latest_publish_date TEXT,
			provider TEXT,
			last_checked DATETIME DEFAULT CURRENT_TIMESTAMP
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
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`INSERT INTO source_instances (id, user_id, name, url) VALUES (1, 1, 'toybox', 'https://portainer.example')`,
		// Out-of-date image: the latest digest is not among the container's repo digests.
		`INSERT INTO deployed_images (id, user_id, image_repo, image_tag, image_digest, repo_digests, registry) VALUES
			(10, 1, 'ghcr.io/foo/app', '1.2.3', 'sha256:aaa', '["sha256:aaa"]', 'ghcr')`,
		`INSERT INTO registry_image_versions (id, user_id, image_repo, tag, latest_digest) VALUES
			(20, 1, 'ghcr.io/foo/app', '1.2.3', 'sha256:bbb')`,
		// Two containers share one image; the third has no deployed_image row so
		// its tag falls back to the image_name segment; the fourth has an empty
		// image_repo and is excluded from the grouped entries.
		`INSERT INTO containers (id, user_id, source_instance_id, container_id, container_name, endpoint_id, image_name, image_repo, deployed_image_id, last_seen, updated_at) VALUES
			(1, 1, 1, 'aaa111111111', 'app', 2, 'ghcr.io/foo/app:1.2.3', 'ghcr.io/foo/app', 10, '2026-01-04 00:00:00', '2026-01-04 00:00:00'),
			(2, 1, 1, 'bbb222222222', 'sidecar', 2, 'ghcr.io/foo/app:1.2.3', 'ghcr.io/foo/app', 10, '2026-01-03 00:00:00', '2026-01-03 00:00:00'),
			(3, 1, 1, 'ccc333333333', 'legacy', 2, 'nginx:1.2', 'nginx', NULL, '2026-01-02 00:00:00', '2026-01-02 00:00:00'),
			(4, 1, 1, 'ddd444444444', 'norepo', 2, 'scratch', '', NULL, '2026-01-01 00:00:00', '2026-01-01 00:00:00')`,
	}
	for _, stmt := range stmts {
		if _, err := database.Exec(stmt); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
	return database
}

func entriesByKey(entries []map[string]any) map[string]map[string]any {
	byKey := make(map[string]map[string]any, len(entries))
	for _, entry := range entries {
		key, _ := entry["key"].(string)
		byKey[key] = entry
	}
	return byKey
}

func TestBuildContainerDataEntries(t *testing.T) {
	database := newContainerDataGraphDB(t)

	entries, err := buildContainerDataEntries(context.Background(), database, 1)
	if err != nil {
		t.Fatalf("buildContainerDataEntries: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("got %d entries, want 2 (empty image_repo excluded): %#v", len(entries), entries)
	}

	app := entriesByKey(entries)["image-ghcr.io/foo/app:1.2.3"]
	if app == nil {
		t.Fatalf("missing app entry, keys: %#v", entries)
	}
	if app["containerCount"] != 2 {
		t.Fatalf("containerCount = %v, want 2", app["containerCount"])
	}
	names, _ := app["containerNames"].([]string)
	if len(names) != 2 || names[0] != "app" || names[1] != "sidecar" {
		t.Fatalf("containerNames = %#v", app["containerNames"])
	}
	// updatedAt comes from the first container of the group (last_seen DESC order).
	if app["updatedAt"] != "2026-01-04T00:00:00Z" {
		t.Fatalf("updatedAt = %v", app["updatedAt"])
	}

	data, _ := app["data"].(map[string]any)
	if data == nil {
		t.Fatalf("entry has no data map: %#v", app)
	}
	if data["hasUpdate"] != true {
		t.Fatalf("hasUpdate = %v, want true (latest digest not in repoDigests)", data["hasUpdate"])
	}
	if data["currentDigest"] != "sha256:aaa" || data["latestDigest"] != "sha256:bbb" {
		t.Fatalf("digest fields = %v / %v", data["currentDigest"], data["latestDigest"])
	}
	containers, _ := data["containers"].([]map[string]any)
	if len(containers) != 2 {
		t.Fatalf("data.containers = %#v", data["containers"])
	}
	if containers[0]["sourceInstanceId"] != int64(1) {
		t.Fatalf("sourceInstanceId not carried: %#v", containers[0])
	}
	if _, ok := containers[0]["portainerName"]; ok {
		t.Fatalf("portainerName key should be gone: %#v", containers[0])
	}
	if containers[0]["deployedImageId"] != int64(10) {
		t.Fatalf("deployedImageId = %#v", containers[0]["deployedImageId"])
	}
	if containers[0]["repoDigests"] != `["sha256:aaa"]` {
		t.Fatalf("repoDigests = %#v", containers[0]["repoDigests"])
	}

	legacy := entriesByKey(entries)["image-nginx:1.2"]
	if legacy == nil {
		t.Fatalf("missing nginx entry, keys: %#v", entries)
	}
	legacyData, _ := legacy["data"].(map[string]any)
	if legacy["imageTag"] != "1.2" || legacyData["currentVersion"] != "1.2" {
		t.Fatalf("tag fallback from image_name failed: %#v / %#v", legacy["imageTag"], legacyData["currentVersion"])
	}
	if legacyData["hasUpdate"] != false {
		t.Fatalf("hasUpdate should be false without registry data, got %v", legacyData["hasUpdate"])
	}
}

func TestCorrelateRecordsByImage(t *testing.T) {
	database := newContainerDataGraphDB(t)

	raw, err := db.GetRawDatabaseRecords(context.Background(), database, 1)
	if err != nil {
		t.Fatalf("GetRawDatabaseRecords: %v", err)
	}
	correlated := correlateRecordsByImage(raw)

	// Containers key their group by image_repo plus a "latest" tag (the legacy
	// helper ignores image_name once a repo is present); the deployed_images row
	// forms its own repo:tag group, and the container's deployed_image_id pulls
	// that row into the container group as well.
	app := correlated["ghcr.io/foo/app:latest"]
	if app == nil {
		t.Fatalf("missing app correlation, keys: %#v", correlated)
	}
	appGroup, _ := app.(map[string]any)
	summary, _ := appGroup["summary"].(map[string]any)
	if summary["containerCount"] != 2 || summary["deployedImageCount"] != 1 {
		t.Fatalf("app summary = %#v", appGroup["summary"])
	}
	if versions, _ := appGroup["registryVersions"].([]map[string]any); len(versions) != 1 {
		t.Fatalf("registryVersions = %#v", appGroup["registryVersions"])
	}
	if _, ok := appGroup["portainerInstances"]; ok {
		t.Fatalf("portainerInstances key should be gone: %#v", appGroup)
	}

	// registry_image_versions with no matching group fall back to a repo-only entry.
	raw["registry_image_versions"] = []map[string]any{
		{"id": int64(99), "image_repo": "docker.io/library/unifi", "tag": "latest"},
	}
	correlated = correlateRecordsByImage(raw)
	orphan, _ := correlated["docker.io/library/unifi:*"].(map[string]any)
	if orphan == nil {
		t.Fatalf("expected a repo-only entry, keys: %#v", correlated)
	}
	if versions, _ := orphan["registryVersions"].([]map[string]any); len(versions) != 1 {
		t.Fatalf("orphan registryVersions = %#v", orphan["registryVersions"])
	}
}
