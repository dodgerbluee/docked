package intents

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	cron "github.com/robfig/cron/v3"

	"github.com/dockedapp/backend/internal/db"
)

// --- fixtures -----------------------------------------------------------

// testDB opens a fresh SQLite file (which also installs the shared
// upgrade_locks table via db.Open) and creates the minimal domain tables the
// intents engine reads/writes.
func testDB(t *testing.T) *sql.DB {
	t.Helper()
	database, err := db.Open(filepath.Join(t.TempDir(), "intents-test.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	stmts := []string{
		`CREATE TABLE users (
			id INTEGER PRIMARY KEY, username TEXT, password_hash TEXT, role TEXT,
			password_changed INTEGER DEFAULT 0, instance_admin INTEGER DEFAULT 0,
			email TEXT, last_login TEXT,
			oauth_provider TEXT, oauth_provider_id TEXT,
			created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE intents (
			id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, name TEXT, description TEXT,
			enabled INTEGER DEFAULT 1,
			match_containers TEXT, match_images TEXT, match_sources TEXT, match_stacks TEXT, match_registries TEXT,
			exclude_containers TEXT, exclude_images TEXT, exclude_stacks TEXT, exclude_registries TEXT,
			schedule_type TEXT DEFAULT 'scheduled', schedule_cron TEXT,
			max_concurrent INTEGER DEFAULT 1, dry_run INTEGER DEFAULT 0, sequential_delay_sec INTEGER DEFAULT 0,
			last_evaluated_at TEXT, last_execution_id INTEGER,
			created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE intent_executions (
			id INTEGER PRIMARY KEY, intent_id INTEGER, user_id INTEGER,
			status TEXT, trigger_type TEXT,
			containers_matched INTEGER DEFAULT 0, containers_upgraded INTEGER DEFAULT 0,
			containers_failed INTEGER DEFAULT 0, containers_skipped INTEGER DEFAULT 0,
			error_message TEXT,
			started_at TEXT DEFAULT CURRENT_TIMESTAMP, completed_at TEXT, duration_ms INTEGER
		)`,
		`CREATE TABLE intent_execution_containers (
			id INTEGER PRIMARY KEY, execution_id INTEGER, container_id TEXT, container_name TEXT,
			image_name TEXT, source_instance_id INTEGER, runner_id INTEGER, status TEXT,
			old_image TEXT, new_image TEXT, old_digest TEXT, new_digest TEXT,
			error_message TEXT, duration_ms INTEGER,
			created_at TEXT DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE runners (
			id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, name TEXT, url TEXT, api_key TEXT,
			enabled INTEGER DEFAULT 1, version TEXT, latest_version TEXT, version_checked_at TEXT,
			docker_enabled INTEGER, last_seen TEXT, docker_status TEXT, docker_status_since TEXT,
			created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE containers (
			id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL,
			container_id TEXT, container_name TEXT, image_name TEXT, image_repo TEXT,
			status TEXT, state TEXT, stack_name TEXT, endpoint_id INTEGER, runner_id INTEGER,
			uses_network_mode INTEGER DEFAULT 0, provides_network INTEGER DEFAULT 0,
			last_seen TEXT, created_at TEXT, updated_at TEXT, deployed_image_id INTEGER,
			source_instance_id INTEGER
		)`,
		`CREATE TABLE deployed_images (
			id INTEGER PRIMARY KEY, user_id INTEGER, image_digest TEXT, image_tag TEXT,
			repo_digests TEXT, registry TEXT, image_created_date TEXT, image_repo TEXT
		)`,
		`CREATE TABLE registry_image_versions (
			id INTEGER PRIMARY KEY, user_id INTEGER, image_repo TEXT, tag TEXT,
			latest_digest TEXT, latest_version TEXT, latest_publish_date TEXT,
			provider TEXT, last_checked TEXT
		)`,
		`CREATE TABLE source_instances (
			id INTEGER PRIMARY KEY, user_id INTEGER, name TEXT, url TEXT
		)`,
	}
	for _, s := range stmts {
		if _, err := database.Exec(s); err != nil {
			t.Fatalf("create schema: %v", err)
		}
	}
	if _, err := database.Exec(
		`INSERT INTO users (id, username, password_hash, role) VALUES (1, 'u1', 'x', 'admin')`); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	return database
}

const (
	digestOld = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	digestNew = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
)

// seedRunner inserts a runner row and starts an httptest server serving the
// given dockhand payload for GET /containers.
func seedRunner(t *testing.T, database *sql.DB, name string, containers ...map[string]any) (int64, string) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/containers" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"containers": containers})
	}))
	t.Cleanup(srv.Close)

	res, err := database.Exec(
		`INSERT INTO runners (user_id, name, url, api_key, enabled) VALUES (1, ?, ?, 'key', 1)`,
		name, srv.URL)
	if err != nil {
		t.Fatalf("seed runner: %v", err)
	}
	id, _ := res.LastInsertId()
	return id, srv.URL
}

