package imagesync

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dockedapp/backend/internal/db"
	"github.com/dockedapp/backend/internal/registry"
)

// newScanFixture stands up a fake dockhand runner plus a migrated database with
// runner 7 enrolled, mirroring the shape a real scan runs against.
func newScanFixture(t *testing.T, handler http.HandlerFunc) (*Service, *sql.DB, db.RunnerRow) {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)

	database, err := db.Open(filepath.Join(t.TempDir(), "scan.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	ctx := context.Background()
	if err := db.Migrate(ctx, database); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if _, err := database.ExecContext(ctx,
		`INSERT INTO runners (id, user_id, name, url, api_key) VALUES (7, 1, 'runner7', ?, 'k')`, srv.URL); err != nil {
		t.Fatalf("seed runner: %v", err)
	}
	s := &Service{DB: database, Registry: registry.NewManager(database)}
	return s, database, db.RunnerRow{ID: 7, URL: srv.URL, APIKey: "k"}
}

func listEntry(id, name, image string, extra map[string]any) map[string]any {
	entry := map[string]any{"id": id, "name": name, "image": image, "state": "running", "status": "Up"}
	for k, v := range extra {
		entry[k] = v
	}
	return entry
}

func inspectDoc(id, name, image string, extra map[string]any) map[string]any {
	doc := map[string]any{
		"Id": id, "Name": name, "Image": image,
		"Config": map[string]any{"Image": image},
		"State":  map[string]any{"Status": "running"},
	}
	for k, v := range extra {
		doc[k] = v
	}
	return doc
}

func runnerHandler(list []map[string]any, inspects map[string]map[string]any) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/containers" {
			_ = json.NewEncoder(w).Encode(map[string]any{"containers": list})
			return
		}
		id := strings.TrimPrefix(r.URL.Path, "/containers/")
		id = strings.TrimSuffix(id, "/json")
		if doc, ok := inspects[id]; ok {
			_ = json.NewEncoder(w).Encode(doc)
			return
		}
		http.NotFound(w, r)
	}
}

// dockhand reports repo-qualified digests ("repo@sha256:..."). That form is the
// only recoverable image identity for sha256-pinned containers, so it must
// survive transport; the bare "sha256:..." form is what gets persisted as the
// image's identity.
func TestScanRunnerPersistsCleanIdentityFromRawDigests(t *testing.T) {
	const repo = "quay.io/example/app"
	list := []map[string]any{listEntry("c1", "/app", repo+":1.0",
		map[string]any{"repoDigests": []string{repo + "@sha256:aaa"}})}
	inspects := map[string]map[string]any{
		"c1": inspectDoc("c1", "/app", repo+":1.0",
			map[string]any{"RepoDigests": []any{repo + "@sha256:aaa"}}),
	}
	s, database, rr := newScanFixture(t, runnerHandler(list, inspects))
	s.ScanRunnerContainers(context.Background(), rr, 1)

	var imageRepo string
	var digest sql.NullString
	var repoDigests sql.NullString
	if err := database.QueryRow(`
		SELECT c.image_repo, di.image_digest, di.repo_digests
		  FROM containers c JOIN deployed_images di ON di.id = c.deployed_image_id
		 WHERE c.container_id = 'c1' AND c.runner_id = 7`).
		Scan(&imageRepo, &digest, &repoDigests); err != nil {
		t.Fatalf("container not upserted: %v", err)
	}
	if imageRepo != repo {
		t.Errorf("image_repo = %q, want %q", imageRepo, repo)
	}
	if !digest.Valid || digest.String != "sha256:aaa" {
		t.Errorf("image_digest = %v, want sha256:aaa", digest)
	}
	if repoDigests.String != `["sha256:aaa"]` {
		t.Errorf("repo_digests = %s, want the bare sha256 form", repoDigests.String)
	}
}

// A container pinned to an image ID whose repo digests are ALSO bare image IDs
// has no recoverable repository. Accepting the bare digest makes SplitRepoTag
// invent the repo "sha256" and silently corrupt the container's tracking.
func TestScanRunnerSkipsPinnedImageWithOnlyBareDigests(t *testing.T) {
	imageID := "sha256:" + strings.Repeat("a", 64)
	bare := "sha256:" + strings.Repeat("b", 64)
	list := []map[string]any{listEntry("c9", "/pinned", imageID,
		map[string]any{"repoDigests": []string{bare}})}
	inspects := map[string]map[string]any{
		"c9": inspectDoc("c9", "/pinned", imageID,
			map[string]any{"RepoDigests": []any{bare}}),
	}
	s, database, rr := newScanFixture(t, runnerHandler(list, inspects))
	s.ScanRunnerContainers(context.Background(), rr, 1)

	var rows int
	if err := database.QueryRow(`SELECT COUNT(*) FROM containers WHERE container_id = 'c9'`).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 0 {
		t.Errorf("bare-digest pinned container persisted (%d rows), want skipped", rows)
	}
	var bogus int
	if err := database.QueryRow(`SELECT COUNT(*) FROM deployed_images WHERE image_repo = 'sha256'`).Scan(&bogus); err != nil {
		t.Fatal(err)
	}
	if bogus != 0 {
		t.Errorf("bogus sha256 repo rows = %d, want 0", bogus)
	}
}

