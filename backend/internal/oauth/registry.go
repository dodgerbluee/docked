package oauth

// Provider registry ported from Node's services/oauth/index.js: DB-configured
// (admin-managed) providers take precedence, environment variables are the
// fallback, and the set is lazily refreshed so SSO CRUD done through the
// GraphQL layer becomes visible without a restart.

import (
	"context"
	"database/sql"
	"log/slog"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/dockedapp/backend/internal/config"
	"github.com/dockedapp/backend/internal/db"
)

// reloadTTL mirrors Node's RELOAD_TTL_MS (15s): EnsureFresh reloads at most
// this often.
const reloadTTL = 15 * time.Second

// Settings are the per-provider registration options.
type Settings struct {
	AutoRegister bool
	DefaultRole  string
}

// PublicInfo is what GET /auth/oauth/providers exposes.
type PublicInfo struct {
	Name        string
	DisplayName string
}

// Registry holds the active provider set.
type Registry struct {
	database *sql.DB
	cfg      config.OAuthConfig

	mu         sync.Mutex
	providers  map[string]*Provider
	settings   map[string]Settings
	lastLoaded time.Time
}

func NewRegistry(database *sql.DB, cfg config.OAuthConfig) *Registry {
	return &Registry{
		database:  database,
		cfg:       cfg,
		providers: map[string]*Provider{},
		settings:  map[string]Settings{},
	}
}

// EnsureFresh reloads the registry when it is older than the TTL.
func (r *Registry) EnsureFresh(ctx context.Context) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if time.Since(r.lastLoaded) < reloadTTL {
		return
	}
	r.reloadLocked(ctx)
}

func (r *Registry) reloadLocked(ctx context.Context) {
	r.providers = map[string]*Provider{}
	r.settings = map[string]Settings{}
	r.initializeFromDB(ctx)
	r.initializeFromEnv()
	r.lastLoaded = time.Now()
	if len(r.providers) == 0 {
		slog.Info("No OAuth providers configured (DB or env vars)")
	}
}

func (r *Registry) initializeFromDB(ctx context.Context) {
	rows, err := db.GetEnabledOAuthProviders(ctx, r.database)
	if err != nil {
		// The table may not exist yet on a fresh install (Node's migration
		// creates it); fall through to env vars like Node does.
		slog.Debug("Could not load OAuth providers from DB, falling back to env vars", "error", err.Error())
		return
	}
	for _, row := range rows {
		if row.ClientID == "" || row.ClientSecret == "" || row.IssuerURL == "" {
			slog.Warn("OAuth provider missing required fields (client_id, client_secret, issuer_url), skipping", "name", row.Name)
			continue
		}
		if !validAbsoluteURL(row.IssuerURL) {
			slog.Warn("OAuth provider has invalid issuer URL, skipping", "name", row.Name)
			continue
		}
		pt := resolveProviderType(row.ProviderType)
		if pt == "" {
			slog.Warn("Unknown provider type, skipping", "type", row.ProviderType, "name", row.Name)
			continue
		}
		p := NewProvider(pt, row.Name, row.DisplayName, row.ClientID, row.ClientSecret, row.IssuerURL, splitScopes(row.Scopes))
		r.registerLocked(p)
		role := row.DefaultRole
		if role == "" {
			role = "Administrator"
		}
		r.settings[row.Name] = Settings{AutoRegister: row.AutoRegister == 1, DefaultRole: role}
	}
}

func (r *Registry) initializeFromEnv() {
	if !r.cfg.Enabled {
		return
	}
	if !validAbsoluteURL(r.cfg.IssuerURL) {
		slog.Warn("OAuth env-var provider has an invalid issuer URL, skipping")
		return
	}
	if _, exists := r.providers[r.cfg.Provider]; exists {
		return
	}
	pt := resolveProviderType(r.cfg.Provider)
	if pt == "" {
		slog.Warn("OAuth env-var provider type is unsupported. Supported: authentik, generic_oidc")
		return
	}
	p := NewProvider(pt, r.cfg.Provider, "", r.cfg.ClientID, r.cfg.ClientSecret, r.cfg.IssuerURL, r.cfg.Scopes)
	r.registerLocked(p)
	r.settings[r.cfg.Provider] = Settings{AutoRegister: r.cfg.AutoRegister, DefaultRole: r.cfg.DefaultRole}
}

func (r *Registry) registerLocked(p *Provider) {
	if _, exists := r.providers[p.Name]; exists {
		slog.Warn("OAuth provider is already registered, overwriting", "name", p.Name)
	}
	r.providers[p.Name] = p
	slog.Info("Registered OAuth provider", "name", p.Name, "displayName", p.DisplayName)
}

// validAbsoluteURL approximates Node's `new URL(x)` guard: an absolute URL
// with a scheme and host.
func validAbsoluteURL(raw string) bool {
	if raw == "" {
		return false
	}
	u, err := url.Parse(raw)
	return err == nil && u.Scheme != "" && u.Host != ""
}

// resolveProviderType normalizes the provider type string; empty means
// unsupported.
func resolveProviderType(providerType string) string {
	switch strings.ToLower(providerType) {
	case "authentik":
		return "authentik"
	case "generic_oidc":
		return "generic_oidc"
	default:
		return ""
	}
}

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

// GetProvider returns a registered provider or nil.
func (r *Registry) GetProvider(name string) *Provider {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.providers[name]
}

// ConfiguredProviders lists the active providers for the login page.
func (r *Registry) ConfiguredProviders() []PublicInfo {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]PublicInfo, 0, len(r.providers))
	for _, p := range r.providers {
		out = append(out, PublicInfo{Name: p.Name, DisplayName: p.DisplayName})
	}
	return out
}

// Enabled reports whether any provider is configured.
func (r *Registry) Enabled() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.providers) > 0
}

// ProviderSettings falls back to the env-var config for unknown names,
// matching Node's getProviderSettings.
func (r *Registry) ProviderSettings(name string) Settings {
	r.mu.Lock()
	defer r.mu.Unlock()
	if s, ok := r.settings[name]; ok {
		return s
	}
	return Settings{AutoRegister: r.cfg.AutoRegister, DefaultRole: r.cfg.DefaultRole}
}

// AllowLocalLoginDefault exposes the env-var OAUTH_ALLOW_LOCAL_LOGIN default
// used by GET /auth/oauth/providers before the DB setting overrides it.
func (r *Registry) AllowLocalLoginDefault() bool {
	return r.cfg.AllowLocalLogin
}
