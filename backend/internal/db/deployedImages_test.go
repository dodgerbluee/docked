package db

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
)

func unusedIDs(t *testing.T, database *sql.DB, userID int64) map[int64]bool {
	t.Helper()
	rows, err := GetUnusedImages(context.Background(), database, userID)
	if err != nil {
		t.Fatalf("GetUnusedImages: %v", err)
	}
	got := make(map[int64]bool, len(rows))
	for _, r := range rows {
		got[r.ID] = true
	}
	return got
}

// unusedImagesSchema reuses the shared minimal fixture and adds the
// deployed_images columns GetUnusedImages selects.
func unusedImagesSchema(t *testing.T, database *sql.DB) {
	t.Helper()
	minimalContainersSchema(t, database)
	for _, col := range []string{"namespace", "repository", "last_seen"} {
		if _, err := database.Exec("ALTER TABLE deployed_images ADD COLUMN " + col + " TEXT"); err != nil {
			t.Fatalf("add column %s: %v", col, err)
		}
	}
}

// The exclusion must follow containers.deployed_image_id, not image_repo.
// Repo-only matching hid every row belonging to a repo that still had a
// container on some other tag, so genuinely unused rows never surfaced and
// unusedImagesCount under-reported.
func TestGetUnusedImagesUsesDeployedImageLink(t *testing.T) {
	database, err := Open(filepath.Join(t.TempDir(), "unused.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	unusedImagesSchema(t, database)

	seed := func(q string, args ...any) {
		t.Helper()
		if _, err := database.Exec(q, args...); err != nil {
			t.Fatalf("seed %q: %v", q, err)
		}
	}

	// Two rows for the same repo: 1 is in use, 2 is a stale tag.
	seed(`INSERT INTO deployed_images (id, user_id, image_repo, image_tag) VALUES
		(1, 7, 'nginx', '1.25'), (2, 7, 'nginx', '1.24'),
		(3, 7, 'redis', '7'), (4, 7, 'redis', '6')`)

	// Container linked to row 1 only.
	seed(`INSERT INTO containers (id, user_id, container_id, container_name, image_repo, deployed_image_id)
		VALUES (10, 7, 'abc', 'web', 'nginx', 1)`)
	// Container with no link at all, still referencing redis by repo.
	seed(`INSERT INTO containers (id, user_id, container_id, container_name, image_repo, deployed_image_id)
		VALUES (11, 7, 'def', 'cache', 'redis', NULL)`)

	got := unusedIDs(t, database, 7)

	// Row 2 is unused even though the repo is still deployed elsewhere.
	if !got[2] {
		t.Fatalf("stale tag row 2 should be unused, got %v", got)
	}
	// Row 1 is linked and must stay excluded.
	if got[1] {
		t.Errorf("linked row 1 must not be reported unused: %v", got)
	}
	// The unlinked container keeps both redis rows suppressed: without a link
	// there is nothing more precise to compare against.
	if got[3] || got[4] {
		t.Errorf("repo fallback should keep unlinked redis rows excluded: %v", got)
	}

	// A different user's rows must never leak in.
	seed(`INSERT INTO deployed_images (id, user_id, image_repo, image_tag) VALUES (9, 8, 'solo', '1')`)
	if unusedIDs(t, database, 7)[9] {
		t.Errorf("row owned by another user was returned")
	}
	if !unusedIDs(t, database, 8)[9] {
		t.Errorf("owner 8 should see its own unused row")
	}
}

// A NULL last_seen used to abort the whole query: DeployedImageRow.LastSeen is
// a plain string, so one legacy row without a timestamp made every unused image
// disappear (both callers discard the error).
func TestGetUnusedImagesToleratesNullLastSeen(t *testing.T) {
	database, err := Open(filepath.Join(t.TempDir(), "unused-null.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	unusedImagesSchema(t, database)

	if _, err := database.Exec(`INSERT INTO deployed_images (id, user_id, image_repo, image_tag, last_seen)
		VALUES (1, 7, 'nginx', 'latest', NULL), (2, 7, 'redis', '7', '2026-01-01 00:00:00')`); err != nil {
		t.Fatalf("seed images: %v", err)
	}

	rows, err := GetUnusedImages(context.Background(), database, 7)
	if err != nil {
		t.Fatalf("GetUnusedImages: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("want both rows unused, got %d", len(rows))
	}
	for _, r := range rows {
		if r.ID == 1 && r.LastSeen != "" {
			t.Errorf("NULL last_seen should scan as empty string, got %q", r.LastSeen)
		}
		if r.ID == 2 && r.LastSeen == "" {
			t.Errorf("stored last_seen was lost")
		}
	}
}
