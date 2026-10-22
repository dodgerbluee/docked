package graph

import (
	"context"
	"testing"

	"github.com/dockedapp/backend/internal/auth"
	"github.com/dockedapp/backend/internal/db"
)

// clearTrackedAppCache must reset the user's tracked-app latest metadata and
// leave registry_image_versions (container registry observations) intact.
// The old DELETE wiped every container's update detection data.
func TestClearTrackedAppCacheKeepsRegistryVersions(t *testing.T) {
	database, err := db.Open(t.TempDir() + "/cache.db")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer database.Close()
	ctx := context.Background()
	if err := db.Migrate(ctx, database); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	if _, err := database.ExecContext(ctx,
		`INSERT INTO tracked_apps (user_id, name, image_name, source_type, latest_version, has_update, last_checked)
		 VALUES (1, 'nginx', 'nginx:latest', 'docker', '1.25', 1, CURRENT_TIMESTAMP)`); err != nil {
		t.Fatalf("seed tracked_apps: %v", err)
	}
	if _, err := database.ExecContext(ctx,
		`INSERT INTO registry_image_versions (user_id, image_repo, registry, namespace, repository, tag, latest_digest, exists_in_registry)
		 VALUES (1, 'nginx', 'docker.io', 'library', 'nginx', 'latest', 'sha256:deadbeef', 1)`); err != nil {
		t.Fatalf("seed registry_image_versions: %v", err)
	}

	r := &Resolver{DB: database}
	mr := &mutationResolver{r}
	res, err := mr.ClearTrackedAppCache(auth.ContextWithUserID(ctx, 1))
	if err != nil || res == nil || !res.Success {
		t.Fatalf("ClearTrackedAppCache failed: res=%v err=%v", res, err)
	}

	var rivCount int
	if err := database.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM registry_image_versions WHERE user_id = 1`).Scan(&rivCount); err != nil {
		t.Fatalf("count riv: %v", err)
	}
	if rivCount != 1 {
		t.Errorf("registry_image_versions rows = %d, want 1 (container observations must survive)", rivCount)
	}

	var latest any
	var hasUpdate int
	if err := database.QueryRowContext(ctx,
		`SELECT latest_version, has_update FROM tracked_apps WHERE user_id = 1`).Scan(&latest, &hasUpdate); err != nil {
		t.Fatalf("read tracked_apps: %v", err)
	}
	if latest != nil {
		t.Errorf("latest_version = %v, want NULL after cache clear", latest)
	}
	if hasUpdate != 0 {
		t.Errorf("has_update = %d, want 0 after cache clear", hasUpdate)
	}
}
