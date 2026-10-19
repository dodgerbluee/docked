package graph

import (
	"context"
	"log/slog"

	"github.com/dockedapp/backend/internal/auth"
	"github.com/dockedapp/backend/internal/db"
)

// revokeCurrentToken invalidates the bearer token the caller presented so it
// cannot be replayed after logout. Lives outside schema.resolvers.go so gqlgen
// regenerations leave it alone. Best-effort: an unauthenticated or already
// invalid token is a no-op.
func (r *mutationResolver) revokeCurrentToken(ctx context.Context) {
	raw := auth.RawTokenFromContext(ctx)
	if raw == "" {
		return
	}
	uid, exp, err := auth.ValidateTokenClaims(raw, r.Cfg.JWTSecret)
	if err != nil {
		return
	}
	if err := db.RevokeToken(ctx, r.DB, raw, uid, exp); err != nil {
		slog.Warn("logout: failed to revoke token", "error", err.Error())
	}
}
