package config

import (
	"os"
	"strconv"
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

	// Edge holds the public-facing HTTP surface (phase 8b): security headers,
	// CORS, static SPA serving, version endpoint. Ported from Node's
	// server.js helmet/cors/express.static setup.
	Edge EdgeConfig
}

// EdgeConfig mirrors the env-driven knobs of Node's server.js edge layer.
type EdgeConfig struct {
	// NodeEnv is NODE_ENV ("production" gates strict CSP, CORS deny-all,
	// static serving, and the global limiter's localhost skip).
	NodeEnv string

	// HTTPS mirrors Node's isHTTPS (HTTPS=true or PROTOCOL=https): enables
	// HSTS and upgrade-insecure-requests, disables the no-store headers.
	HTTPS bool

	// Relaxed is Node's isRelaxedMode: permissive CSP and no COEP/COOP/CORP
	// (dev, DISABLE_CSP=true, or any port < 10000 without HTTPS).
	Relaxed bool

	// CORSOrigins is the allow-list for cross-origin requests. Empty means
	// deny all (Node's production default when CORS_ORIGIN is unset).
	CORSOrigins []string

	// StaticDir is the SPA build directory (Node's server/public). Served
	// when it exists, with index.html fallback for non-/api routes.
	StaticDir string

	// PackageJSON overrides the version endpoint's package.json lookup.
	PackageJSON string

	// LogsDir is the debug log-tail directory (Node's LOGS_DIR).
	LogsDir string

	// ServeEdge enables security headers + CORS on this process's responses.
	// Off during the transition (Node applies them at the edge and pipes
	// proxied responses through, which would duplicate the headers); set
	// EDGE_SERVE=true when Go becomes the edge (phase 8c).
	ServeEdge bool
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
		Edge: loadEdge(),
	}
}

// loadEdge ports Node's server.js edge-layer env logic: isHTTPS, isLocalhost,
// isRelaxedMode, the CORS origin table, and the static/version/log paths.
func loadEdge() EdgeConfig {
	nodeEnv := env("NODE_ENV", "development")
	https := os.Getenv("HTTPS") == "true" || os.Getenv("PROTOCOL") == "https"
	port := portFromAddr(env("ADDR", ":4000"))
	// Node: port < 10000 && !HTTPS counts as localhost development.
	localhost := port < 10000 && !https

	var origins []string
	if raw := os.Getenv("CORS_ORIGIN"); raw != "" {
		for _, o := range strings.Split(raw, ",") {
			if o = strings.TrimSpace(o); o != "" {
				origins = append(origins, o)
			}
		}
	} else if nodeEnv != "production" {
		origins = []string{
			"http://localhost:3000", "http://localhost:3001", "http://localhost:3002",
			"http://127.0.0.1:3000", "http://127.0.0.1:3001", "http://127.0.0.1:3002",
		}
	}
	// production without CORS_ORIGIN: origins stays nil → deny all cross-origin

	return EdgeConfig{
		NodeEnv:     nodeEnv,
		HTTPS:       https,
		Relaxed:     nodeEnv != "production" || os.Getenv("DISABLE_CSP") == "true" || localhost,
		CORSOrigins: origins,
		StaticDir:   env("STATIC_DIR", "./public"),
		PackageJSON: os.Getenv("PACKAGE_JSON"),
		LogsDir:     env("LOGS_DIR", "logs"),
		ServeEdge:   os.Getenv("EDGE_SERVE") == "true",
	}
}

// portFromAddr extracts the numeric port from a listen address (":4000",
// "0.0.0.0:4000"); unparseable addresses yield 0 (treated as localhost/dev).
func portFromAddr(addr string) int {
	i := strings.LastIndex(addr, ":")
	if i < 0 {
		return 0
	}
	p, err := strconv.Atoi(addr[i+1:])
	if err != nil {
		return 0
	}
	return p
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
