package db

import (
	"context"
	"testing"
)

// GetRegistryDataMap must mirror GetRegistryData's match semantics: exact
// repo+tag first, then a tag-agnostic (NULL tag) row, and never leak rows
// across users.
func TestRegistryDataMapMatchesGetRegistryData(t *testing.T) {
	database := newMigratedTestDB(t)
	ctx := context.Background()

	seed := []struct {
		userID int64
		repo   string
		tag    any // string or nil
		ver    string
	}{
		{1, "ghcr.io/a", "1.0", "v1.0"},
		{1, "ghcr.io/a", "2.0", "v2.0"},
		{1, "ghcr.io/b", nil, "v9"},
		{2, "ghcr.io/a", "1.0", "other-user"},
	}
	for _, s := range seed {
		if _, err := database.ExecContext(ctx,
			`INSERT INTO registry_image_versions (user_id, image_repo, registry, repository, tag, latest_version)
			 VALUES (?, ?, 'docker.io', 'repo', ?, ?)`,
			s.userID, s.repo, s.tag, s.ver); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	m, err := GetRegistryDataMap(ctx, database, 1)
	if err != nil {
		t.Fatalf("get map: %v", err)
	}

	cases := []struct {
		repo, tag, want string
	}{
		{"ghcr.io/a", "1.0", "v1.0"},    // exact tag
		{"ghcr.io/a", "2.0", "v2.0"},    // different exact tag
		{"ghcr.io/a", "3.0", ""},        // no exact, no fallback row
		{"ghcr.io/b", "anything", "v9"}, // NULL-tag fallback
		{"ghcr.io/missing", "1.0", ""},  // no rows at all
	}
	for _, c := range cases {
		d := m.Get(c.repo, c.tag)
		got := ""
		if d != nil {
			got = d.LatestVersion.String
		}
		if got != c.want {
			t.Errorf("Get(%q, %q) latest_version = %q, want %q", c.repo, c.tag, got, c.want)
		}
		// Same answer the single-row query gives.
		q, err := GetRegistryData(ctx, database, 1, c.repo, c.tag)
		if err != nil {
			t.Fatalf("GetRegistryData(%q, %q): %v", c.repo, c.tag, err)
		}
		if q.LatestVersion.String != got {
			t.Errorf("Get(%q, %q) = %q but GetRegistryData = %q", c.repo, c.tag, got, q.LatestVersion.String)
		}
	}

	// User isolation: user 2 sees only their row.
	m2, err := GetRegistryDataMap(ctx, database, 2)
	if err != nil {
		t.Fatalf("get map user2: %v", err)
	}
	if d := m2.Get("ghcr.io/a", "1.0"); d == nil || d.LatestVersion.String != "other-user" {
		t.Errorf("user 2 lookup leaked or missed: %+v", d)
	}
	if d := m2.Get("ghcr.io/b", "x"); d != nil {
		t.Errorf("user 2 saw user 1's fallback row: %+v", d)
	}
}

// Live Docker refs may carry the docker.io host ("docker.io/library/nginx")
// while scans store Hub repos without it ("library/nginx") — and legacy rows
// may have it. Both sides must canonicalize, or live enrichment misses and
// hasUpdate goes false despite stored update data.
func TestRegistryDataMapDockerHostCanonicalization(t *testing.T) {
	database := newMigratedTestDB(t)
	ctx := context.Background()

	seed := []struct {
		repo string
		tag  any
		ver  string
	}{
		{"library/nginx", "latest", "nginx-ver"},
		{"docker.io/library/redis", "latest", "redis-legacy-ver"},
	}
	for _, s := range seed {
		if _, err := database.ExecContext(ctx,
			`INSERT INTO registry_image_versions (user_id, image_repo, registry, repository, tag, latest_version)
			 VALUES (1, ?, 'docker.io', 'repo', ?, ?)`,
			s.repo, s.tag, s.ver); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	m, err := GetRegistryDataMap(ctx, database, 1)
	if err != nil {
		t.Fatalf("get map: %v", err)
	}

	cases := []struct {
		repo, tag, want string
	}{
		{"docker.io/library/nginx", "latest", "nginx-ver"}, // live ref with host
		{"library/nginx", "latest", "nginx-ver"},           // stored form
		{"library/redis", "latest", "redis-legacy-ver"},    // legacy row had host
		{"docker.io/library/redis", "latest", "redis-legacy-ver"},
	}
	for _, c := range cases {
		d := m.Get(c.repo, c.tag)
		got := ""
		if d != nil {
			got = d.LatestVersion.String
		}
		if got != c.want {
			t.Errorf("Get(%q, %q) = %q, want %q", c.repo, c.tag, got, c.want)
		}
		q, err := GetRegistryData(ctx, database, 1, c.repo, c.tag)
		if err != nil {
			t.Fatalf("GetRegistryData(%q, %q): %v", c.repo, c.tag, err)
		}
		if q.LatestVersion.String != c.want {
			t.Errorf("GetRegistryData(%q, %q) = %q, want %q", c.repo, c.tag, q.LatestVersion.String, c.want)
		}
	}
}
