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
// regenerations leave it alone. An unauthenticated or already invalid token is
// a no-op, but a revocation write that fails is returned: the caller must not
// report a successful logout while the token it was shown still authenticates.
func (r *mutationResolver) revokeCurrentToken(ctx context.Context) error {
	raw := auth.RawTokenFromContext(ctx)
	if raw == "" {
		return nil
	}
	uid, exp, err := auth.ValidateTokenClaims(raw, r.Cfg.JWTSecret)
	if err != nil {
		return nil
	}
	if err := db.RevokeToken(ctx, r.DB, raw, uid, exp); err != nil {
		slog.Warn("logout: failed to revoke token", "error", err.Error())
		return fmt.Errorf("revoke access token: %w", err)
	}
	return nil
}

// revokeRefreshToken mirrors the REST logout handler: when the caller hands
// over its refresh token, revoke it too so the session cannot be resurrected
// for the rest of the refresh token's lifetime. A failed write is returned for
// the same reason as revokeCurrentToken.
func (r *mutationResolver) revokeRefreshToken(ctx context.Context, refreshToken string) error {
	claims, err := auth.VerifyRefreshToken(refreshToken)
	if err != nil {
		return nil
	}
	var exp int64
	if claims.ExpiresAt != nil {
		exp = claims.ExpiresAt.Unix()
	}
	if err := db.RevokeToken(ctx, r.DB, refreshToken, claims.UserID, exp); err != nil {
		slog.Warn("logout: failed to revoke refresh token", "error", err.Error())
		return fmt.Errorf("revoke refresh token: %w", err)
	}
	return nil
}

// subscriptionRevalidateInterval is how often an active subscription
// re-checks that its connection's session is still alive.
const subscriptionRevalidateInterval = 30 * time.Second

// WSDisconnectKey carries the connection's context-cancel func (installed by
// the transport InitFunc) so the subscription watchdog can tear down the
// whole websocket, not just the one stream. gqlgen's transport closes a
// cancelled connection with code 1000; the client's reconnect then hits
// InitFunc, which rejects the dead token with 4401 — the session is dead
// either way, the socket just cannot be closed with 4401 directly.
type WSDisconnectKey struct{}

// WSDisconnectFromContext returns the connection's disconnect func, or nil
// when the context is not a websocket connection context. The stashed value
// is a context.CancelFunc (see server.go InitFunc), so the assertion must use
// that exact type — a plain func() assertion would never match.
func WSDisconnectFromContext(ctx context.Context) func() {
	if f, ok := ctx.Value(WSDisconnectKey{}).(context.CancelFunc); ok {
		return f
	}
	return nil
}

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
		fail := func(err error) error {
			// Terminate the whole connection, not just this stream: a
			// dead session must not keep the socket (and any other live
			// subscriptions on it) streaming.
			if disconnect := WSDisconnectFromContext(ctx); disconnect != nil {
				disconnect()
			}
			return err
		}
		checkCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		uid, tv, _, err := auth.ValidateTokenWithVersion(raw, r.Cfg.JWTSecret)
		if err != nil {
			return fail(err)
		}
		if revoked, err := db.IsTokenRevoked(checkCtx, r.DB, raw); err != nil || revoked {
			return fail(fmt.Errorf("token revoked"))
		}
		u, err := db.GetUserByID(checkCtx, r.DB, uid)
		if err != nil || u == nil {
			return fail(fmt.Errorf("user no longer exists"))
		}
		// Password change (or admin eviction) bumps token_version: an
		// already-connected subscription must die with the old sessions,
		// not keep streaming on the pre-change token.
		if tv != u.TokenVersion {
			return fail(fmt.Errorf("token superseded"))
		}
		return nil
	}
}
