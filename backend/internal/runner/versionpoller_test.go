package runner

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"sync/atomic"
	"testing"

	"github.com/dockedapp/backend/internal/db"
)

// --- test scaffolding ------------------------------------------------------

func pollerDB(t *testing.T) *sql.DB {
	t.Helper()
	database, err := db.Open(filepath.Join(t.TempDir(), "poller.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	for _, ddl := range []string{
		`CREATE TABLE runners (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			name TEXT NOT NULL,
			url TEXT NOT NULL,
			api_key TEXT NOT NULL,
			enabled INTEGER NOT NULL DEFAULT 1,
			version TEXT,
			latest_version TEXT,
			version_checked_at DATETIME,
			docker_enabled INTEGER,
			last_seen DATETIME,
			docker_status TEXT,
			docker_status_since DATETIME,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE runner_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			runner_id INTEGER NOT NULL,
			event_type TEXT NOT NULL,
			message TEXT,
			details TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
	} {
		if _, err := database.Exec(ddl); err != nil {
			t.Fatalf("ddl: %v", err)
		}
	}
	return database
}

// stubGitHub points GitHubAPIBase at a local releases stub and resets the
// package release cache so the poller's cached lookups are deterministic.
func stubGitHub(t *testing.T, tag string) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintf(w, `{"tag_name":%q}`, tag)
	}))
	t.Cleanup(srv.Close)
	old := GitHubAPIBase
	GitHubAPIBase = srv.URL
	releaseCacheMu.Lock()
	releaseCache = map[string]cachedRelease{}
	releaseCacheMu.Unlock()
	t.Cleanup(func() { GitHubAPIBase = old })
}

func seedRunner(t *testing.T, database *sql.DB, url string) int64 {
	t.Helper()
	res, err := database.Exec(
		`INSERT INTO runners (user_id, name, url, api_key, enabled, version, latest_version, docker_status)
		 VALUES (1, 'r1', ?, 'k1', 1, '0.1.0', 'stale', 'ok')`, url)
	if err != nil {
		t.Fatal(err)
	}
	id, _ := res.LastInsertId()
	return id
}

func getRunner(t *testing.T, database *sql.DB, id int64) db.RunnerRow {
	t.Helper()
	rn, err := db.GetRunnerByID(context.Background(), database, id, 1)
	if err != nil || rn == nil {
		t.Fatalf("get runner: %v %v", rn, err)
	}
	return *rn
}

func eventTypes(t *testing.T, database *sql.DB, runnerID int64) []string {
	t.Helper()
	rows, err := database.Query(
		"SELECT event_type FROM runner_events WHERE runner_id = ? ORDER BY id", runnerID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			t.Fatal(err)
		}
		out = append(out, s)
	}
	return out
}

// --- tests ------------------------------------------------------------------

func TestPollerHappyPathUpdatesAndEvents(t *testing.T) {
	database := pollerDB(t)
	stubGitHub(t, "0.2.0")
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"version":"0.1.5","dockerOk":false}`)
	}))
	defer srv.Close()
	id := seedRunner(t, database, srv.URL)

	p := NewVersionPoller(database)
	p.poll(context.Background())

	rn := getRunner(t, database, id)
	if rn.Version.String != "0.1.5" {
		t.Errorf("version = %q, want 0.1.5", rn.Version.String)
	}
	if rn.LatestVersion.String != "0.2.0" {
		t.Errorf("latest_version = %q, want 0.2.0 (from GitHub stub)", rn.LatestVersion.String)
	}
	if rn.DockerEnabled.Int64 != 0 {
		t.Errorf("docker_enabled = %v, want 0", rn.DockerEnabled)
	}
	if !rn.LastSeen.Valid {
		t.Error("last_seen not bumped")
	}
	// docker_status ok → unavailable is a transition → docker_change event;
	// version 0.1.0 → 0.1.5 → version_change event.
	got := eventTypes(t, database, id)
	want := []string{db.EventDockerChange, db.EventVersionChange}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Errorf("events = %v, want %v", got, want)
	}
}

