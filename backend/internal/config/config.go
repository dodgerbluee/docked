package config

import "os"

// Config holds all runtime configuration loaded from environment variables.
type Config struct {
	// Addr is the TCP address the HTTP server listens on (e.g. ":4000").
	Addr string

	// DBPath is the path to the shared SQLite database file.
	DBPath string

	// JWTSecret is the HS256 signing secret, shared with the Node.js backend.
	JWTSecret string

	// Debug enables verbose debug logging (set DEBUG=true).
	Debug bool
}

// Load reads configuration from environment variables, falling back to
// development defaults when variables are absent. A .env file in the working
// directory is loaded first (same file the Node backend reads via dotenv) so
// both processes see identical secrets and paths in .env-based deployments.
func Load() *Config {
	loadDotenv()
	return &Config{
		Addr:      env("ADDR", ":4000"),
		DBPath:    dbPath(),
		JWTSecret: env("JWT_SECRET", "change-this-secret-in-production-use-strong-random-string"),
		Debug:     os.Getenv("DEBUG") == "true",
	}
}

// dbPath mirrors the Node backend (server/db/connection.js): an explicit
// DATABASE_PATH wins, otherwise DATA_DIR/users.db (Node's default DATA_DIR
// is /data), otherwise the local-dev relative path.
func dbPath() string {
	if v := os.Getenv("DATABASE_PATH"); v != "" {
		return v
	}
	if v := os.Getenv("DATA_DIR"); v != "" {
		return v + "/users.db"
	}
	// Node's default DATA_DIR is /data; only use it when it actually exists,
	// otherwise fall back to the local-dev relative path.
	if _, err := os.Stat("/data"); err == nil {
		return "/data/users.db"
	}
	return "../data/users.db"
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
