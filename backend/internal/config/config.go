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
// development defaults when variables are absent.
func Load() *Config {
	return &Config{
		Addr:      env("ADDR", ":4000"),
		DBPath:    env("DATABASE_PATH", "../data/users.db"),
		JWTSecret: env("JWT_SECRET", "change-this-secret-in-production-use-strong-random-string"),
		Debug:     os.Getenv("DEBUG") == "true",
	}
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