// The upgrade pipeline stamps docked.original_image on recreated dependents.
// When the inspect document carries no repo digests, that label is the only
// source of the image's identity - and its digest must become the stored
// baseline, otherwise the container loses update tracking.
func TestScanRunnerRecoversPinnedImageFromLabel(t *testing.T) {
	imageID := "sha256:" + strings.Repeat("c", 64)
	const wantRepo = "quay.io/example/app"
	labels := map[string]any{"docked.original_image": wantRepo + "@sha256:aaa"}

	list := []map[string]any{listEntry("c8", "/pinned", imageID, nil)}
	inspects := map[string]map[string]any{
		"c8": inspectDoc("c8", "/pinned", imageID,
			map[string]any{"Config": map[string]any{"Image": imageID, "Labels": labels}}),
	}
	s, database, rr := newScanFixture(t, runnerHandler(list, inspects))
	s.ScanRunnerContainers(context.Background(), rr, 1)

	var imageRepo string
	var digest sql.NullString
	if err := database.QueryRow(`
		SELECT c.image_repo, di.image_digest
		  FROM containers c JOIN deployed_images di ON di.id = c.deployed_image_id
		 WHERE c.container_id = 'c8' AND c.runner_id = 7`).
		Scan(&imageRepo, &digest); err != nil {
		t.Fatalf("labelled pinned container not upserted: %v", err)
	}
	if imageRepo != wantRepo {
		t.Errorf("image_repo = %q, want %q", imageRepo, wantRepo)
	}
	if !digest.Valid || digest.String != "sha256:aaa" {
		t.Errorf("image_digest = %v, want sha256:aaa recovered from the label", digest)
	}
}

// A scan that cannot see a digest (no repo digests anywhere) must not clobber
// the baseline captured by an earlier scan.
func TestScanRunnerKeepsBaselineWhenDigestUnknown(t *testing.T) {
	const repo = "myapp"
	// The fixture server keeps one handler; make it swappable so a second
	// scan can observe a different (digest-less) inventory.
	var current http.HandlerFunc
	s, database, rr := newScanFixture(t, func(w http.ResponseWriter, r *http.Request) {
		current(w, r)
	})
	ctx := context.Background()

	current = runnerHandler(
		[]map[string]any{listEntry("c1", "/myapp", repo+":latest",
			map[string]any{"repoDigests": []string{repo + "@sha256:base"}})},
		map[string]map[string]any{
			"c1": inspectDoc("c1", "/myapp", repo+":latest",
				map[string]any{"RepoDigests": []any{repo + "@sha256:base"}}),
		})
	s.ScanRunnerContainers(ctx, rr, 1)

	// Second pass: dockhand no longer reports digests for this container.
	current = runnerHandler(
		[]map[string]any{listEntry("c1", "/myapp", repo+":latest", nil)},
		map[string]map[string]any{"c1": inspectDoc("c1", "/myapp", repo+":latest", nil)})
	s.ScanRunnerContainers(ctx, rr, 1)

	var digest sql.NullString
	if err := database.QueryRowContext(ctx, `
		SELECT di.image_digest FROM containers c
		  JOIN deployed_images di ON di.id = c.deployed_image_id
		 WHERE c.container_id = 'c1' AND c.runner_id = 7`).Scan(&digest); err != nil {
		t.Fatal(err)
	}
	if !digest.Valid || digest.String != "sha256:base" {
		t.Errorf("image_digest = %v, want the sha256:base baseline preserved", digest)
	}
}

