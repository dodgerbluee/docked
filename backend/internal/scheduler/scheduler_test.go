package scheduler

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"github.com/dockedapp/backend/internal/db"
	"github.com/dockedapp/backend/internal/imagesync"
)

// newTestDB mirrors the live batch tables (Node-created schema: started_at /
// completed_at declared DATETIME, written via CURRENT_TIMESTAMP).
func newTestDB(t *testing.T) *sql.DB {
	t.Helper()
	database, err := db.Open(filepath.Join(t.TempDir(), "sched-test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	stmts := []string{
		`CREATE TABLE users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT, password_hash TEXT, role TEXT,
			password_changed INTEGER DEFAULT 0, instance_admin INTEGER DEFAULT 0,
			email TEXT, last_login TEXT, created_at TEXT, updated_at TEXT
		)`,
		`CREATE TABLE batch_config (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL, job_type TEXT NOT NULL,
			enabled INTEGER DEFAULT 0, interval_minutes INTEGER DEFAULT 60,
			created_at TEXT, updated_at TEXT,
			UNIQUE(user_id, job_type)
		)`,
		`CREATE TABLE batch_runs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			job_type TEXT DEFAULT 'docker-hub-pull',
			status TEXT NOT NULL,
			is_manual INTEGER DEFAULT 0,
			started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			completed_at DATETIME,
			duration_ms INTEGER,
			containers_checked INTEGER DEFAULT 0,
			containers_updated INTEGER DEFAULT 0,
			error_message TEXT,
			logs TEXT
		)`,
		`INSERT INTO users (id, username, password_hash, role, email, last_login, created_at, updated_at)
		 VALUES (1, 'u', 'x', 'user', '', '', '', '')`,
		`INSERT INTO batch_config (user_id, job_type, enabled, interval_minutes, created_at, updated_at)
		 VALUES (1, 'docker-hub-pull', 1, 20, datetime('now'), datetime('now'))`,
	}
	for _, s := range stmts {
		if _, err := database.Exec(s); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
	return database
}

func insertCompletedRun(t *testing.T, database *sql.DB, ago time.Duration) {
	t.Helper()
	_, err := database.Exec(
		`INSERT INTO batch_runs (user_id, job_type, status, started_at, completed_at, is_manual)
		 VALUES (1, 'docker-hub-pull', 'completed',
		 datetime('now', ?), datetime('now', ?), 0)`,
		"-"+itoa(int(ago.Seconds())+60)+" seconds", "-"+itoa(int(ago.Seconds()))+" seconds")
	if err != nil {
		t.Fatalf("insert run: %v", err)
	}
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}

func runCount(t *testing.T, database *sql.DB) int {
	t.Helper()
	var n int
	if err := database.QueryRow(`SELECT COUNT(*) FROM batch_runs`).Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	return n
}

// A completed run 8 minutes ago with a 20-minute interval must NOT trigger
// on the first tick (lastRunTimes seeding).
func TestSeedingPreventsImmediateRun(t *testing.T) {
	database := newTestDB(t)
	ctx := context.Background()
	insertCompletedRun(t, database, 8*time.Minute)

	// Sanity: the raw completed_at string is what the seeder must parse.
	var raw string
	if err := database.QueryRow(`SELECT completed_at FROM batch_runs LIMIT 1`).Scan(&raw); err != nil {
		t.Fatalf("raw: %v", err)
	}
	t.Logf("raw completed_at = %q", raw)

	s := New(imagesync.NewService(database, nil))
	s.initLastRuns(ctx)

	s.mu.Lock()
	seeded := len(s.lastRun)
	s.mu.Unlock()
	if seeded != 1 {
		t.Fatalf("initLastRuns seeded %d entries, want 1", seeded)
	}

	s.tick(ctx)
	time.Sleep(300 * time.Millisecond)
	if n := runCount(t, database); n != 1 {
		t.Fatalf("scheduler fired despite recent completed run: %d batch_runs rows", n)
	}
}

// A completed run 30 minutes ago with a 20-minute interval must trigger.
// The scan itself fails (no containers table) but the batch_run row proves
// the tick fired.
func TestDueJobFires(t *testing.T) {
	database := newTestDB(t)
	ctx := context.Background()
	insertCompletedRun(t, database, 30*time.Minute)

	s := New(imagesync.NewService(database, nil))
	s.initLastRuns(ctx)
	s.tick(ctx)

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if runCount(t, database) == 2 {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("scheduled job did not fire")
}

// Phase 5a: tracked-apps-check configs are scheduled too. With no prior
// runs, the tick must create a tracked-apps-check batch_run (the scan
// itself no-ops: no tracked_apps table rows / missing table fails the
// scan, which still proves the job type is driven by the Go scheduler).
func TestTrackedAppsJobFires(t *testing.T) {
	database := newTestDB(t)
	ctx := context.Background()

	if _, err := database.Exec(
		`INSERT INTO batch_config (user_id, job_type, enabled, interval_minutes, created_at, updated_at)
		 VALUES (1, 'tracked-apps-check', 1, 60, datetime('now'), datetime('now'))`); err != nil {
		t.Fatalf("seed config: %v", err)
	}

	s := New(imagesync.NewService(database, nil))
	s.initLastRuns(ctx)
	s.tick(ctx)

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		var n int
		if err := database.QueryRow(
			`SELECT COUNT(*) FROM batch_runs WHERE job_type = 'tracked-apps-check'`).Scan(&n); err != nil {
			t.Fatalf("count: %v", err)
		}
		if n == 1 {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("tracked-apps-check job did not fire")
}
