package graph

import (
	"context"
	"testing"

	"github.com/dockedapp/backend/graph/model"
	"github.com/dockedapp/backend/internal/auth"
	"github.com/dockedapp/backend/internal/db"
)

// Refresh rotation must be single-use: after a token is exchanged, the OLD
// refresh token must not mint again (otherwise a stolen or logged-out token
// stays valid for its full 7-day life).
func TestRefreshTokenSingleUse(t *testing.T) {
	auth.SetSecret("test-secret")

	database, err := db.Open(t.TempDir() + "/auth.db")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer database.Close()
	ctx := context.Background()
	if err := db.Migrate(ctx, database); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	if _, err := database.ExecContext(ctx,
		`INSERT INTO users (id, username, password_hash, role, instance_admin)
		 VALUES (1, 'u1', 'x', 'Administrator', 1)`); err != nil {
		t.Fatalf("seed user: %v", err)
	}

	_, refresh0, err := auth.GenerateTokens(1, "u1", "Administrator", 0)
	if err != nil {
		t.Fatalf("generate tokens: %v", err)
	}

	r := &Resolver{DB: database}
	mr := &mutationResolver{r}
	authCtx := auth.ContextWithUserID(ctx, 1)

	payload, err := mr.RefreshToken(authCtx, model.RefreshTokenInput{RefreshToken: refresh0})
	if err != nil {
		t.Fatalf("first refresh: %v", err)
	}

	if _, err := mr.RefreshToken(authCtx, model.RefreshTokenInput{RefreshToken: refresh0}); err == nil {
		t.Errorf("replayed refresh token still mints tokens")
	}

	if _, err := mr.RefreshToken(authCtx, model.RefreshTokenInput{RefreshToken: payload.RefreshToken}); err != nil {
		t.Errorf("rotated refresh token rejected: %v", err)
	}
}
