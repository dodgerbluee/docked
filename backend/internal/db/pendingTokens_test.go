package db

import (
	"context"
	"database/sql"
	"path/filepath"
	"sync"
	"testing"
)

const pendingDDL = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  email TEXT,
  role TEXT DEFAULT 'Administrator',
  instance_admin INTEGER DEFAULT 0,
  verification_token TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);`

func newPendingDB(t *testing.T) *sql.DB {
	t.Helper()
	database, err := Open(filepath.Join(t.TempDir(), "users.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if _, err := database.Exec(pendingDDL); err != nil {
		t.Fatalf("ddl: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return database
}

func TestPendingTokenRoundTrip(t *testing.T) {
	ctx := context.Background()
	database := newPendingDB(t)

	got, err := GetPendingToken(ctx, database, "instance_admin", "ghost")
	if err != nil || got != nil {
		t.Fatalf("expected no pending token, got %v (%v)", got, err)
	}

	if err := SetPendingToken(ctx, database, "instance_admin", "ghost", "AAAA-BBBB-CCCC"); err != nil {
		t.Fatalf("set: %v", err)
	}
	got, err = GetPendingToken(ctx, database, "instance_admin", "ghost")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got == nil || *got != "AAAA-BBBB-CCCC" {
		t.Fatalf("expected stored token, got %v", got)
	}

	// Upsert replaces (single row per kind+username).
	if err := SetPendingToken(ctx, database, "instance_admin", "ghost", "DDDD-EEEE-FFFF"); err != nil {
		t.Fatalf("re-set: %v", err)
	}
	got, _ = GetPendingToken(ctx, database, "instance_admin", "ghost")
	if got == nil || *got != "DDDD-EEEE-FFFF" {
		t.Fatalf("expected replaced token, got %v", got)
	}

	if err := DeletePendingToken(ctx, database, "instance_admin", "ghost"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	got, _ = GetPendingToken(ctx, database, "instance_admin", "ghost")
	if got != nil {
		t.Fatalf("expected cleared token, got %v", got)
	}
}

// TestConsumePendingTokenAtomicUnderContention is the regression guard for the
// one-time consumption race: N concurrent verifies of the same pending token
// must yield exactly one winner.
func TestConsumePendingTokenAtomicUnderContention(t *testing.T) {
	ctx := context.Background()
	database := newPendingDB(t)

	if err := SetPendingToken(ctx, database, "instance_admin", "ghost", "AAAA-BBBB-CCCC"); err != nil {
		t.Fatalf("set: %v", err)
	}

	const racers = 8
	var wg sync.WaitGroup
	var wins int
	var mu sync.Mutex
	for i := 0; i < racers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ok, err := ConsumePendingToken(ctx, database, "instance_admin", "ghost", "AAAA-BBBB-CCCC")
			if err != nil {
				t.Errorf("consume: %v", err)
				return
			}
			if ok {
				mu.Lock()
				wins++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if wins != 1 {
		t.Fatalf("concurrent consumption wins = %d, want exactly 1", wins)
	}

	// A wrong token must never consume (and never erase the real one).
	if err := SetPendingToken(ctx, database, "instance_admin", "ghost", "REAL-TOK-1"); err != nil {
		t.Fatalf("re-set: %v", err)
	}
	ok, err := ConsumePendingToken(ctx, database, "instance_admin", "ghost", "WRONG-TOK")
	if err != nil || ok {
		t.Fatalf("wrong token: ok=%v err=%v, want false nil", ok, err)
	}
	got, _ := GetPendingToken(ctx, database, "instance_admin", "ghost")
	if got == nil || *got != "REAL-TOK-1" {
		t.Fatalf("real token erased: %v", got)
	}
}

func TestVerifyAndClearTokenAtomic(t *testing.T) {
	ctx := context.Background()
	database := newPendingDB(t)

	if _, err := database.Exec(
		"INSERT INTO users (username, password_hash, role, instance_admin, verification_token) VALUES ('admin', 'h', 'Administrator', 1, 'TOK-1')"); err != nil {
		t.Fatalf("insert: %v", err)
	}

	ok, err := VerifyAndClearToken(ctx, database, "admin", "WRONG")
	if err != nil || ok {
		t.Fatalf("wrong token: ok=%v err=%v, want false nil", ok, err)
	}
	ok, err = VerifyAndClearToken(ctx, database, "admin", "TOK-1")
	if err != nil || !ok {
		t.Fatalf("right token: ok=%v err=%v, want true nil", ok, err)
	}
	// One-time: second use must fail.
	ok, err = VerifyAndClearToken(ctx, database, "admin", "TOK-1")
	if err != nil || ok {
		t.Fatalf("replay: ok=%v err=%v, want false nil", ok, err)
	}
}

func TestUpdateVerificationTokenAndRegisterWithEmail(t *testing.T) {
	ctx := context.Background()
	database := newPendingDB(t)

	id, role, ia, err := RegisterUser(ctx, database, "root", "hash", "root@example.com")
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	if role != "Administrator" || ia != 1 {
		t.Fatalf("first user: role=%s ia=%d", role, ia)
	}
	var email string
	if err := database.QueryRowContext(ctx, "SELECT email FROM users WHERE id = ?", id).Scan(&email); err != nil {
		t.Fatalf("read email: %v", err)
	}
	if email != "root@example.com" {
		t.Fatalf("email = %q, want root@example.com", email)
	}

	if err := UpdateVerificationToken(ctx, database, "root", "TOK-2"); err != nil {
		t.Fatalf("update token: %v", err)
	}
	var tok *string
	row := database.QueryRowContext(ctx, "SELECT verification_token FROM users WHERE id = ?", id)
	if err := row.Scan(&tok); err != nil || tok == nil || *tok != "TOK-2" {
		t.Fatalf("verification_token = %v (%v)", tok, err)
	}
}
