package config

import (
	"os"
	"strings"
)

// Config holds all runtime configuration loaded from environment variables.
type Config struct {
	// Addr is the TCP address the HTTP server listens on (e.g. ":4000").
	Addr string

	// DBPath is the path to the shared SQLite database file.
	DBPath string

	// JWTSecret is the HS256 signing secret, shared with the Node.js backend.
	JWTSecret string

	// DockedURL is the explicit externally-reachable server URL (DOCKED_URL),
	// used by the runner install/enrollment endpoints. Empty means "derive
	// from request headers", matching Node's runnerController behaviour.
	DockedURL string

	// Debug enables verbose debug logging (set DEBUG=true).
	Debug bool

	// OAuth holds the env-var SSO provider fallback (parity with Node's
	// config.oauth). DB-configured providers take precedence; these values
	// only register when no DB provider uses the same name.
	OAuth OAuthConfig
}

// OAuthConfig mirrors Node's config.oauth env block.
type OAuthConfig struct {
	Enabled         bool
	Provider        string // also the provider type: "authentik" or "generic_oidc"
	ClientID        string
	ClientSecret    string
	IssuerURL       string
	Scopes          []string
	AutoRegister    bool
	DefaultRole     string
	AllowLocalLogin bool
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
		DockedURL: env("DOCKED_URL", ""),
		Debug:     os.Getenv("DEBUG") == "true",
		OAuth: OAuthConfig{
			Enabled:      os.Getenv("OAUTH_PROVIDER") != "",
			Provider:     os.Getenv("OAUTH_PROVIDER"),
			ClientID:     os.Getenv("OAUTH_CLIENT_ID"),
			ClientSecret: os.Getenv("OAUTH_CLIENT_SECRET"),
			IssuerURL:    os.Getenv("OAUTH_ISSUER_URL"),
			Scopes:       splitScopes(os.Getenv("OAUTH_SCOPES")),
			AutoRegister: os.Getenv("OAUTH_AUTO_REGISTER") != "false",
			DefaultRole:  envOr(os.Getenv("OAUTH_DEFAULT_ROLE"), "Administrator"),
			// Node treats any value except the literal "false" as enabled.
			AllowLocalLogin: os.Getenv("OAUTH_ALLOW_LOCAL_LOGIN") != "false",
		},
	}
}

// splitScopes mirrors Node's OAUTH_SCOPES parsing: comma-split, trim, drop
// empties, default "openid,profile,email".
func splitScopes(raw string) []string {
	if raw == "" {
		raw = "openid,profile,email"
	}
	var out []string
	for _, s := range strings.Split(raw, ",") {
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func envOr(v, fallback string) string {
	if v == "" {
		return fallback
	}
	return v
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