func dockhand(id, name, image string, repoDigests ...string) map[string]any {
	return map[string]any{
		"id": id, "name": name, "image": image, "status": "running", "state": "running",
		"repoDigests": repoDigests,
	}
}

// withStack tags a dockhand container with its compose project — the wire
// field the runner client maps onto StackName.
func withStack(c map[string]any, stack string) map[string]any {
	c["composeProject"] = stack
	return c
}

func seedRegistry(t *testing.T, database *sql.DB, repo, tag, latestDigest string) {
	t.Helper()
	_, err := database.Exec(
		`INSERT INTO registry_image_versions (user_id, image_repo, tag, latest_digest, provider)
		 VALUES (1, ?, ?, ?, 'docker-hub')`, repo, tag, latestDigest)
	if err != nil {
		t.Fatalf("seed registry row: %v", err)
	}
}

// insertIntent seeds an intent row and returns the scanned IntentRow.
func insertIntent(t *testing.T, database *sql.DB, fields map[string]any) *db.IntentRow {
	t.Helper()
	cols := []string{"user_id", "name", "enabled", "schedule_type"}
	vals := []any{1, fields["name"], 1, fields["schedule_type"]}
	for _, opt := range []struct{ col, key string }{
		{"schedule_cron", "schedule_cron"}, {"last_evaluated_at", "last_evaluated_at"},
		{"match_containers", "match_containers"}, {"exclude_containers", "exclude_containers"},
		{"match_registries", "match_registries"},
		{"dry_run", "dry_run"}, {"max_concurrent", "max_concurrent"},
		{"sequential_delay_sec", "sequential_delay_sec"},
	} {
		if v, ok := fields[opt.key]; ok {
			cols = append(cols, opt.col)
			vals = append(vals, v)
		}
	}
	q := "INSERT INTO intents (" + strings.Join(cols, ", ") + ") VALUES (" +
		strings.TrimSuffix(strings.Repeat("?, ", len(vals)), ", ") + ")"
	res, err := database.Exec(q, vals...)
	if err != nil {
		t.Fatalf("insert intent: %v", err)
	}
	id, _ := res.LastInsertId()
	row, err := db.GetIntentByID(context.Background(), database, id, 1)
	if err != nil || row == nil {
		t.Fatalf("reload intent: %v (nil=%v)", err, row == nil)
	}
	return row
}

// --- IsIntentDue ---------------------------------------------------------

