package graph

import (
	"context"
	"testing"
)

// The summary update count must join registry_image_versions on the DEPLOYED
// TAG. Joining on repo alone fanned containers across every tag of the repo:
// containers were counted multiple times and compared against the wrong tag's
// latest digest (a fully up-to-date container on tag 2.0 counted as "has
// update" because tag 1.0's row differed).
func TestContainersWithUpdatesCountMatchesTag(t *testing.T) {
	database := newPipelineTestDB(t)
	ctx := context.Background()

	seed := func(q string, args ...any) {
		t.Helper()
		if _, err := database.ExecContext(ctx, q, args...); err != nil {
			t.Fatalf("seed %q: %v", q, err)
		}
	}

	// deployed_images
	seed(`INSERT INTO deployed_images (id, user_id, image_repo, image_tag, image_digest)
		VALUES (1, 1, 'r/a', '1.0', 'sha256:aaa'),
		       (2, 1, 'r/a', '2.0', 'sha256:ccc'),
		       (3, 1, 'r/b', 'x',   'sha256:ddd'),
		       (4, 2, 'r/a', '1.0', 'sha256:aaa')`)
	// registry_image_versions: tag 1.0 moved, tag 2.0 current, r/b tag-agnostic row moved.
	seed(`INSERT INTO registry_image_versions (user_id, image_repo, registry, repository, tag, latest_digest)
		VALUES (1, 'r/a', 'docker', 'a', '1.0', 'sha256:bbb'),
		       (1, 'r/a', 'docker', 'a', '2.0', 'sha256:ccc'),
		       (1, 'r/b', 'docker', 'b', NULL,  'sha256:eee')`)
	seed(`INSERT INTO containers (user_id, container_id, container_name, image_name, image_repo, deployed_image_id)
		VALUES (1, 'c1', 'one', 'r/a:1.0', 'r/a', 1),
		       (1, 'c2', 'two', 'r/a:2.0', 'r/a', 2),
		       (1, 'c3', 'three', 'r/b:x', 'r/b', 3),
		       (1, 'c4', 'four', 'r/c:y', 'r/c', NULL),
		       (2, 'c5', 'five', 'r/a:1.0', 'r/a', 4)`)

	var got int
	if err := database.QueryRowContext(ctx, containersWithUpdatesCountSQL, 1).Scan(&got); err != nil {
		t.Fatalf("query: %v", err)
	}
	// c1: tag 1.0 latest differs -> update. c2: tag 2.0 matches -> none (the
	// old repo-only join wrongly counted it via the 1.0 row). c3: NULL-tag
	// fallback row differs -> update. c4: no deployed image -> none.
	// c5: other user -> none.
	if got != 2 {
		t.Errorf("withUpdates = %d, want 2", got)
	}

	var other int
	if err := database.QueryRowContext(ctx, containersWithUpdatesCountSQL, 2).Scan(&other); err != nil {
		t.Fatalf("query other user: %v", err)
	}
	if other != 0 {
		t.Errorf("other user withUpdates = %d, want 0 (no registry rows for user 2)", other)
	}
}
