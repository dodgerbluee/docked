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

	snapshot := TrackedAppSnapshot{
		LatestVersion: sql.NullString{String: "v2", Valid: true},
		LatestDigest:  sql.NullString{String: "sha256:new", Valid: true},
	}
	applied, err := SetTrackedAppCurrentVersion(ctx, database, id, 1, "v2", "v2", snapshot, nil, false)
	if err != nil {
		t.Fatalf("set current version: %v", err)
	}
	if !applied {
		t.Fatalf("write did not apply: the observed snapshot matches the row")
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

	snapshot := TrackedAppSnapshot{LatestVersion: sql.NullString{String: "v2", Valid: true}}
	applied, err := SetTrackedAppCurrentVersion(ctx, database, id, 1, "v2", "v2", snapshot, nil, false)
	if err != nil {
		t.Fatalf("set current version: %v", err)
	}
	if !applied {
		t.Fatalf("write did not apply: the observed snapshot matches the row")
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

// A scan can land between the client rendering the card and the user confirming
// the upgrade. Confirming against the stale observation must not write: the
// unguarded version of this write set current_digest from whatever the column
// held at that moment (the newer release's digest) and rewrote latest_version
// back to the stale value, so the app read as up to date while it was behind.
func TestSetTrackedAppCurrentVersionRejectsStaleObservation(t *testing.T) {
	database, err := Open(t.TempDir() + "/ta3.db")
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
		    'v1', 'sha256:old', 'v3', 'sha256:new3', 1)
		 RETURNING id`).Scan(&id)
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	// What the user was shown before the scan moved it.
	stale := TrackedAppSnapshot{
		LatestVersion: sql.NullString{String: "v2", Valid: true},
		LatestDigest:  sql.NullString{String: "sha256:new2", Valid: true},
	}
	applied, err := SetTrackedAppCurrentVersion(ctx, database, id, 1, "v2", "v2", stale, nil, false)
	if err != nil {
		t.Fatalf("set current version: %v", err)
	}
	if applied {
		t.Errorf("write applied against a stale observation")
	}

	var currentVersion, latestVersion, latestDigest string
	var hasUpdate int
	err = database.QueryRowContext(ctx,
		`SELECT current_version, latest_version, latest_digest, has_update FROM tracked_apps WHERE id = ?`, id).
		Scan(&currentVersion, &latestVersion, &latestDigest, &hasUpdate)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if currentVersion != "v1" || latestVersion != "v3" || latestDigest != "sha256:new3" {
		t.Errorf("stale write changed observed state: %q / %q / %q", currentVersion, latestVersion, latestDigest)
	}
	if hasUpdate != 1 {
		t.Errorf("has_update = %d, want 1 (the newer release must stay flagged)", hasUpdate)
	}
}

// The source-identity columns decide WHICH upstream an observation came from,
// so they belong to the guard. Without them a check that read a GitHub row and
// then had the user switch the app to another source (or rename its image)
// still passed the digest-shaped guard and filed the old source's release data
// under a row that now describes something else.
func TestUpdateTrackedAppFieldsRejectsSourceEdit(t *testing.T) {
	database, err := Open(t.TempDir() + "/ta4.db")
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
		`INSERT INTO tracked_apps (user_id, name, image_name, source_type, github_repo,
		    current_version, latest_version, latest_digest, has_update)
		 VALUES (1, 'app', 'example/app:latest', 'github', 'acme/app',
		    'v1', 'v2', 'sha256:new', 1)
		 RETURNING id`).Scan(&id)
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	row, err := GetTrackedAppByID(ctx, database, id, 1)
	if err != nil || row == nil {
		t.Fatalf("load: %v", err)
	}
	snapshot := row.ObservedSnapshot()

	if _, err := database.ExecContext(ctx,
		`UPDATE tracked_apps SET source_type = 'gitlab', github_repo = 'grp/other' WHERE id = ?`, id); err != nil {
		t.Fatalf("source edit: %v", err)
	}

	applied, err := UpdateTrackedAppFields(ctx, database, id, 1,
		map[string]any{"latest_version": "v9", "has_update": 1}, snapshot)
	if err != nil {
		t.Fatalf("update fields: %v", err)
	}
	if applied {
		t.Errorf("write applied after the row's source changed underneath the check")
	}

	var sourceType, latestVersion string
	err = database.QueryRowContext(ctx,
		`SELECT source_type, latest_version FROM tracked_apps WHERE id = ?`, id).Scan(&sourceType, &latestVersion)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if latestVersion != "v2" {
		t.Errorf("latest_version = %q, want v2: the old source's release must not land on the edited row", latestVersion)
	}
}