func TestIsIntentDue(t *testing.T) {
	now := time.Date(2026, 10, 21, 12, 0, 0, 0, time.Local)
	mk := func(scheduleType, cronExpr, lastEval string) *db.IntentRow {
		i := &db.IntentRow{ScheduleType: scheduleType}
		i.ScheduleCron = sql.NullString{String: cronExpr, Valid: cronExpr != ""}
		i.LastEvaluatedAt = sql.NullString{String: lastEval, Valid: lastEval != ""}
		return i
	}

	if r := IsIntentDue(mk("immediate", "*/5 * * * *", ""), now); r.IsDue {
		t.Error("immediate intents must not fire from the scheduled loop")
	}
	if r := IsIntentDue(mk("scheduled", "", ""), now); r.IsDue {
		t.Error("missing cron must not fire")
	}
	if r := IsIntentDue(mk("scheduled", "not a cron", ""), now); r.IsDue {
		t.Error("invalid cron must not fire")
	}

	r := IsIntentDue(mk("scheduled", "*/5 * * * *", ""), now)
	if !r.IsDue || r.TriggerTime == nil || !r.TriggerTime.Equal(now) {
		t.Errorf("missing last_evaluated_at should be due with triggerTime=now, got %+v", r)
	}

	// Legacy unparseable value — due, anchored to now.
	r = IsIntentDue(mk("scheduled", "*/5 * * * *", "garbage"), now)
	if !r.IsDue || !r.TriggerTime.Equal(now) {
		t.Errorf("unparseable last_evaluated_at should be due with triggerTime=now, got %+v", r)
	}

	// Old last evaluation: due, trigger time is the cron point AFTER it.
	last := "2026-10-21T11:58:00.000Z"
	r = IsIntentDue(mk("scheduled", "*/5 * * * *", last), now)
	if !r.IsDue {
		t.Fatalf("expected due, got %+v", r)
	}
	want, err := cron.ParseStandard("*/5 * * * *")
	if err != nil {
		t.Fatal(err)
	}
	lastT, err := db.ParseSQLiteTime(last)
	if err != nil {
		t.Fatal(err)
	}
	expected := want.Next(lastT)
	if !r.TriggerTime.Equal(expected) {
		t.Errorf("triggerTime = %v, want cron point %v", r.TriggerTime, expected)
	}

	// Fresh last evaluation: next cron point is in the future.
	fresh := now.UTC().Format(isoMillis)
	if r := IsIntentDue(mk("scheduled", "*/5 * * * *", fresh), now); r.IsDue {
		t.Errorf("recently evaluated intent should not be due: %+v", r)
	}

	// 6-field seconds form (croner accepts it; ParseStandard does not).
	r = IsIntentDue(mk("scheduled", "0 */5 * * * *", last), now)
	if !r.IsDue {
		t.Errorf("6-field cron should parse and fire: %+v", r)
	}
}

// --- FindMatchingContainers ----------------------------------------------

func setupMatchFixture(t *testing.T) (*sql.DB, int64) {
	t.Helper()
	database := testDB(t)

	// Live runner: one container with an update, one current.
	runnerID, _ := seedRunner(t, database, "r1",
		dockhand("cid-live-up", "live-updated", "repo/app:latest", "repo/app@"+digestOld),
		dockhand("cid-live-cur", "live-current", "repo/app:latest", "repo/app@"+digestNew),
	)
	seedRegistry(t, database, "repo/app", "latest", digestNew)

	// DB row backed by the runner: superseded by the live fetch.
	if _, err := database.Exec(
		`INSERT INTO containers (user_id, container_id, container_name, image_name, runner_id)
		 VALUES (1, 'cid-db-runner', 'db-runner-backed', 'repo/app:latest', ?)`, runnerID); err != nil {
		t.Fatal(err)
	}
	// DB row with neither runner nor source: dropped by enrich semantics.
	if _, err := database.Exec(
		`INSERT INTO containers (user_id, container_id, container_name, image_name)
		 VALUES (1, 'cid-orphan', 'db-orphan', 'repo/app:latest')`); err != nil {
		t.Fatal(err)
	}
	// DB row on a known source instance with an available update.
	if _, err := database.Exec(
		`INSERT INTO source_instances (id, user_id, name, url) VALUES (7, 1, 'legacy', 'http://x')`); err != nil {
		t.Fatal(err)
	}
	di, err := database.Exec(
		`INSERT INTO deployed_images (user_id, image_digest, image_tag, repo_digests, image_repo, registry)
		 VALUES (1, ?, 'latest', ?, 'repo/src', 'docker.io')`, digestOld, `["`+digestOld+`"]`)
	if err != nil {
		t.Fatal(err)
	}
	diID, _ := di.LastInsertId()
	seedRegistry(t, database, "repo/src", "latest", digestNew)
	if _, err := database.Exec(
		`INSERT INTO containers (user_id, container_id, container_name, image_name, deployed_image_id, source_instance_id)
		 VALUES (1, 'cid-src', 'db-source', 'repo/src:latest', ?, 7)`, diID); err != nil {
		t.Fatal(err)
	}
	return database, runnerID
}

func names(rows []db.ContainerRow) string {
	out := make([]string, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.ContainerName)
	}
	sort.Strings(out)
	return strings.Join(out, ",")
}

