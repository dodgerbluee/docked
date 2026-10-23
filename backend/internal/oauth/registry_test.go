package oauth

// The login handler gates the password-login door on Enabled(), so the
// registry must never publish an empty provider set because of a failed
// reload, and an admin-disabled provider must not come back through the
// env-var fallback.

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"github.com/dockedapp/backend/internal/config"
)

func newProviderDB(t *testing.T) *sql.DB {
	t.Helper()
	database, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "oauth-test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = database.Close() })
	if _, err := database.Exec(`CREATE TABLE oauth_providers (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT UNIQUE NOT NULL,
		display_name TEXT NOT NULL,
		provider_type TEXT NOT NULL,
		client_id TEXT NOT NULL,
		client_secret TEXT NOT NULL,
		issuer_url TEXT NOT NULL,
		scopes TEXT DEFAULT 'openid,profile,email',
		auto_register INTEGER DEFAULT 1,
		default_role TEXT DEFAULT 'Administrator',
		enabled INTEGER DEFAULT 1,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`); err != nil {
		t.Fatalf("create table: %v", err)
	}
	return database
}

func insertProvider(t *testing.T, database *sql.DB, name string, enabled int) {
	t.Helper()
	_, err := database.Exec(`INSERT INTO oauth_providers
		(name, display_name, provider_type, client_id, client_secret, issuer_url, enabled)
		VALUES (?, ?, 'authentik', 'cid', 'secret', 'https://idp.example.com/', ?)`,
		name, name, enabled)
	if err != nil {
		t.Fatalf("insert provider %s: %v", name, err)
	}
}

// A failed provider read must keep the last good set: an empty registry would
// make Login treat SSO-only mode as "no SSO configured" and accept passwords.
func TestReloadKeepsLastGoodSetOnDBFailure(t *testing.T) {
	database := newProviderDB(t)
	insertProvider(t, database, "authentik", 1)

	r := NewRegistry(database, config.OAuthConfig{})
	r.EnsureFresh(context.Background())
	if !r.Enabled() || r.GetProvider("authentik") == nil {
		t.Fatal("expected the DB provider to be registered on first load")
	}

	// Any read failure that is not "table missing" (closed pool, locked DB,
	// wedged connection) must not publish an empty set.
	if err := database.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	r.reloadLocked(context.Background())
	if !r.Enabled() {
		t.Fatal("failed reload cleared the provider set: local login would be allowed")
	}
	if r.GetProvider("authentik") == nil {
		t.Fatal("failed reload dropped the configured provider")
	}
	if r.lastLoaded.IsZero() {
		t.Fatal("failed reload must still stamp lastLoaded so retries stay bounded by the TTL")
	}
}

// Login passes its request context to EnsureFresh. A client that hangs up
// mid-request must not abort the provider read.
func TestEnsureFreshIgnoresCallerCancellation(t *testing.T) {
	database := newProviderDB(t)
	insertProvider(t, database, "authentik", 1)

	r := NewRegistry(database, config.OAuthConfig{})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	r.EnsureFresh(ctx)
	if !r.Enabled() || r.GetProvider("authentik") == nil {
		t.Fatal("a cancelled caller context aborted the provider reload")
	}
}

// Disabling a provider in the DB is an explicit admin decision: the env-var
// fallback of the same name must not resurrect it.
func TestDisabledDBProviderBlocksEnvFallback(t *testing.T) {
	database := newProviderDB(t)
	insertProvider(t, database, "authentik", 0)

	cfg := config.OAuthConfig{
		Enabled: true, Provider: "authentik", ClientID: "env-cid", ClientSecret: "env-secret",
		IssuerURL: "https://idp.example.com/", DefaultRole: "Administrator",
	}
	r := NewRegistry(database, cfg)
	r.EnsureFresh(context.Background())

	if p := r.GetProvider("authentik"); p != nil {
		t.Fatalf("disabled provider came back via env fallback: %+v", p)
	}
	if r.Enabled() {
		t.Fatal("registry reports providers configured when the only one is disabled")
	}
}

// A fresh install has no provider table yet; that is not a read failure and
// must still allow the env-var provider.
func TestMissingTableFallsBackToEnv(t *testing.T) {
	database, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "empty.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer database.Close()

	cfg := config.OAuthConfig{
		Enabled: true, Provider: "authentik", ClientID: "env-cid", ClientSecret: "env-secret",
		IssuerURL: "https://idp.example.com/", DefaultRole: "Administrator",
	}
	r := NewRegistry(database, cfg)
	r.EnsureFresh(context.Background())

	if r.GetProvider("authentik") == nil {
		t.Fatal("env-var provider was not registered when the provider table is absent")
	}
	if got := r.ProviderSettings("authentik").DefaultRole; got != "Administrator" {
		t.Fatalf("env provider settings lost: got %q", got)
	}
}

// The TTL bounds reloads; a failed reload must not turn into a per-request
// retry storm.
func TestFailedReloadWaitsOutTTL(t *testing.T) {
	database := newProviderDB(t)
	insertProvider(t, database, "authentik", 1)
	r := NewRegistry(database, config.OAuthConfig{})
	r.reloadLocked(context.Background())
	if err := database.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	if time.Since(r.lastLoaded) > reloadTTL {
		t.Fatal("failed reload did not stamp lastLoaded")
	}
}
