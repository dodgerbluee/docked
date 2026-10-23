package db

import (
	"context"
	"database/sql"
	"fmt"
	"path/filepath"
	"testing"
)

func repoTokensSchema(t *testing.T, database *sql.DB) {
	t.Helper()
	_, err := database.Exec(`CREATE TABLE repository_access_tokens (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		provider TEXT NOT NULL CHECK(provider IN ('github', 'gitlab')),
		name TEXT NOT NULL,
		access_token TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(user_id, provider, name)
	)`)
	if err != nil {
		t.Fatalf("create schema: %v", err)
	}
	// DeleteRepositoryToken clears the references these two tables hold. The
	// real schema has many more columns; only these are read by the clears.
	if _, err := database.Exec(`CREATE TABLE deployed_images (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		image_repo TEXT,
		repository_token_id INTEGER,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`); err != nil {
		t.Fatalf("create deployed_images: %v", err)
	}
	if _, err := database.Exec(`CREATE TABLE tracked_apps (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		user_id INTEGER NOT NULL,
		name TEXT NOT NULL,
		repository_token_id INTEGER,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`); err != nil {
		t.Fatalf("create tracked_apps: %v", err)
	}
}

// SQLite leaves last_insert_rowid() untouched when an upsert takes the
// DO UPDATE branch, so the id returned from res.LastInsertId() was whatever a
// previous INSERT happened to leave on that pooled connection.
func TestUpsertRepositoryTokenReturnsStableID(t *testing.T) {
	database, err := Open(filepath.Join(t.TempDir(), "tokens.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	repoTokensSchema(t, database)
	ctx := context.Background()

	// An unrelated insert first, to poison last_insert_rowid().
	if _, err := database.Exec(`INSERT INTO repository_access_tokens (user_id, provider, name, access_token)
		VALUES (99, 'github', 'decoy', 'x')`); err != nil {
		t.Fatalf("seed decoy: %v", err)
	}

	first, err := UpsertRepositoryToken(ctx, database, 7, "github", "default", "tok-a")
	if err != nil {
		t.Fatalf("first upsert: %v", err)
	}
	second, err := UpsertRepositoryToken(ctx, database, 7, "github", "default", "tok-b")
	if err != nil {
		t.Fatalf("second upsert: %v", err)
	}
	if first != second {
		t.Errorf("upsert changed the row id: %d then %d", first, second)
	}
	if second == 1 {
		t.Errorf("upsert reported the decoy row's id")
	}

	row, err := GetRepositoryTokenByProvider(ctx, database, 7, "github")
	if err != nil || row == nil {
		t.Fatalf("token missing after upsert: %v", err)
	}
	if row.ID != first {
		t.Errorf("stored row id %d does not match reported id %d", row.ID, first)
	}
	if row.AccessToken != "tok-b" {
		t.Errorf("upsert did not replace the token, got %q", row.AccessToken)
	}
}

// A delete that matches nothing must be distinguishable from one that worked:
// the resolver reports success:false so the UI stops removing a card that was
// never touched.
func TestDeleteRepositoryTokenReportsRowsRemoved(t *testing.T) {
	database, err := Open(filepath.Join(t.TempDir(), "tokens-del.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	repoTokensSchema(t, database)
	ctx := context.Background()

	id, err := UpsertRepositoryToken(ctx, database, 7, "gitlab", "default", "tok")
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}

	// Another user's id must not be deletable.
	if n, err := DeleteRepositoryToken(ctx, database, id, 8); err != nil || n != 0 {
		t.Errorf("cross-user delete affected %d rows, err %v", n, err)
	}
	if n, err := DeleteRepositoryToken(ctx, database, 9999, 7); err != nil || n != 0 {
		t.Errorf("delete of a missing id affected %d rows, err %v", n, err)
	}
	if n, err := DeleteRepositoryToken(ctx, database, id, 7); err != nil || n != 1 {
		t.Errorf("owner delete affected %d rows, err %v", n, err)
	}
	if row, err := GetRepositoryTokenByID(ctx, database, 7, id); err != nil || row != nil {
		t.Errorf("token still present after delete: %v %v", row, err)
	}
}

// PRAGMA foreign_keys is OFF, so the schema's ON DELETE behaviour never fires
// and a deleted token leaves deployed_images/tracked_apps pointing at it. The
// image still looks associated, so its release lookups keep asking for a token
// that no longer exists instead of falling back to an unauthenticated request.
func TestDeleteRepositoryTokenClearsReferences(t *testing.T) {
	database, err := Open(filepath.Join(t.TempDir(), "tokens-refs.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	repoTokensSchema(t, database)
	ctx := context.Background()

	id, err := UpsertRepositoryToken(ctx, database, 7, "github", "default", "tok")
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}
	other, err := UpsertRepositoryToken(ctx, database, 8, "github", "default", "tok8")
	if err != nil {
		t.Fatalf("upsert other user: %v", err)
	}

	seed := func(q string, args ...any) {
		t.Helper()
		if _, err := database.ExecContext(ctx, q, args...); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
	seed(`INSERT INTO deployed_images (user_id, image_repo, repository_token_id)
	      VALUES (7, 'repo-a', ?), (7, NULL, ?), (8, 'repo-b', ?)`, id, id, other)
	seed(`INSERT INTO tracked_apps (user_id, name, repository_token_id)
	      VALUES (7, 'app-a', ?), (8, 'app-b', ?)`, id, other)

	if n, err := DeleteRepositoryToken(ctx, database, id, 7); err != nil || n != 1 {
		t.Fatalf("delete affected %d rows, err %v", n, err)
	}

	for _, table := range []string{"deployed_images", "tracked_apps"} {
		var dangling int
		q := fmt.Sprintf(
			"SELECT COUNT(*) FROM %s WHERE user_id = 7 AND repository_token_id IS NOT NULL", table)
		if err := database.QueryRowContext(ctx, q).Scan(&dangling); err != nil {
			t.Fatalf("count dangling %s: %v", table, err)
		}
		if dangling != 0 {
			t.Errorf("%s keeps %d reference(s) to the deleted token", table, dangling)
		}
		// The other user's association must survive.
		var kept int
		q = fmt.Sprintf(
			"SELECT COUNT(*) FROM %s WHERE user_id = 8 AND repository_token_id = ?", table)
		if err := database.QueryRowContext(ctx, q, other).Scan(&kept); err != nil {
			t.Fatalf("count kept %s: %v", table, err)
		}
		if kept != 1 {
			t.Errorf("%s kept %d reference(s) for the other user, want 1", table, kept)
		}
	}
}