func TestFindMatchingContainers(t *testing.T) {
	ctx := context.Background()
	database, _ := setupMatchFixture(t)

	intent := insertIntent(t, database, map[string]any{
		"name": "all", "schedule_type": "scheduled", "match_containers": `["*"]`,
	})
	out, err := FindMatchingContainers(ctx, database, intent, 1, true, false)
	if err != nil {
		t.Fatal(err)
	}
	got := names(out.Matched)
	if got != "db-source,live-updated" {
		t.Errorf("matched = [%s], want [live-updated,db-source]", got)
	}
	if len(out.Excluded) != 0 {
		t.Errorf("excluded should be empty without trackExcluded, got %d", len(out.Excluded))
	}

	// Exclusion tracking for preview.
	intent2 := insertIntent(t, database, map[string]any{
		"name": "excl", "schedule_type": "scheduled",
		"match_containers":   `["*"]`,
		"exclude_containers": `["db-source"]`,
	})
	out2, err := FindMatchingContainers(ctx, database, intent2, 1, true, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(out2.Matched) != 1 || out2.Matched[0].ContainerName != "live-updated" {
		t.Errorf("matched = [%s], want [live-updated]", names(out2.Matched))
	}
	if len(out2.Excluded) != 1 || out2.Excluded[0].Reason != "container name excluded" {
		t.Errorf("excluded = %+v, want one 'container name excluded'", out2.Excluded)
	}

	// requireUpdate=false keeps current containers too (preview semantics).
	out3, err := FindMatchingContainers(ctx, database, intent, 1, false, false)
	if err != nil {
		t.Fatal(err)
	}
	got3 := names(out3.Matched)
	if got3 != "db-source,live-current,live-updated" {
		t.Errorf("matched (requireUpdate=false) = [%s]", got3)
	}

	// Registry filters use the host vocabulary (docker.io, ghcr.io, ...) the
	// UI offers; live rows must carry it too, or every registry intent
	// silently matches zero live containers.
	intentR := insertIntent(t, database, map[string]any{
		"name": "hub", "schedule_type": "scheduled", "match_registries": `["docker.io"]`,
	})
	outR, err := FindMatchingContainers(ctx, database, intentR, 1, true, false)
	if err != nil {
		t.Fatal(err)
	}
	if gotR := names(outR.Matched); gotR != "db-source,live-updated" {
		t.Errorf("docker.io registry filter matched [%s], want [db-source,live-updated]", gotR)
	}
	intentNope := insertIntent(t, database, map[string]any{
		"name": "ghcr-only", "schedule_type": "scheduled", "match_registries": `["ghcr.io"]`,
	})
	outNope, err := FindMatchingContainers(ctx, database, intentNope, 1, true, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(outNope.Matched) != 0 {
		t.Errorf("ghcr.io filter matched %d containers, want 0", len(outNope.Matched))
	}
}

// --- Executor --------------------------------------------------------------

func TestExecuteIntentUpgrades(t *testing.T) {
	ctx := context.Background()
	database, runnerID := setupMatchFixture(t)
	intent := insertIntent(t, database, map[string]any{
		"name": "up", "schedule_type": "scheduled", "match_containers": `["live-*"]`,
	})

	var mu sync.Mutex
	var upgradedNames []string
	exec := &Executor{
		DB: database,
		Upgrade: func(ctx context.Context, userID int64, c *db.ContainerRow, rr *db.RunnerRow, imageName string) error {
			if rr == nil || rr.ID != runnerID {
				t.Errorf("upgrade got runner %+v, want id %d", rr, runnerID)
			}
			mu.Lock()
			upgradedNames = append(upgradedNames, c.ContainerName)
			mu.Unlock()
			return nil
		},
	}

	sum, err := exec.ExecuteIntent(ctx, intent, 1, ExecOptions{TriggerType: "manual"})
	if err != nil {
		t.Fatal(err)
	}
	if sum.Status != "completed" || sum.ContainersMatched != 1 || sum.ContainersUpgraded != 1 {
		t.Fatalf("summary = %+v", sum)
	}
	if len(upgradedNames) != 1 || upgradedNames[0] != "live-updated" {
		t.Errorf("upgrade calls = %v", upgradedNames)
	}

	// Execution row: created 'running' by the executor, completed at the end.
	row, err := db.GetIntentExecutionByID(ctx, database, sum.ExecutionID, 1)
	if err != nil || row == nil {
		t.Fatalf("execution row: %v", err)
	}
	if row.Status != "completed" || row.ContainersUpgraded != 1 {
		t.Errorf("execution row = %+v", row)
	}

	// Per-container row records the upgrade with the old digest.
	containers, err := db.GetIntentExecutionContainers(ctx, database, sum.ExecutionID)
	if err != nil || len(containers) != 1 {
		t.Fatalf("container rows: %v (n=%d)", err, len(containers))
	}
	cr := containers[0]
	if cr.Status != "upgraded" || cr.OldDigest.String != digestOld {
		t.Errorf("container row = %+v", cr)
	}

	// Lock released.
	if _, found, err := db.GetActiveUpgradeLockOwner(ctx, database,
		fmt.Sprintf("runner:%d:cid-live-up", runnerID)); err != nil || found {
		t.Errorf("lock should be released, found=%v err=%v", found, err)
	}

	// last_evaluated_at written as ISO millis with the execution id.
	updated, err := db.GetIntentByID(ctx, database, intent.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, perr := time.Parse(isoMillis, updated.LastEvaluatedAt.String); perr != nil {
		t.Errorf("last_evaluated_at %q not ISO millis: %v", updated.LastEvaluatedAt.String, perr)
	}
}

func TestExecuteIntentHonorsSequentialDelayAndStackGrouping(t *testing.T) {
	ctx := context.Background()
	database := testDB(t)
	seedRunner(t, database, "r1",
		withStack(dockhand("cid-d1", "delay-one", "repo/app:latest", "repo/app@"+digestOld), "web"),
		withStack(dockhand("cid-d2", "delay-two", "repo/app:latest", "repo/app@"+digestOld), "web"),
		withStack(dockhand("cid-d3", "delay-three", "repo/app:latest", "repo/app@"+digestOld), "web"),
	)
	seedRegistry(t, database, "repo/app", "latest", digestNew)

	// All three containers share one stack group, so they run sequentially
	// with sequential_delay_sec pacing between them (2 x 1s minimum).
	intent := insertIntent(t, database, map[string]any{
		"name": "delayed", "schedule_type": "scheduled", "match_containers": `["delay-*"]`,
		"max_concurrent": 4, "sequential_delay_sec": 1,
	})

	start := time.Now()
	exec := &Executor{DB: database, Upgrade: func(ctx context.Context, userID int64, c *db.ContainerRow, rr *db.RunnerRow, imageName string) error {
		return nil
	}}
	sum, err := exec.ExecuteIntent(ctx, intent, 1, ExecOptions{TriggerType: "manual"})
	if err != nil {
		t.Fatal(err)
	}
	if sum.ContainersUpgraded != 3 {
		t.Fatalf("summary = %+v", sum)
	}
	if elapsed := time.Since(start); elapsed < 2*time.Second {
		t.Errorf("elapsed %v, want >= 2s (two 1s sequential delays)", elapsed)
	}
}

func TestExecuteIntentCapsGroupConcurrency(t *testing.T) {
	ctx := context.Background()
	database := testDB(t)
	seedRunner(t, database, "r1",
		dockhand("cid-c1", "conc-one", "repo/app:latest", "repo/app@"+digestOld),
		dockhand("cid-c2", "conc-two", "repo/app:latest", "repo/app@"+digestOld),
		dockhand("cid-c3", "conc-three", "repo/app:latest", "repo/app@"+digestOld),
	)
	seedRegistry(t, database, "repo/app", "latest", digestNew)

	// Three standalone containers = three stack groups; max_concurrent=1 must
	// serialize them even though they are independent groups.
	intent := insertIntent(t, database, map[string]any{
		"name": "conc", "schedule_type": "scheduled", "match_containers": `["conc-*"]`,
		"max_concurrent": 1, "sequential_delay_sec": 0,
	})

	var mu sync.Mutex
	inFlight, peak := 0, 0
	exec := &Executor{DB: database, Upgrade: func(ctx context.Context, userID int64, c *db.ContainerRow, rr *db.RunnerRow, imageName string) error {
		mu.Lock()
		inFlight++
		if inFlight > peak {
			peak = inFlight
		}
		mu.Unlock()
		time.Sleep(40 * time.Millisecond)
		mu.Lock()
		inFlight--
		mu.Unlock()
		return nil
	}}
	sum, err := exec.ExecuteIntent(ctx, intent, 1, ExecOptions{TriggerType: "manual"})
	if err != nil {
		t.Fatal(err)
	}
	if sum.ContainersUpgraded != 3 {
		t.Fatalf("summary = %+v", sum)
	}
	if peak > 1 {
		t.Errorf("peak concurrency = %d, want 1 (max_concurrent=1)", peak)
	}
}

func TestExecuteIntentSkipsLockedContainer(t *testing.T) {
	ctx := context.Background()
	database, runnerID := setupMatchFixture(t)
	intent := insertIntent(t, database, map[string]any{
		"name": "locked", "schedule_type": "scheduled", "match_containers": `["live-updated"]`,
	})

	key := fmt.Sprintf("runner:%d:cid-live-up", runnerID)
	acquired, err := db.AcquireUpgradeLock(ctx, database, key, "intent:99:0123456789abcdef")
	if err != nil || !acquired {
		t.Fatalf("pre-acquire lock: acquired=%v err=%v", acquired, err)
	}

	called := false
	exec := &Executor{DB: database, Upgrade: func(context.Context, int64, *db.ContainerRow, *db.RunnerRow, string) error {
		called = true
		return nil
	}}
	sum, err := exec.ExecuteIntent(ctx, intent, 1, ExecOptions{TriggerType: "manual"})
	if err != nil {
		t.Fatal(err)
	}
	if called {
		t.Error("upgrade must not run for a locked container")
	}
	if sum.Status != "completed" || sum.ContainersSkipped != 1 {
		t.Fatalf("summary = %+v", sum)
	}
	// Skip reason strips the random token suffix down to the display owner.
	if len(sum.Containers) != 1 || !strings.Contains(*sum.Containers[0].ErrorMessage, "intent:99") {
		t.Errorf("skip message = %+v", sum.Containers)
	}
}

func TestExecuteIntentDryRun(t *testing.T) {
	ctx := context.Background()
	database, _ := setupMatchFixture(t)
	intent := insertIntent(t, database, map[string]any{
		"name": "dry", "schedule_type": "scheduled", "match_containers": `["live-updated"]`,
	})

	called := false
	exec := &Executor{DB: database, Upgrade: func(context.Context, int64, *db.ContainerRow, *db.RunnerRow, string) error {
		called = true
		return nil
	}}
	dry := true
	sum, err := exec.ExecuteIntent(ctx, intent, 1, ExecOptions{TriggerType: "manual", DryRun: &dry})
	if err != nil {
		t.Fatal(err)
	}
	if called {
		t.Error("dry run must not call Upgrade")
	}
	if sum.Status != "completed" || sum.ContainersMatched != 1 || sum.ContainersSkipped != 1 {
		t.Fatalf("summary = %+v", sum)
	}
	containers, _ := db.GetIntentExecutionContainers(ctx, database, sum.ExecutionID)
	if len(containers) != 1 || containers[0].Status != "dry_run" {
		t.Errorf("container rows = %+v", containers)
	}
}

func TestExecuteIntentAdoptsPreCreatedExecution(t *testing.T) {
	ctx := context.Background()
	database, _ := setupMatchFixture(t)
	intent := insertIntent(t, database, map[string]any{
		"name": "adopt", "schedule_type": "scheduled", "match_containers": `["live-updated"]`,
	})

	execID, err := db.CreateIntentExecution(ctx, database, intent.ID, 1, "manual") // 'pending'
	if err != nil {
		t.Fatal(err)
	}
	exec := &Executor{DB: database, Upgrade: func(context.Context, int64, *db.ContainerRow, *db.RunnerRow, string) error {
		return nil
	}}
	sum, err := exec.ExecuteIntent(ctx, intent, 1, ExecOptions{TriggerType: "manual", ExecutionID: &execID})
	if err != nil {
		t.Fatal(err)
	}
	if sum.ExecutionID != execID {
		t.Errorf("execution id = %d, want pre-created %d", sum.ExecutionID, execID)
	}
	var count int
	if err := database.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM intent_executions WHERE intent_id = ?`, intent.ID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Errorf("executor created %d execution rows, want exactly 1 (the adopted one)", count)
	}
}

// --- Evaluator --------------------------------------------------------------

func waitForExecution(t *testing.T, database *sql.DB, intentID int64) db.IntentExecutionRow {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		rows, _, err := db.GetIntentExecutions(context.Background(), database, 1, &intentID, 1, 0)
		if err == nil && len(rows) > 0 && rows[0].CompletedAt.Valid {
			return rows[0]
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("no completed execution for intent %d", intentID)
	return db.IntentExecutionRow{}
}

func TestEvaluateImmediateIntents(t *testing.T) {
	ctx := context.Background()
	database, _ := setupMatchFixture(t)
	intent := insertIntent(t, database, map[string]any{
		"name": "imm", "schedule_type": "immediate", "match_containers": `["live-updated"]`,
	})
	exec := &Executor{DB: database, Upgrade: func(context.Context, int64, *db.ContainerRow, *db.RunnerRow, string) error {
		return nil
	}}
	ev := NewEvaluator(database, exec)

	// No updates found — nothing fires.
	ev.EvaluateImmediateIntents(ctx, 1, 0)
	// Updates found — the immediate intent executes.
	ev.EvaluateImmediateIntents(ctx, 1, 2)

	row := waitForExecution(t, database, intent.ID)
	if row.TriggerType != "scan_detected" || row.Status != "completed" || row.ContainersUpgraded != 1 {
		t.Errorf("execution row = %+v", row)
	}
}

func TestEvaluateScheduledIntentsPreMarksCronPoint(t *testing.T) {
	ctx := context.Background()
	database, _ := setupMatchFixture(t)

	// Last evaluated 20 minutes ago against a */5 cron: exactly one unprocessed
	// cron point (the most recent one) is due.
	last := time.Now().Add(-20 * time.Minute).UTC().Format(isoMillis)
	intent := insertIntent(t, database, map[string]any{
		"name": "sched", "schedule_type": "scheduled",
		"schedule_cron": "*/5 * * * *", "last_evaluated_at": last,
		"match_containers": `["live-updated"]`,
	})
	exec := &Executor{DB: database, Upgrade: func(context.Context, int64, *db.ContainerRow, *db.RunnerRow, string) error {
		return nil
	}}
	ev := NewEvaluator(database, exec)
	ev.EvaluateScheduledIntents(ctx)

	// The pre-mark happens synchronously: last_evaluated_at is the cron point,
	// not wall-clock, and last_execution_id is untouched (-1 sentinel).
	updated, err := db.GetIntentByID(ctx, database, intent.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	lastT, err := db.ParseSQLiteTime(last)
	if err != nil {
		t.Fatal(err)
	}
	wantPoint, _ := cron.ParseStandard("*/5 * * * *")
	want := wantPoint.Next(lastT)
	got, err := db.ParseSQLiteTime(updated.LastEvaluatedAt.String)
	if err != nil {
		t.Fatalf("pre-marked last_evaluated_at %q unparseable: %v", updated.LastEvaluatedAt.String, err)
	}
	if !got.Equal(want) {
		t.Errorf("pre-marked last_evaluated_at = %v, want cron point %v", got, want)
	}

	row := waitForExecution(t, database, intent.ID)
	if row.TriggerType != "scheduled_window" {
		t.Errorf("trigger type = %q, want scheduled_window", row.TriggerType)
	}

	// The executor's final write re-anchors last_evaluated_at to the same
	// cron point (the trigger time, never wall-clock), which is what keeps a
	// cron point from ever firing twice.
	final, err := db.GetIntentByID(ctx, database, intent.ID, 1)
	if err != nil {
		t.Fatal(err)
	}
	gotFinal, err := db.ParseSQLiteTime(final.LastEvaluatedAt.String)
	if err != nil {
		t.Fatalf("final last_evaluated_at %q unparseable: %v", final.LastEvaluatedAt.String, err)
	}
	if !gotFinal.Equal(want) {
		t.Errorf("final last_evaluated_at = %v, want the same cron point %v", gotFinal, want)
	}
}
