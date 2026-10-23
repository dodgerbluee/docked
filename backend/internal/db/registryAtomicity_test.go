package db

import (
	"context"
	"sync"
	"testing"
)

// GetRegistryData's single-row lookup must prefer the exact tag over the
// NULL-tag fallback, the same precedence RegistryDataMap.Get applies. Without
// an ORDER BY the row that wins is whichever row SQLite happens to scan first,
// so a repo with both rows can report the tag-agnostic version for a
// tag-specific container.
func TestGetRegistryDataPrefersExactTag(t *testing.T) {
	database := newMigratedTestDB(t)
	ctx := context.Background()

	// NULL-tag row inserted FIRST: an unordered LIMIT 1 scan returns it.
	seed := []struct {
		repo string
		tag  any
		ver  string
	}{
		{"ghcr.io/a", nil, "fallback"},
		{"ghcr.io/a", "1.0", "exact"},
	}
	for _, s := range seed {
		if _, err := database.ExecContext(ctx,
			`INSERT INTO registry_image_versions (user_id, image_repo, registry, repository, tag, latest_version)
			 VALUES (1, ?, 'ghcr', 'repo', ?, ?)`,
			s.repo, s.tag, s.ver); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	got, err := GetRegistryData(ctx, database, 1, "ghcr.io/a", "1.0")
	if err != nil {
		t.Fatalf("get registry data: %v", err)
	}
	if got.LatestVersion.String != "exact" {
		t.Errorf("GetRegistryData(ghcr.io/a, 1.0) latest_version = %q, want %q (exact tag must win)",
			got.LatestVersion.String, "exact")
	}

	// The fallback still answers when no exact-tag row exists.
	got, err = GetRegistryData(ctx, database, 1, "ghcr.io/a", "9.9")
	if err != nil {
		t.Fatalf("get registry data (fallback): %v", err)
	}
	if got.LatestVersion.String != "fallback" {
		t.Errorf("fallback lookup = %q, want %q", got.LatestVersion.String, "fallback")
	}

	// And the map agrees with the single-row query in both directions.
	m, err := GetRegistryDataMap(ctx, database, 1)
	if err != nil {
		t.Fatalf("get map: %v", err)
	}
	if d := m.Get("ghcr.io/a", "1.0"); d == nil || d.LatestVersion.String != "exact" {
		t.Errorf("map disagrees with GetRegistryData: %+v", d)
	}
}

// AssociateImagesWithToken replaces a token's image associations with two
// statements (clear, then set). Two concurrent replacements interleave into
// the union of both lists; the replacement must be one write transaction so
// the final state is exactly the last committed list.
func TestAssociateImagesWithTokenIsAtomic(t *testing.T) {
	database := newMigratedTestDB(t)
	ctx := context.Background()

	seed := []string{
		`INSERT INTO repository_access_tokens (id, user_id, provider, name, access_token) VALUES (1, 1, 'github', 'default', 'tok')`,
		`INSERT INTO deployed_images (id, user_id, image_repo, image_tag) VALUES (10, 1, 'ghcr.io/a/one', '1.0')`,
		`INSERT INTO deployed_images (id, user_id, image_repo, image_tag) VALUES (11, 1, 'ghcr.io/b/two', '1.0')`,
	}
	for _, s := range seed {
		if _, err := database.ExecContext(ctx, s); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	listA := []string{"ghcr.io/a/one"}
	listB := []string{"ghcr.io/b/two"}

	const iterations = 60
	for i := 0; i < iterations; i++ {
		if _, err := database.ExecContext(ctx,
			"UPDATE deployed_images SET repository_token_id = NULL WHERE user_id = 1"); err != nil {
			t.Fatalf("reset: %v", err)
		}

		start := make(chan struct{})
		var wg sync.WaitGroup
		for _, list := range [][]string{listA, listB} {
			wg.Add(1)
			go func(list []string) {
				defer wg.Done()
				<-start
				if err := AssociateImagesWithToken(ctx, database, 1, 1, list); err != nil {
					t.Errorf("associate: %v", err)
				}
			}(list)
		}
		close(start)
		wg.Wait()

		repos, err := GetAssociatedImages(ctx, database, 1, 1)
		if err != nil {
			t.Fatalf("associated: %v", err)
		}
		if len(repos) != 1 {
			t.Fatalf("iteration %d: associated repos = %v, want exactly one list (interleaved replacement produced a union)", i, repos)
		}
		if repos[0] != listA[0] && repos[0] != listB[0] {
			t.Fatalf("iteration %d: associated repo = %q, want one of %q/%q", i, repos[0], listA[0], listB[0])
		}
	}
}

// Replace semantics still hold for a single caller: the old list is cleared
// and the new list set, and an empty list clears everything.
func TestAssociateImagesWithTokenReplaces(t *testing.T) {
	database := newMigratedTestDB(t)
	ctx := context.Background()

	seed := []string{
		`INSERT INTO repository_access_tokens (id, user_id, provider, name, access_token) VALUES (1, 1, 'github', 'default', 'tok')`,
		`INSERT INTO deployed_images (id, user_id, image_repo, image_tag) VALUES (10, 1, 'ghcr.io/a/one', '1.0')`,
		`INSERT INTO deployed_images (id, user_id, image_repo, image_tag) VALUES (11, 1, 'ghcr.io/b/two', '1.0')`,
	}
	for _, s := range seed {
		if _, err := database.ExecContext(ctx, s); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	if err := AssociateImagesWithToken(ctx, database, 1, 1, []string{"ghcr.io/a/one", "ghcr.io/b/two"}); err != nil {
		t.Fatalf("associate both: %v", err)
	}
	if repos, err := GetAssociatedImages(ctx, database, 1, 1); err != nil || len(repos) != 2 {
		t.Fatalf("both = %v (%v), want 2 associations", repos, err)
	}

	if err := AssociateImagesWithToken(ctx, database, 1, 1, []string{"ghcr.io/a/one"}); err != nil {
		t.Fatalf("associate one: %v", err)
	}
	repos, err := GetAssociatedImages(ctx, database, 1, 1)
	if err != nil || len(repos) != 1 || repos[0] != "ghcr.io/a/one" {
		t.Fatalf("after replace = %v (%v), want only ghcr.io/a/one", repos, err)
	}

	if err := AssociateImagesWithToken(ctx, database, 1, 1, nil); err != nil {
		t.Fatalf("clear: %v", err)
	}
	if repos, err := GetAssociatedImages(ctx, database, 1, 1); err != nil || len(repos) != 0 {
		t.Fatalf("after clear = %v (%v), want none", repos, err)
	}
}
