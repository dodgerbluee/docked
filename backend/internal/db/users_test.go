package db

import (
	"context"
	"database/sql"
	"path/filepath"
	"sync"
	"testing"
)

const usersDDL = `
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  email TEXT,
  role TEXT DEFAULT 'Administrator',
  password_changed INTEGER DEFAULT 0,
  instance_admin INTEGER DEFAULT 0,
  verification_token TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  UNIQUE(user_id, key)
);`

func newUsersDB(t *testing.T) *sql.DB {
	t.Helper()
	database, err := Open(filepath.Join(t.TempDir(), "users.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if _, err := database.Exec(usersDDL); err != nil {
		t.Fatalf("ddl: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return database
}

// TestRegisterUserSequentialBootstrap asserts the first user is an
// Administrator and every later user is a Member.
func TestRegisterUserSequentialBootstrap(t *testing.T) {
	database := newUsersDB(t)
	ctx := context.Background()

	id, role, ia, err := RegisterUser(ctx, database, "root", "hash", "")
	if err != nil {
		t.Fatalf("first RegisterUser: %v", err)
	}
	if id == 0 || role != "Administrator" || ia != 1 {
		t.Fatalf("first user = (id %d, role %q, ia %d), want Administrator/1", id, role, ia)
	}

	_, role, ia, err = RegisterUser(ctx, database, "second", "hash", "")
	if err != nil {
		t.Fatalf("second RegisterUser: %v", err)
	}
	if role != "Member" || ia != 0 {
		t.Fatalf("second user = (role %q, ia %d), want Member/0", role, ia)
	}
}

// TestRegisterUserConcurrentBootstrap is the regression guard for the racy
// bootstrap: N goroutines race to register the first user. Because the role
// decision and INSERT are a single SQL statement, SQLite's single-writer lock
// serializes them and exactly one caller must be minted an Administrator.
func TestRegisterUserConcurrentBootstrap(t *testing.T) {
	database := newUsersDB(t)
	ctx := context.Background()

	const n = 8
	var wg sync.WaitGroup
	var mu sync.Mutex
	admins := 0
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, role, _, err := RegisterUser(ctx, database, "user"+string(rune('a'+i)), "hash", "")
			if err != nil {
				t.Errorf("RegisterUser: %v", err)
				return
			}
			if role == "Administrator" {
				mu.Lock()
				admins++
				mu.Unlock()
			}
		}(i)
	}
	wg.Wait()

	if admins != 1 {
		t.Fatalf("concurrent bootstrap minted %d Administrators, want exactly 1", admins)
	}
	var count int
	if err := database.QueryRowContext(ctx, "SELECT COUNT(*) FROM users").Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != n {
		t.Fatalf("user count = %d, want %d", count, n)
	}
}

func TestRegisterUserWithCodeConsumesCodeAtomically(t *testing.T) {
	database := newUsersDB(t)
	ctx := context.Background()
	if _, err := database.ExecContext(ctx,
		"INSERT INTO settings (user_id, key, value) VALUES (0, 'registration_code', 'SHARED')"); err != nil {
		t.Fatal(err)
	}
	_, role, admin, err := RegisterUserWithCode(ctx, database, "root", "hash", "", "SHARED")
	if err != nil {
		t.Fatal(err)
	}
	if role != "Administrator" || admin != 1 {
		t.Fatalf("role/admin = %s/%d, want Administrator/1", role, admin)
	}
	var users, codes int
	if err := database.QueryRow("SELECT COUNT(*) FROM users").Scan(&users); err != nil {
		t.Fatal(err)
	}
	if err := database.QueryRow("SELECT COUNT(*) FROM settings WHERE key = 'registration_code'").Scan(&codes); err != nil {
		t.Fatal(err)
	}
	if users != 1 || codes != 0 {
		t.Fatalf("users/codes = %d/%d, want 1/0", users, codes)
	}

	if _, _, _, err := RegisterUserWithCode(ctx, database, "second", "hash", "", "SHARED"); err == nil {
		t.Fatal("consumed code was accepted again")
	}
	if err := database.QueryRow("SELECT COUNT(*) FROM users").Scan(&users); err != nil {
		t.Fatal(err)
	}
	if users != 1 {
		t.Fatalf("failed code reuse inserted a user; count=%d", users)
	}
}
