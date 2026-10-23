package db

import (
	"database/sql"
	"fmt"
	"strings"

	_ "modernc.org/sqlite"
)

// Open opens the SQLite database at path and configures it for concurrent
// read access alongside the Node.js backend (WAL mode, 5-second busy timeout).
func Open(path string) (*sql.DB, error) {
	// modernc.org/sqlite applies PRAGMAs only through the _pragma query
	// parameter (the _journal_mode/_busy_timeout form is mattn/go-sqlite3
	// syntax and is silently ignored here). Using the wrong form meant WAL and
	// the busy timeout were never actually installed.
	//
	// foreign_keys is deliberately NOT enabled: Node (better-sqlite3) never
	// enforced it either, and the users-rebuild migration left child tables
	// whose FK text points at the dropped "users_old" — enforcement would
	// turn every insert into those tables into an error. Cascade deletes are
	// therefore done explicitly (DeleteUser / DeleteRunner). ensureSchema
	// repairs the orphans the unenforced era accumulated.
	dsn := fmt.Sprintf(
		"file:%s?_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)&_pragma=busy_timeout(5000)&_pragma=cache_size(-8000)",
		path,
	)

	database, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}
	// Everything below can fail, and a returned error means the caller never
	// receives the handle, so nothing would ever close it. A leaked *sql.DB
	// leaves WAL file handles behind on any startup retry loop.
	closeOnErr := func(err error) error {
		_ = database.Close()
		return err
	}

	// Keep the pool small because this process shares SQLite write access with
	// Node; WAL permits concurrent readers but SQLite still serializes writers.
	database.SetMaxOpenConns(4)

	if err := database.Ping(); err != nil {
		return nil, closeOnErr(fmt.Errorf("ping sqlite: %w", err))
	}
	if _, err := database.Exec(`CREATE TABLE IF NOT EXISTS upgrade_locks (
		target_key TEXT PRIMARY KEY,
		owner TEXT NOT NULL,
		expires_at DATETIME NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`); err != nil {
		return nil, closeOnErr(fmt.Errorf("ensure upgrade locks: %w", err))
	}
	if _, err := database.Exec(`CREATE TABLE IF NOT EXISTS idempotency_claims (
		user_id INTEGER NOT NULL,
		operation_type TEXT NOT NULL,
		idempotency_key TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY (user_id, operation_type, idempotency_key)
	)`); err != nil {
		return nil, closeOnErr(fmt.Errorf("ensure idempotency claims: %w", err))
	}
	if _, err := database.Exec(`CREATE TABLE IF NOT EXISTS pending_auth_tokens (
		kind TEXT NOT NULL,
		username TEXT NOT NULL DEFAULT '',
		token TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY (kind, username)
	)`); err != nil {
		return nil, closeOnErr(fmt.Errorf("ensure pending auth tokens: %w", err))
	}
	if _, err := database.Exec(`CREATE TABLE IF NOT EXISTS revoked_tokens (
		token_hash TEXT PRIMARY KEY,
		user_id INTEGER NOT NULL,
		expires_at INTEGER NOT NULL,
		revoked_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`); err != nil {
		return nil, closeOnErr(fmt.Errorf("ensure revoked tokens: %w", err))
	}
	if _, err := database.Exec(`CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires ON revoked_tokens(expires_at)`); err != nil {
		return nil, closeOnErr(fmt.Errorf("ensure revoked tokens index: %w", err))
	}
	// oauth_states backs the SSO CSRF/PKCE flow (Node migrations 0003/0004
	// create it today; Go writes it too, so it must survive the Node cutover).
	if _, err := database.Exec(`CREATE TABLE IF NOT EXISTS oauth_states (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		state TEXT UNIQUE NOT NULL,
		code_verifier TEXT NOT NULL,
		nonce TEXT NOT NULL,
		redirect_uri TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		provider_name TEXT
	)`); err != nil {
		return nil, closeOnErr(fmt.Errorf("ensure oauth states: %w", err))
	}
	// Pre-0004 databases lack provider_name; add it when missing (the
	// duplicate-column error is expected and ignored).
	if _, err := database.Exec(`ALTER TABLE oauth_states ADD COLUMN provider_name TEXT`); err != nil &&
		!strings.Contains(err.Error(), "duplicate column name") {
		return nil, closeOnErr(fmt.Errorf("ensure oauth states provider_name: %w", err))
	}
	if _, err := database.Exec(`CREATE INDEX IF NOT EXISTS idx_oauth_states_created_at ON oauth_states(created_at)`); err != nil {
		return nil, closeOnErr(fmt.Errorf("ensure oauth states index: %w", err))
	}

	return database, nil
}

// OpenReadOnly opens the same SQLite file with a read-only connection: the
// engine rejects every write regardless of the SQL text. The debug endpoint's
// statement-prefix allowlist cannot enforce this (WITH ... INSERT and PRAGMA
// writes slip through string checks), so arbitrary SQL runs here instead.
func OpenReadOnly(path string) (*sql.DB, error) {
	dsn := fmt.Sprintf("file:%s?mode=ro&_pragma=busy_timeout(5000)", path)
	database, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite read-only: %w", err)
	}
	if err := database.Ping(); err != nil {
		_ = database.Close()
		return nil, fmt.Errorf("ping sqlite read-only: %w", err)
	}
	// One connection is enough: this pool exists only to run the single
	// statement the debug endpoint accepts, and it must not compete with the
	// main pool for SQLite's writer lock.
	database.SetMaxOpenConns(1)
	return database, nil
}
