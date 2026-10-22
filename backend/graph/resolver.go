package graph

import (
	"context"
	"database/sql"

	"github.com/dockedapp/backend/internal/config"
	"github.com/dockedapp/backend/internal/db"
	"github.com/dockedapp/backend/internal/events"
	"github.com/dockedapp/backend/internal/imagesync"
	"github.com/dockedapp/backend/internal/intents"
	"github.com/dockedapp/backend/internal/oauth"
)

// Resolver holds shared dependencies injected into all resolvers.
type Resolver struct {
	DB   *sql.DB
	Cfg  *config.Config
	Hub  *events.Hub
	Sync *imagesync.Service

	// OAuth is the SSO provider registry; the auth resolvers consult it to
	// enforce oauth_allow_local_login server-side (the client hides the
	// form, but the mutation must refuse too).
	OAuth *oauth.Registry

	// Intents is the shared scheduled/immediate intent evaluator wired by
	// api.NewServer; resolvers borrow its executor for manual triggers.
	Intents *intents.Evaluator
}

// localLoginAllowed reports whether password login/registration may run.
// With SSO enabled and local login disabled, only the SSO path is open —
// the setting is admin-togglable at runtime, so the DB row overrides the
// env default (same precedence as the providers listing endpoint).
func (r *Resolver) localLoginAllowed(ctx context.Context) bool {
	if r.OAuth == nil {
		return true
	}
	r.OAuth.EnsureFresh(ctx)
	if !r.OAuth.Enabled() {
		return true
	}
	allow := r.OAuth.AllowLocalLoginDefault()
	if v, err := db.GetSystemSetting(ctx, r.DB, "oauth_allow_local_login"); err == nil && v != nil {
		allow = *v != "false"
	}
	return allow
}
