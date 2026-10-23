package runner

import (
	"context"
	"database/sql"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/dockedapp/backend/internal/db"
	"github.com/dockedapp/backend/internal/domain"
)

// The batched FetchContainerRows must produce exactly what the per-container
// ContainerToRow produces (same registry join semantics: exact tag first,
// NULL-tag fallback, missing rows leave registry fields empty).
func TestFetchContainerRowsMatchesContainerToRow(t *testing.T) {
	database, err := db.Open(filepath.Join(t.TempDir(), "live.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer database.Close()
	ctx := context.Background()
	if err := db.Migrate(ctx, database); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	seed := []struct {
		repo string
		tag  any
		ver  string
	}{
		{"postgres", "15", "15.2"},
		{"redis", nil, "7.4"},
	}
	for _, s := range seed {
		if _, err := database.ExecContext(ctx,
			`INSERT INTO registry_image_versions (user_id, image_repo, registry, repository, tag, latest_version, provider)
			 VALUES (1, ?, 'docker.io', 'repo', ?, ?, 'docker')`,
			s.repo, s.tag, s.ver); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	rr := db.RunnerRow{ID: 7, Name: "r1", URL: "http://runner.invalid"}
	ctrs := []domain.Container{
		{ID: "aaa111", Name: "pg", Image: "postgres:15", Status: "running", State: "running"},
		{ID: "bbb222", Name: "rd", Image: "redis", Status: "running", State: "running"},
		{ID: "ccc333", Name: "x", Image: "unknown:1", Status: "running", State: "running"},
	}

	batched, err := FetchContainerRows(ctx, database, 1, rr, ctrs)
	if err != nil {
		t.Fatalf("FetchContainerRows: %v", err)
	}
	if len(batched) != len(ctrs) {
		t.Fatalf("batched rows = %d, want %d", len(batched), len(ctrs))
	}
	for i, c := range ctrs {
		want := ContainerToRow(ctx, database, 1, rr, c)
		got := batched[i]
		// LastSeen/CreatedAt carry wall-clock timestamps; normalize.
		want.LastSeen, want.CreatedAt = sql.NullString{}, sql.NullString{}
		got.LastSeen, got.CreatedAt = sql.NullString{}, sql.NullString{}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("row %d (%s) mismatch:\n got %+v\nwant %+v", i, c.Image, got, want)
		}
	}

	// Spot-check the join actually happened.
	if !batched[0].LatestVersion.Valid || batched[0].LatestVersion.String != "15.2" {
		t.Errorf("exact-tag join failed: %+v", batched[0].LatestVersion)
	}
	if !batched[1].LatestVersion.Valid || batched[1].LatestVersion.String != "7.4" {
		t.Errorf("NULL-tag fallback join failed: %+v", batched[1].LatestVersion)
	}
	if batched[2].LatestVersion.Valid {
		t.Errorf("unknown image got registry data: %+v", batched[2].LatestVersion)
	}
}

// Live runner rows must carry a Registry so intent registry include/exclude
// filters apply to them; previously the column was empty and every registry
// filter silently failed on live containers. The value must use the registry
// HOST vocabulary deployed_images.registry stores (docker.io, ghcr.io, ...) —
// the provider vocabulary (dockerhub, ghcr) never matches the host-shaped
// patterns the UI offers.
func TestLiveRowsCarryRegistryForIntentMatching(t *testing.T) {
	rr := db.RunnerRow{ID: 7, Name: "r1", URL: "http://runner.invalid"}
	cases := []struct{ image, want string }{
		{"ghcr.io/acme/app:1", "ghcr.io"},
		{"registry.gitlab.com/grp/app:2", "registry.gitlab.com"},
		{"gcr.io/proj/app", "gcr.io"},
		{"quay.io/minio/minio:1", "quay.io"},
		{"postgres:15", "docker.io"},
		{"lscr.io/linuxserver/radarr", "docker.io"},
	}
	for _, tc := range cases {
		row := containerRowBase(rr, domain.Container{ID: "x", Name: "n", Image: tc.image})
		if !row.Registry.Valid || row.Registry.String != tc.want {
			t.Errorf("image %q: Registry = %v, want %q", tc.image, row.Registry, tc.want)
		}
	}
	// registry_data.provider is a different vocabulary: it fills the
	// imageInfo.provider field but must never overwrite the host-shaped
	// Registry column.
	row := containerRowBase(rr, domain.Container{ID: "x", Name: "n", Image: "quay.io/minio/minio:1"})
	applyRegistryData(&row, &db.RegistryData{Provider: sql.NullString{String: "quay", Valid: true}})
	if row.Registry.String != "quay.io" {
		t.Errorf("provider must not clobber Registry host, got %q", row.Registry.String)
	}
	if row.Provider.String != "quay" {
		t.Errorf("provider should land on Provider, got %q", row.Provider.String)
	}
}

// A container the upgrade pipeline recreated runs from a bare image ID, so
// Docker reports Config.Image as "sha256:<id>". Parsed naively that is a bogus
// "sha256" repository: the registry lookup misses, and because a live row
// replaces the inventory row for a reachable runner, the container lost update
// status that had already been confirmed for it. The live path must recover the
// reference the same way the scan path does.
func TestLiveRowsRecoverPinnedImageIdentity(t *testing.T) {
	database, err := db.Open(filepath.Join(t.TempDir(), "pinned.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer database.Close()
	ctx := context.Background()
	if err := db.Migrate(ctx, database); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if _, err := database.ExecContext(ctx,
		`INSERT INTO registry_image_versions (user_id, image_repo, registry, repository, tag, latest_version, provider)
		 VALUES (1, 'quay.io/acme/app', 'quay.io', 'app', NULL, '2.9.0', 'quay')`); err != nil {
		t.Fatalf("seed: %v", err)
	}

	rr := db.RunnerRow{ID: 7, Name: "r1", URL: "http://runner.invalid"}
	pinned := domain.Container{
		ID:    "aaa111",
		Name:  "app",
		Image: "sha256:1111111111111111111111111111111111111111111111111111111111111111",
		Labels: map[string]string{
			domain.OriginalImageLabel: "quay.io/acme/app@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		},
		// Bare image ID only: carries no repository, so it cannot rescue this
		// container on its own.
		RepoDigests: []string{"sha256:2222222222222222222222222222222222222222222222222222222222222222"},
		Status:      "running",
		State:       "running",
	}

	rows, err := FetchContainerRows(ctx, database, 1, rr, []domain.Container{pinned})
	if err != nil {
		t.Fatalf("FetchContainerRows: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(rows))
	}
	got := rows[0]
	if got.ImageRepo.String != "quay.io/acme/app" {
		t.Errorf("ImageRepo = %q, want the label's repository", got.ImageRepo.String)
	}
	if got.ImageTag.String != "latest" {
		t.Errorf("ImageTag = %q, want latest", got.ImageTag.String)
	}
	if got.Registry.String != "quay.io" {
		t.Errorf("Registry = %q, want quay.io", got.Registry.String)
	}
	if !got.LatestVersion.Valid || got.LatestVersion.String != "2.9.0" {
		t.Errorf("registry join failed for a pinned container: %+v", got.LatestVersion)
	}

	// No label (a container pinned by the user, not by an upgrade): fall back
	// to any repository-qualified digest reference.
	viaDigest := containerRowBase(rr, domain.Container{
		ID:          "bbb222",
		Name:        "d",
		Image:       "sha256:3333333333333333333333333333333333333333333333333333333333333333",
		RepoDigests: []string{"quay.io/acme/app@sha256:4444444444444444444444444444444444444444444444444444444444444444"},
	})
	if viaDigest.ImageRepo.String != "quay.io/acme/app" {
		t.Errorf("digest fallback ImageRepo = %q, want quay.io/acme/app", viaDigest.ImageRepo.String)
	}

	// Nothing recoverable: the image string is kept rather than invented.
	lost := containerRowBase(rr, domain.Container{
		ID:          "ccc333",
		Name:        "l",
		Image:       "sha256:5555555555555555555555555555555555555555555555555555555555555555",
		RepoDigests: []string{"sha256:6666666666666666666666666666666666666666666666666666666666666666"},
	})
	if lost.ImageRepo.String != "sha256" {
		t.Errorf("unrecoverable container ImageRepo = %q, want the unchanged parse", lost.ImageRepo.String)
	}

	// An ordinary tag must never be touched by the recovery path.
	normal := containerRowBase(rr, domain.Container{ID: "ddd444", Name: "n", Image: "postgres:15"})
	if normal.ImageRepo.String != "postgres" || normal.ImageTag.String != "15" {
		t.Errorf("ordinary image changed: %q / %q", normal.ImageRepo.String, normal.ImageTag.String)
	}
}
