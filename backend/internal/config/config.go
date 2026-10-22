package config

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"log"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
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

	// TrustedProxies are the socket-peer networks whose X-Forwarded-For /
	// X-Real-IP headers we believe (TRUSTED_PROXIES, comma-separated CIDRs
	// or plain IPs). Requests from anywhere else keep their true peer
	// address for rate-limit identity, so a directly-exposed instance
	// cannot be spoofed with forged forwarding headers.
	TrustedProxies []*net.IPNet

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
		Addr:           addr(),
		DBPath:         dbPath(),
		JWTSecret:      jwtSecret(),
		DockedURL:      env("DOCKED_URL", ""),
		Debug:          os.Getenv("DEBUG") == "true",
		TrustedProxies: trustedProxies(),
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
	port := portFromAddr(addr())
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

// jwtSecret resolves the HS256 signing secret. The Node-era public fallback
// string is gone: a deployment that forgot JWT_SECRET was forgeable-admin by
// default. When the env var is absent we generate a strong random secret once
// and persist it next to the database (0600) so tokens survive restarts.
func jwtSecret() string {
	if v := os.Getenv("JWT_SECRET"); v != "" {
		return v
	}
	path := filepath.Join(filepath.Dir(dbPath()), "jwt_secret")
	if b, err := os.ReadFile(path); err == nil {
		if s := strings.TrimSpace(string(b)); s != "" {
			return s
		}
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		log.Fatalf("cannot generate JWT secret: %v", err)
	}
	secret := hex.EncodeToString(buf)
	// O_EXCL closes the cross-process race: two first-start processes must
	// not both persist different secrets (the later read would pick one and
	// the other process would sign with a divergent key — split-brain
	// sessions). The loser adopts the winner's file.
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if errors.Is(err, os.ErrExist) {
		for i := 0; i < 5; i++ {
			if b, rerr := os.ReadFile(path); rerr == nil {
				if s := strings.TrimSpace(string(b)); s != "" {
					log.Printf("JWT_SECRET not set; adopting secret created by another process at %s", path)
					return s
				}
			}
			time.Sleep(50 * time.Millisecond)
		}
		log.Printf("WARNING: JWT_SECRET not set and %s exists but is unreadable; using an in-memory secret", path)
		return secret
	}
	if err != nil {
		// Non-fatal: a per-process random secret is still strictly safer
		// than a public one; sessions just reset on restart.
		log.Printf("WARNING: JWT_SECRET not set and generated secret could not be persisted to %s (%v); tokens will not survive restarts", path, err)
		return secret
	}
	if _, werr := f.Write([]byte(secret)); werr != nil {
		f.Close()
		log.Printf("WARNING: JWT_SECRET not set and generated secret could not be persisted to %s (%v); tokens will not survive restarts", path, werr)
		return secret
	}
	f.Close()
	log.Printf("WARNING: JWT_SECRET not set; generated a new signing secret at %s", path)
	return secret
}

// trustedProxies parses TRUSTED_PROXIES (comma-separated CIDRs or plain IPs).
// Default when unset: loopback + RFC1918 + link-local + ULA, which covers the
// usual sidecar/LAN reverse-proxy topology while internet-routable peers
// (the spoofable, directly-exposed case) never get their XFF honored.
func trustedProxies() []*net.IPNet {
	var out []*net.IPNet
	if raw := os.Getenv("TRUSTED_PROXIES"); raw != "" {
		for _, s := range strings.Split(raw, ",") {
			s = strings.TrimSpace(s)
			if s == "" {
				continue
			}
			if !strings.Contains(s, "/") {
				if ip := net.ParseIP(s); ip != nil {
					out = append(out, singleIPNet(ip))
					continue
				}
			} else if _, n, err := net.ParseCIDR(s); err == nil {
				out = append(out, n)
				continue
			}
			log.Printf("WARNING: ignoring invalid TRUSTED_PROXIES entry %q", s)
		}
	}
	if len(out) == 0 {
		out = DefaultTrustedProxies()
	}
	return out
}

// DefaultTrustedProxies: loopback + RFC1918 + link-local + ULA — the usual
// sidecar/LAN reverse-proxy topology. Internet-routable peers (the
// spoofable, directly-exposed case) are never included.
func DefaultTrustedProxies() []*net.IPNet {
	var out []*net.IPNet
	for _, c := range []string{
		"127.0.0.0/8", "::1/128",
		"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
		"169.254.0.0/16", "fe80::/10", "fc00::/7",
	} {
		if _, n, err := net.ParseCIDR(c); err == nil {
			out = append(out, n)
		}
	}
	return out
}

func singleIPNet(ip net.IP) *net.IPNet {
	bits := 32
	if ip.To4() == nil {
		bits = 128
	}
	return &net.IPNet{IP: ip, Mask: net.CIDRMask(bits, bits)}
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

// addr resolves the listen address: explicit ADDR wins, then PORT (the
// Node-era convention, still set by docker-compose deployments), then :4000.
// The container image bakes PORT=3001 (not ADDR) so compose PORT overrides work.
func addr() string {
	if a := os.Getenv("ADDR"); a != "" {
		return a
	}
	if p := os.Getenv("PORT"); p != "" {
		return ":" + p
	}
	return ":4000"
}
