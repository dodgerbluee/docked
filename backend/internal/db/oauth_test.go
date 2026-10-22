package db

import (
	"context"
	"testing"
)

// The first-user privilege is decided INSIDE the insert statement (atomic
// INSERT...SELECT), so the first OAuth login becomes instance admin and every
// later one never can. The old count-then-insert pattern raced: two
// concurrent first logins could both mint instance_admin=1.
func TestCreateOAuthUserFirstUserAtomic(t *testing.T) {
	database := testDB(t)
	migrate(t, database)
	ctx := context.Background()

	id1, admin1, err := CreateOAuthUser(ctx, database, "sso-first", nil, "github", "111", "Member")
	if err != nil {
		t.Fatalf("CreateOAuthUser first: %v", err)
	}
	if id1 == 0 || !admin1 {
		t.Fatalf("first oauth user = (id %d, admin %v), want admin true", id1, admin1)
	}

	id2, admin2, err := CreateOAuthUser(ctx, database, "sso-second", nil, "github", "222", "Member")
	if err != nil {
		t.Fatalf("CreateOAuthUser second: %v", err)
	}
	if admin2 {
		t.Error("second oauth user must not be instance admin")
	}

	var stored int
	if err := database.QueryRowContext(ctx,
		`SELECT instance_admin FROM users WHERE id = ?`, id1).Scan(&stored); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if stored != 1 {
		t.Errorf("first user instance_admin column = %d, want 1", stored)
	}
	if err := database.QueryRowContext(ctx,
		`SELECT instance_admin FROM users WHERE id = ?`, id2).Scan(&stored); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if stored != 0 {
		t.Errorf("second user instance_admin column = %d, want 0", stored)
	}
}
