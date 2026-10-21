package graph

import (
	"context"
	"fmt"
	"log/slog"
	"time"

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

// revokeRefreshToken mirrors the REST logout handler: when the caller hands
// over its refresh token, revoke it too so the session cannot be resurrected
// for the rest of the refresh token's lifetime.
func (r *mutationResolver) revokeRefreshToken(ctx context.Context, refreshToken string) {
	claims, err := auth.VerifyRefreshToken(refreshToken)
	if err != nil {
		return
	}
	var exp int64
	if claims.ExpiresAt != nil {
		exp = claims.ExpiresAt.Unix()
	}
	if err := db.RevokeToken(ctx, r.DB, refreshToken, claims.UserID, exp); err != nil {
		slog.Warn("logout: failed to revoke refresh token", "error", err.Error())
	}
}

// subscriptionRevalidateInterval is how often an active subscription
// re-checks that its connection's session is still alive.
const subscriptionRevalidateInterval = 30 * time.Second

// subscriptionGuard returns the periodic revalidation hook for
// forwardSubscription: the raw token the websocket presented at
// connection-init time must stay unexpired, unrevoked, and mapped to an
// existing user, or the stream is terminated. HTTP-driven subscriptions
// (no stashed raw token) skip the guard.
func (r *Resolver) subscriptionGuard(ctx context.Context) func() error {
	raw := auth.RawTokenFromContext(ctx)
	if raw == "" {
		return nil
	}
	return func() error {
		checkCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		uid, err := auth.ValidateToken(raw, r.Cfg.JWTSecret)
		if err != nil {
			return err
		}
		if revoked, err := db.IsTokenRevoked(checkCtx, r.DB, raw); err != nil || revoked {
			return fmt.Errorf("token revoked")
		}
		if u, err := db.GetUserByID(checkCtx, r.DB, uid); err != nil || u == nil {
			return fmt.Errorf("user no longer exists")
		}
		return nil
	}
}
