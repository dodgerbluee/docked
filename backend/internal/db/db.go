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

	// modernc/sqlite is safe with multiple readers but not concurrent writers.
	// Since this service is read-only, a small pool is fine.
	database.SetMaxOpenConns(4)

	if err := database.Ping(); err != nil {
		return nil, fmt.Errorf("ping sqlite: %w", err)
	}

	return database, nil
}