func TestPollerBackoffAndReset(t *testing.T) {
	database := pollerDB(t)
	stubGitHub(t, "0.2.0")
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	defer srv.Close()
	id := seedRunner(t, database, srv.URL)

	p := NewVersionPoller(database)
	// Three failing polls → backoff engaged; also emits health_check_error
	// on the first failure and on entering backoff.
	for range 3 {
		p.poll(context.Background())
	}
	if hits.Load() != 3 {
		t.Fatalf("pings = %d, want 3", hits.Load())
	}
	// Poll 4 (4%3 != 0): skipped — no ping, but latest_version still refreshed.
	p.poll(context.Background())
	if hits.Load() != 3 {
		t.Errorf("pings during backoff = %d, want 3 (skipped)", hits.Load())
	}
	rn := getRunner(t, database, id)
	if rn.LatestVersion.String != "0.2.0" {
		t.Errorf("latest_version during backoff = %q, want 0.2.0", rn.LatestVersion.String)
	}
	if rn.Version.String != "0.1.0" {
		t.Errorf("version during backoff = %q, want stored 0.1.0 kept", rn.Version.String)
	}
	// Poll 5 (5%3 != 0): still skipped. Poll 6 (6%3 == 0): window allows an attempt.
	p.poll(context.Background())
	if hits.Load() != 3 {
		t.Errorf("pings at round 5 = %d, want 3 (still skipped)", hits.Load())
	}
	p.poll(context.Background())
	if hits.Load() != 4 {
		t.Errorf("pings at backoff window = %d, want 4", hits.Load())
	}
	// ResetBackoff clears it: next poll pings regardless of modulus.
	p.ResetBackoff(id)
	p.poll(context.Background())
	if hits.Load() != 5 {
		t.Errorf("pings after reset = %d, want 5", hits.Load())
	}
	evs := eventTypes(t, database, id)
	count := 0
	for _, e := range evs {
		if e == db.EventHealthCheckError {
			count++
		}
	}
	// 2 from the failure sequence (first failure + entering backoff) plus 1
	// after ResetBackoff re-arms the first-failure event.
	if count != 3 {
		t.Errorf("health_check_error events = %d, want 3", count)
	}
}

func TestPollerOfflineKeepsStoredFields(t *testing.T) {
	database := pollerDB(t)
	stubGitHub(t, "0.2.0")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	defer srv.Close()
	id := seedRunner(t, database, srv.URL)

	p := NewVersionPoller(database)
	p.poll(context.Background())

	rn := getRunner(t, database, id)
	if rn.Version.String != "0.1.0" {
		t.Errorf("version = %q, want stored 0.1.0 kept on failure", rn.Version.String)
	}
	if !rn.DockerEnabled.Valid {
		t.Log("docker_enabled stayed NULL as expected")
	} else {
		t.Errorf("docker_enabled = %v, want NULL kept (unknown on offline)", rn.DockerEnabled)
	}
}

func TestPollerPrunesEventsEverySixthRound(t *testing.T) {
	database := pollerDB(t)
	stubGitHub(t, "0.2.0")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, `{"version":"0.1.0","dockerOk":true}`)
	}))
	defer srv.Close()
	id := seedRunner(t, database, srv.URL)

	for i := range 250 {
		details, _ := json.Marshal(map[string]any{"i": i})
		if _, err := database.Exec(
			"INSERT INTO runner_events (runner_id, event_type, message, details) VALUES (?, 'info', ?, ?)",
			id, fmt.Sprintf("e%d", i), string(details)); err != nil {
			t.Fatal(err)
		}
	}

	p := NewVersionPoller(database)
	p.pollCount = 5 // next poll is round 6 → prune fires
	p.poll(context.Background())

	var n int
	if err := database.QueryRow("SELECT COUNT(*) FROM runner_events WHERE runner_id = ?", id).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 200 {
		t.Errorf("events after prune = %d, want 200", n)
	}
}
