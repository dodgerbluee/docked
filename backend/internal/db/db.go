package db

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

// Open opens the SQLite database at path and configures it for concurrent
// read access alongside the Node.js backend (WAL mode, 5-second busy timeout).
func Open(path string) (*sql.DB, error) {
	// modernc.org/sqlite applies PRAGMAs only through the _pragma query
	// parameter (the _journal_mode/_busy_timeout form is mattn/go-sqlite3
	// syntax and is silently ignored here). Using the wrong form meant WAL and
	// the busy timeout were never actually installed.
	dsn := fmt.Sprintf(
		"file:%s?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=cache_size(-8000)",
		path,
	)

	database, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite: %w", err)
	}

	// Keep the pool small because this process shares SQLite write access with
	// Node; WAL permits concurrent readers but SQLite still serializes writers.
	database.SetMaxOpenConns(4)

	if err := database.Ping(); err != nil {
		return nil, fmt.Errorf("ping sqlite: %w", err)
	}
	if _, err := database.Exec(`CREATE TABLE IF NOT EXISTS upgrade_locks (
		target_key TEXT PRIMARY KEY,
		owner TEXT NOT NULL,
		expires_at DATETIME NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`); err != nil {
		return nil, fmt.Errorf("ensure upgrade locks: %w", err)
	}
	if _, err := database.Exec(`CREATE TABLE IF NOT EXISTS idempotency_claims (
		user_id INTEGER NOT NULL,
		operation_type TEXT NOT NULL,
		idempotency_key TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY (user_id, operation_type, idempotency_key)
	)`); err != nil {
		return nil, fmt.Errorf("ensure idempotency claims: %w", err)
	}
	if _, err := database.Exec(`CREATE TABLE IF NOT EXISTS pending_auth_tokens (
		kind TEXT NOT NULL,
		username TEXT NOT NULL DEFAULT '',
		token TEXT NOT NULL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY (kind, username)
	)`); err != nil {
		return nil, fmt.Errorf("ensure pending auth tokens: %w", err)
	}
	if _, err := database.Exec(`CREATE TABLE IF NOT EXISTS revoked_tokens (
		token_hash TEXT PRIMARY KEY,
		user_id INTEGER NOT NULL,
		expires_at INTEGER NOT NULL,
		revoked_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`); err != nil {
		return nil, fmt.Errorf("ensure revoked tokens: %w", err)
	}
	if _, err := database.Exec(`CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires ON revoked_tokens(expires_at)`); err != nil {
		return nil, fmt.Errorf("ensure revoked tokens index: %w", err)
	}

	return database, nil
}