// A runner's inventory is a snapshot: containers that disappeared between scans
// must be removed, or deleted containers stay in the UI forever.
func TestScanRunnerReconcilesStaleContainers(t *testing.T) {
	// Swappable handler: the test needs a second scan to observe a different
	// inventory than the first.
	var current http.HandlerFunc
	s, database, rr := newScanFixture(t, func(w http.ResponseWriter, r *http.Request) {
		current(w, r)
	})
	ctx := context.Background()

	current = runnerHandler(
		[]map[string]any{
			listEntry("c1", "/one", "nginx:1.25", nil),
			listEntry("c2", "/two", "nginx:1.25", nil),
			listEntry("c3", "/three", "nginx:1.25", nil),
		},
		map[string]map[string]any{
			"c1": inspectDoc("c1", "/one", "nginx:1.25", nil),
			"c2": inspectDoc("c2", "/two", "nginx:1.25", nil),
			"c3": inspectDoc("c3", "/three", "nginx:1.25", nil),
		})
	s.ScanRunnerContainers(ctx, rr, 1)

	var before int
	if err := database.QueryRow(`SELECT COUNT(*) FROM containers WHERE runner_id = 7`).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if before != 3 {
		t.Fatalf("seeded containers = %d, want 3", before)
	}

	// c2 is gone; c3 is still there but its per-container inspect fails, which
	// must not be mistaken for a removal.
	current = runnerHandler(
		[]map[string]any{listEntry("c1", "/one", "nginx:1.25", nil), listEntry("c3", "/three", "nginx:1.25", nil)},
		map[string]map[string]any{"c1": inspectDoc("c1", "/one", "nginx:1.25", nil)})
	s.ScanRunnerContainers(ctx, rr, 1)

	var remaining []string
	rows, err := database.Query(`SELECT container_id FROM containers WHERE runner_id = 7 ORDER BY container_id`)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		remaining = append(remaining, id)
	}
	rows.Close()
	if strings.Join(remaining, ",") != "c1,c3" {
		t.Errorf("remaining = %v, want [c1 c3]: a skipped-but-present container must survive", remaining)
	}
}

// A runner deleted while a scan is in flight must not gain orphaned container
// rows: DeleteRunner already removed them and nothing else will.
func TestScanRunnerWritesNothingAfterRunnerDeleted(t *testing.T) {
	handler := runnerHandler(
		[]map[string]any{listEntry("c1", "/one", "nginx:1.25", nil)},
		map[string]map[string]any{"c1": inspectDoc("c1", "/one", "nginx:1.25", nil)})
	s, database, rr := newScanFixture(t, handler)
	ctx := context.Background()

	if _, err := database.ExecContext(ctx, `DELETE FROM runners WHERE id = 7`); err != nil {
		t.Fatal(err)
	}
	s.ScanRunnerContainers(ctx, rr, 1)

	for _, table := range []string{"containers", "deployed_images"} {
		var rows int
		if err := database.QueryRowContext(ctx, "SELECT COUNT(*) FROM "+table).Scan(&rows); err != nil {
			t.Fatal(err)
		}
		if rows != 0 {
			t.Errorf("%s rows = %d, want 0 for a deleted runner", table, rows)
		}
	}
}

// uses_network_mode / provides_network and the Swarm stack label drive the UI's
// network-mode warning and stack grouping. Both come from the runner payload
// and must reach the database.
func TestScanRunnerPersistsNetworkFlagsAndStack(t *testing.T) {
	list := []map[string]any{
		listEntry("c1", "/net", "nginx:1.25", map[string]any{"networkMode": "bridge"}),
		listEntry("c2", "/dep", "nginx:1.25", map[string]any{"networkMode": "container:c1"}),
	}
	inspects := map[string]map[string]any{
		"c1": inspectDoc("c1", "/net", "nginx:1.25", map[string]any{
			"Config": map[string]any{"Image": "nginx:1.25", "Labels": map[string]any{
				"com.docker.stack.namespace": "mystack"}}}),
		"c2": inspectDoc("c2", "/dep", "nginx:1.25", nil),
	}
	s, database, rr := newScanFixture(t, runnerHandler(list, inspects))
	s.ScanRunnerContainers(context.Background(), rr, 1)

	var uses, provides int
	var stack sql.NullString
	if err := database.QueryRow(`
		SELECT uses_network_mode, provides_network, stack_name
		  FROM containers WHERE container_id = 'c2' AND runner_id = 7`).
		Scan(&uses, &provides, &stack); err != nil {
		t.Fatal(err)
	}
	if uses != 1 {
		t.Errorf("dependent uses_network_mode = %d, want 1", uses)
	}
	if err := database.QueryRow(`
		SELECT uses_network_mode, provides_network, stack_name
		  FROM containers WHERE container_id = 'c1' AND runner_id = 7`).
		Scan(&uses, &provides, &stack); err != nil {
		t.Fatal(err)
	}
	if provides != 1 {
		t.Errorf("provider provides_network = %d, want 1", provides)
	}
	if !stack.Valid || stack.String != "mystack" {
		t.Errorf("stack_name = %v, want mystack (com.docker.stack.namespace fallback)", stack)
	}
}
