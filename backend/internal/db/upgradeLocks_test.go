package db

import (
	"context"
	"path/filepath"
	"testing"
)

func TestUpgradeLocksAndIdempotencyAreAtomic(t *testing.T) {
	database, err := Open(filepath.Join(t.TempDir(), "locks.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	ctx := context.Background()

	acquired, err := AcquireUpgradeLock(ctx, database, "runner:1:abc", "one")
	if err != nil || !acquired {
		t.Fatalf("first lock = %v, %v", acquired, err)
	}
	acquired, err = AcquireUpgradeLock(ctx, database, "runner:1:abc", "two")
	if err != nil || acquired {
		t.Fatalf("overlapping lock = %v, %v; want false", acquired, err)
	}
	if err := ReleaseUpgradeLock(ctx, database, "runner:1:abc", "one"); err != nil {
		t.Fatal(err)
	}
	acquired, err = AcquireUpgradeLock(ctx, database, "runner:1:abc", "two")
	if err != nil || !acquired {
		t.Fatalf("lock after release = %v, %v", acquired, err)
	}

	key := "retry-123"
	claimed, err := ClaimIdempotencyKey(ctx, database, 7, "trigger-intent:4", &key)
	if err != nil || !claimed {
		t.Fatalf("first claim = %v, %v", claimed, err)
	}
	claimed, err = ClaimIdempotencyKey(ctx, database, 7, "trigger-intent:4", &key)
	if err != nil || claimed {
		t.Fatalf("duplicate claim = %v, %v; want false", claimed, err)
	}
	claimed, err = ClaimIdempotencyKey(ctx, database, 8, "trigger-intent:4", &key)
	if err != nil || !claimed {
		t.Fatalf("same key for another user should be independent: %v, %v", claimed, err)
	}
}
