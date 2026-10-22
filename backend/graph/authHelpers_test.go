package graph

import (
	"context"
	"testing"

	"github.com/dockedapp/backend/internal/auth"
	"github.com/dockedapp/backend/internal/config"
	"github.com/dockedapp/backend/internal/db"
)

// The forwardSubscription watchdog must terminate streams whose token was
// superseded by a password change (token_version bump), not just expired or
// revoked ones.
func TestSubscriptionGuardEvictsSupersededToken(t *testing.T) {
	const secret = "subguard-test-secret"
	auth.SetSecret(secret)
	database, err := db.Open(t.TempDir() + "/subguard.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	ctx := context.Background()
	if err := db.Migrate(ctx, database); err != nil {
		t.Fatal(err)
	}
	uid, err := db.CreateUser(ctx, database, "streamer", "hash", "Administrator", 1)
	if err != nil {
		t.Fatal(err)
	}
	token, _, err := auth.GenerateTokens(uid, "streamer", "Administrator", 0)
	if err != nil {
		t.Fatal(err)
	}

	r := &Resolver{DB: database, Cfg: &config.Config{JWTSecret: secret}}
	guard := r.subscriptionGuard(auth.ContextWithRawToken(ctx, token))
	if guard == nil {
		t.Fatal("expected a guard for a raw-token context")
	}
	if err := guard(); err != nil {
		t.Fatalf("live token rejected: %v", err)
	}

	if _, err := database.Exec("UPDATE users SET token_version = 1 WHERE id = ?", uid); err != nil {
		t.Fatal(err)
	}
	if err := guard(); err == nil {
		t.Error("superseded token must terminate the subscription")
	}

	// HTTP-driven subscriptions (no stashed raw token) skip the guard.
	if g := r.subscriptionGuard(ctx); g != nil {
		t.Error("guard should be nil without a raw token")
	}
}
