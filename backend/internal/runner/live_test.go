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

	batched := FetchContainerRows(ctx, database, 1, rr, ctrs)
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
// filter silently failed on live containers.
func TestLiveRowsCarryRegistryForIntentMatching(t *testing.T) {
	rr := db.RunnerRow{ID: 7, Name: "r1", URL: "http://runner.invalid"}
	cases := []struct{ image, want string }{
		{"ghcr.io/acme/app:1", "ghcr"},
		{"registry.gitlab.com/grp/app:2", "gitlab"},
		{"gcr.io/proj/app", "gcr"},
		{"postgres:15", "dockerhub"},
		{"lscr.io/linuxserver/radarr", "dockerhub"},
	}
	for _, tc := range cases {
		row := containerRowBase(rr, domain.Container{ID: "x", Name: "n", Image: tc.image})
		if !row.Registry.Valid || row.Registry.String != tc.want {
			t.Errorf("image %q: Registry = %v, want %q", tc.image, row.Registry, tc.want)
		}
	}
	// A known registry_data provider refines the image-prefix guess.
	row := containerRowBase(rr, domain.Container{ID: "x", Name: "n", Image: "quay.io/minio/minio:1"})
	applyRegistryData(&row, &db.RegistryData{Provider: sql.NullString{String: "quay", Valid: true}})
	if row.Registry.String != "quay" {
		t.Errorf("registry_data provider should refine Registry, got %q", row.Registry.String)
	}
}
