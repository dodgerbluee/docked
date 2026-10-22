package db

import (
	"context"
	"database/sql"
	"testing"
)

// Marking a tracked app upgraded must advance the digest baseline to the
// observed latest digest. The docker check compares digests FIRST; leaving a
// stale current_digest made has_update flip back to true on the very next
// scan of an unchanged image.
func TestSetTrackedAppCurrentVersionAdvancesDigestBaseline(t *testing.T) {
	database, err := Open(t.TempDir() + "/ta.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer database.Close()
	ctx := context.Background()
	if err := Migrate(ctx, database); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	var id int64
	err = database.QueryRowContext(ctx,
		`INSERT INTO tracked_apps (user_id, name, image_name, source_type,
		    current_version, current_digest, latest_version, latest_digest, has_update)
		 VALUES (1, 'app', 'example/app:latest', 'docker',
		    'v1', 'sha256:old', 'v2', 'sha256:new', 1)
		 RETURNING id`).Scan(&id)
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	if err := SetTrackedAppCurrentVersion(ctx, database, id, 1, "v2", "v2", nil); err != nil {
		t.Fatalf("set current version: %v", err)
	}

	var currentDigest sql.NullString
	var hasUpdate int
	if err := database.QueryRowContext(ctx,
		`SELECT current_digest, has_update FROM tracked_apps WHERE id = ?`, id).
		Scan(&currentDigest, &hasUpdate); err != nil {
		t.Fatalf("read: %v", err)
	}
	if currentDigest.String != "sha256:new" || !currentDigest.Valid {
		t.Errorf("current_digest = %v, want sha256:new (baseline must follow the acknowledged version)", currentDigest)
	}
	if hasUpdate != 0 {
		t.Errorf("has_update = %d, want 0", hasUpdate)
	}
}

// With no observed latest digest the stale baseline must be invalidated
// (NULL), so the check falls back to version comparison instead of
// comparing against a digest from a previous release.
func TestSetTrackedAppCurrentVersionClearsStaleDigestWithoutLatest(t *testing.T) {
	database, err := Open(t.TempDir() + "/ta2.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer database.Close()
	ctx := context.Background()
	if err := Migrate(ctx, database); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	var id int64
	err = database.QueryRowContext(ctx,
		`INSERT INTO tracked_apps (user_id, name, image_name, source_type,
		    current_version, current_digest, latest_version, latest_digest, has_update)
		 VALUES (1, 'app', 'example/app:latest', 'docker',
		    'v1', 'sha256:old', 'v2', NULL, 1)
		 RETURNING id`).Scan(&id)
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	if err := SetTrackedAppCurrentVersion(ctx, database, id, 1, "v2", "v2", nil); err != nil {
		t.Fatalf("set current version: %v", err)
	}

	var currentDigest sql.NullString
	if err := database.QueryRowContext(ctx,
		`SELECT current_digest FROM tracked_apps WHERE id = ?`, id).Scan(&currentDigest); err != nil {
		t.Fatalf("read: %v", err)
	}
	if currentDigest.Valid {
		t.Errorf("current_digest = %q, want NULL (stale baseline must be invalidated)", currentDigest.String)
	}
}
