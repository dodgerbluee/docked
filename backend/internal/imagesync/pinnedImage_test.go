package imagesync

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dockedapp/backend/internal/db"
	"github.com/dockedapp/backend/internal/registry"
)

// A dependent recreated by the upgrade pipeline is pinned to an image ID, so
// its Config.Image is "sha256:<id>". Scanning must recover the original
// repository from repo digests instead of persisting a bogus "sha256" repo,
// which would silently break the container's update tracking.
func TestScanRunnerRecoversPinnedImageReference(t *testing.T) {
	imageID := "sha256:" + strings.Repeat("f", 64)
	const wantRepo = "quay.io/example/app"

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/containers":
			_ = json.NewEncoder(w).Encode(map[string]any{"containers": []map[string]any{{
				"id":          "c1",
				"name":        "/pinned",
				"image":       imageID,
				"state":       "running",
				"status":      "Up",
				"repoDigests": []string{wantRepo + "@sha256:aaa"},
			}}})
		case "/containers/c1/json":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"Id":     "c1",
				"Name":   "/pinned",
				"Image":  imageID,
				"Config": map[string]any{"Image": imageID},
				"State":  map[string]any{"Status": "running"},
				"RepoDigests": []any{
					wantRepo + "@sha256:aaa",
				},
			})
		default:
			http.NotFound(w, r)
		}
	})
	srv := httptest.NewServer(handler)
	defer srv.Close()

	database, err := db.Open(t.TempDir() + "/pin.db")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer database.Close()
	ctx := context.Background()
	if err := db.Migrate(ctx, database); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	s := &Service{DB: database, Registry: registry.NewManager(database)}
	rr := db.RunnerRow{ID: 7, URL: srv.URL, APIKey: "k"}
	s.ScanRunnerContainers(ctx, rr, 1)

	var imageRepo, imageName string
	if err := database.QueryRowContext(ctx,
		`SELECT image_repo, image_name FROM containers WHERE container_id = 'c1'`).
		Scan(&imageRepo, &imageName); err != nil {
		t.Fatalf("container row not upserted: %v", err)
	}
	if imageRepo == "sha256" || imageRepo == "" {
		t.Errorf("image_repo = %q: pinned image leaked into tracking", imageRepo)
	}
	if imageRepo != wantRepo {
		t.Errorf("image_repo = %q, want %q", imageRepo, wantRepo)
	}
}

// A pinned container with NO repo digests has no recoverable reference; the
// scan must skip it rather than persist the "sha256" pseudo-repo.
func TestScanRunnerSkipsPinnedImageWithoutRepoDigests(t *testing.T) {
	imageID := "sha256:" + strings.Repeat("e", 64)
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/containers":
			_ = json.NewEncoder(w).Encode(map[string]any{"containers": []map[string]any{{
				"id": "c2", "name": "/pinned2", "image": imageID, "state": "running",
			}}})
		case "/containers/c2/json":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"Id": "c2", "Name": "/pinned2", "Image": imageID,
				"Config": map[string]any{"Image": imageID},
				"State":  map[string]any{"Status": "running"},
			})
		default:
			http.NotFound(w, r)
		}
	})
	srv := httptest.NewServer(handler)
	defer srv.Close()

	database, err := db.Open(t.TempDir() + "/pin2.db")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer database.Close()
	ctx := context.Background()
	if err := db.Migrate(ctx, database); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	s := &Service{DB: database, Registry: registry.NewManager(database)}
	rr := db.RunnerRow{ID: 8, URL: srv.URL, APIKey: "k"}
	s.ScanRunnerContainers(ctx, rr, 1)

	var count int
	if err := database.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM containers WHERE container_id = 'c2'`).Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 0 {
		t.Errorf("pinned image with no repo digests was persisted (%d rows), want skipped", count)
	}
}
