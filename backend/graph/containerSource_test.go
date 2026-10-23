package graph

import (
	"context"
	"database/sql"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/dockedapp/backend/graph/model"
	"github.com/dockedapp/backend/internal/auth"
	"github.com/dockedapp/backend/internal/db"
)

func sourceTestDB(t *testing.T) *sql.DB {
	t.Helper()
	dsn := "file:" + filepath.Join(t.TempDir(), "source.db") +
		"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)"
	database, err := sql.Open("sqlite", dsn)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	if err := db.Migrate(context.Background(), database); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	if _, err := database.ExecContext(context.Background(),
		`INSERT INTO users (id, username, password_hash, role, instance_admin)
		 VALUES (1, 'u1', 'x', 'Administrator', 1)`); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	return database
}

// TestContainerSourceResolvesTheWholeRunner pins the relation contract. The
// parent query seeds Container.source with only an identity; projecting that
// identity straight into the GraphQL object answered the non-null fields with
// Go zero values, so every container reported its runner as disabled, created
// at the epoch, with an empty type that is not even a member of SourceType.
// On real data all 112 containers reported url:"" type:"" enabled:false.
func TestContainerSourceResolvesTheWholeRunner(t *testing.T) {
	database := sourceTestDB(t)
	ctx := auth.ContextWithUserID(context.Background(), 1)

	if _, err := database.ExecContext(ctx,
		`INSERT INTO runners (user_id, name, url, api_key, enabled, docker_enabled, version)
		 VALUES (1, 'toybox', 'http://toybox:4001', 'k', 1, 1, '3.31.0')`); err != nil {
		t.Fatal(err)
	}
	var runnerID int64
	if err := database.QueryRowContext(ctx, "SELECT id FROM runners WHERE user_id = 1").Scan(&runnerID); err != nil {
		t.Fatal(err)
	}

	r := &Resolver{DB: database}
	cr := &containerResolver{r}

	// Exactly what the container connection seeds: an identity and nothing else.
	seeded := &model.Container{
		ID:                "10",
		DockerContainerID: "abc123def456",
		Name:              "radarr",
		Source:            &model.Runner{ID: itoa(runnerID)},
	}

	got, err := cr.Source(ctx, seeded)
	if err != nil {
		t.Fatal(err)
	}
	runner, ok := got.(*model.Runner)
	if !ok {
		t.Fatalf("source = %T, want *model.Runner", got)
	}
	if runner.URL != "http://toybox:4001" {
		t.Errorf("url = %q, want the runner's real url", runner.URL)
	}
	if !runner.Enabled {
		t.Error("enabled = false, want the runner's real state")
	}
	if runner.Type == "" {
		t.Error("type = \"\", which is not a member of SourceType")
	}
	if runner.CreatedAt.Equal(time.Time{}) {
		t.Error("createdAt is the zero time, want the runner's real row")
	}
	if runner.Name != "toybox" {
		t.Errorf("name = %q, want the full row rather than the seeded identity", runner.Name)
	}
}

// TestContainerSourceIsNullWhenTheHostIsGone: a retired source-backed row (or
// a deleted runner) must surface as null, not as a runner that happens to be
// switched off.
func TestContainerSourceIsNullWhenTheHostIsGone(t *testing.T) {
	database := sourceTestDB(t)
	ctx := auth.ContextWithUserID(context.Background(), 1)

	r := &Resolver{DB: database}
	cr := &containerResolver{r}

	missing := "4242"
	got, err := cr.Source(ctx, &model.Container{
		ID:     "10",
		Name:   "old",
		Source: &model.Runner{ID: missing},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got != nil {
		t.Errorf("source = %+v, want nil for a host that no longer exists", got)
	}
}

// TestContainerUpgradeHistorySurvivesRecreate is the resolver half of the same
// prod bug: the container's current Docker id is the one the LAST upgrade
// created, so an id-keyed history lookup saw nothing.
func TestContainerUpgradeHistorySurvivesRecreate(t *testing.T) {
	database := sourceTestDB(t)
	ctx := auth.ContextWithUserID(context.Background(), 1)

	if _, err := database.ExecContext(ctx,
		`INSERT INTO runners (user_id, name, url, api_key, enabled) VALUES (1, 'toybox', 'http://t:4001', 'k', 1)`); err != nil {
		t.Fatal(err)
	}
	var runnerID int64
	if err := database.QueryRowContext(ctx, "SELECT id FROM runners WHERE user_id = 1").Scan(&runnerID); err != nil {
		t.Fatal(err)
	}
	// Two upgrades, each leaving a different Docker id behind.
	for _, id := range []string{"old000000000000000000000000000000000000000000000000000000000001",
		"new000000000000000000000000000000000000000000000000000000000002"} {
		if _, err := database.ExecContext(ctx,
			`INSERT INTO upgrade_history (user_id, runner_id, container_id, container_name, old_image, new_image, status)
			 VALUES (1, ?, ?, 'radarr', 'radarr:1', 'radarr:2', 'success')`, runnerID, id); err != nil {
			t.Fatal(err)
		}
	}

	r := &Resolver{DB: database}
	cr := &containerResolver{r}

	conn, err := cr.UpgradeHistory(ctx, &model.Container{
		ID:                "10",
		DockerContainerID: "new000000000000000000000000000000000000000000000000000000000002",
		Name:              "radarr",
		Source:            &model.Runner{ID: itoa(runnerID)},
	}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if conn.TotalCount != 2 {
		t.Errorf("totalCount = %d, want 2: history must follow the container across the recreate", conn.TotalCount)
	}
}

func itoa(v int64) string { return strconv.FormatInt(v, 10) }
