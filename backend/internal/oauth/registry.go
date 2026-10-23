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
	// loaded records whether at least one refresh has succeeded. Until then the
	// provider set is unknown rather than empty, and the login gates must not
	// read "empty" as "SSO is off".
	loaded bool
}

func NewRegistry(database *sql.DB, cfg config.OAuthConfig) *Registry {
	return &Registry{
		database:  database,
		cfg:       cfg,
		providers: map[string]*Provider{},
		settings:  map[string]Settings{},
	}
}

// reloadTimeout bounds a registry refresh so a wedged DB can neither pin the
// reload mutex nor leave a login request waiting on it.
const reloadTimeout = 5 * time.Second

// unknownRetryTTL is how long to wait before retrying a refresh that has never
// succeeded. It is much shorter than reloadTTL because until the first success
// the provider set is unknown, and every minute spent "unknown" is a minute the
// login gates are guessing.
const unknownRetryTTL = 2 * time.Second

// EnsureFresh reloads the registry when it is older than the TTL.
func (r *Registry) EnsureFresh(ctx context.Context) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if time.Since(r.lastLoaded) < reloadTTL {
		return
	}
	// The reload must not inherit the caller's cancellation: Login calls this
	// with its request context, and a client that hangs up mid-request would
	// otherwise abort the provider read (see reloadLocked).
	rctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), reloadTimeout)
	defer cancel()
	r.reloadLocked(rctx)
}

// reloadLocked rebuilds the provider set. The rebuild is staged and only
// published on success: Login gates the local-login door on Enabled(), so a
// half-loaded (empty) set would silently open that door for the whole TTL.
func (r *Registry) reloadLocked(ctx context.Context) {
	providers, settings, err := r.loadProviders(ctx)
	if err != nil {
		// Keep serving the last good set and wait out the TTL before retrying,
		// so a broken DB cannot turn into an SSO-bypass window or a reload storm.
		slog.Warn("Could not refresh OAuth providers, keeping the previous provider set", "error", err.Error())
		if r.loaded {
			r.lastLoaded = time.Now()
		} else {
			// Nothing has ever loaded successfully, so there is no last good set
			// to fall back on and Enabled() would report "no providers" from
			// ignorance. Retry promptly instead of pinning that guess for a full
			// TTL; Known() lets the login gates fail closed in the meantime.
			r.lastLoaded = time.Now().Add(-reloadTTL + unknownRetryTTL)
		}
		return
	}
	r.providers, r.settings = providers, settings
	r.lastLoaded = time.Now()
	r.loaded = true
	if len(r.providers) == 0 {
		slog.Info("No OAuth providers configured (DB or env vars)")
	}
}

// loadProviders builds the active provider set from the DB (enabled rows) and
// the env-var fallback. It returns an error only when the provider table
// could not be read at all; a missing table is a fresh install and falls
// through to the env vars, matching Node.
func (r *Registry) loadProviders(ctx context.Context) (map[string]*Provider, map[string]Settings, error) {
	providers := map[string]*Provider{}
	settings := map[string]Settings{}
	disabled := map[string]bool{}

	rows, err := db.GetAllOAuthProviders(ctx, r.database)
	if err != nil {
		if !isMissingTableErr(err) {
			return nil, nil, err
		}
		slog.Debug("OAuth provider table not present yet, falling back to env vars", "error", err.Error())
	}
	for _, row := range rows {
		// Disabled rows are still remembered: an admin who turns a provider off
		// in the DB must not have it resurrected by the env-var fallback of the
		// same name.
		if row.Enabled != 1 {
			disabled[row.Name] = true
			continue
		}
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
		registerProvider(providers, NewProvider(pt, row.Name, row.DisplayName, row.ClientID, row.ClientSecret, row.IssuerURL, splitScopes(row.Scopes)))
		role := row.DefaultRole
		if role == "" {
			role = "Administrator"
		}
		settings[row.Name] = Settings{AutoRegister: row.AutoRegister == 1, DefaultRole: role}
	}

	if r.cfg.Enabled && !disabled[r.cfg.Provider] {
		if !validAbsoluteURL(r.cfg.IssuerURL) {
			slog.Warn("OAuth env-var provider has an invalid issuer URL, skipping")
		} else if _, exists := providers[r.cfg.Provider]; !exists {
			pt := resolveProviderType(r.cfg.Provider)
			if pt == "" {
				slog.Warn("OAuth env-var provider type is unsupported. Supported: authentik, generic_oidc")
			} else {
				registerProvider(providers, NewProvider(pt, r.cfg.Provider, "", r.cfg.ClientID, r.cfg.ClientSecret, r.cfg.IssuerURL, r.cfg.Scopes))
				settings[r.cfg.Provider] = Settings{AutoRegister: r.cfg.AutoRegister, DefaultRole: r.cfg.DefaultRole}
			}
		}
	}
	return providers, settings, nil
}

// isMissingTableErr reports the one DB error that is a normal state rather
// than a failure: the provider table has not been created yet.
func isMissingTableErr(err error) bool {
	return strings.Contains(err.Error(), "no such table")
}

func registerProvider(providers map[string]*Provider, p *Provider) {
	if _, exists := providers[p.Name]; exists {
		slog.Warn("OAuth provider is already registered, overwriting", "name", p.Name)
	}
	providers[p.Name] = p
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

// Enabled reports whether any provider is configured. It is only meaningful
// once Known() is true; before the first successful refresh it reports the
// zero value, not the absence of providers.
func (r *Registry) Enabled() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.providers) > 0
}

// Known reports whether the provider set has been read from storage at least
// once. Gates that decide whether local login is allowed must fail closed while
// this is false, otherwise a transient storage failure opens the local-login
// door for an entire TTL.
func (r *Registry) Known() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.loaded
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
