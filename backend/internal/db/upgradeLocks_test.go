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

	// A claim released after a failed mutation must free the key for retry
	// instead of stranding it until the 24h expiry.
	if err := ReleaseIdempotencyKey(ctx, database, 7, "trigger-intent:4", key); err != nil {
		t.Fatal(err)
	}
	claimed, err = ClaimIdempotencyKey(ctx, database, 7, "trigger-intent:4", &key)
	if err != nil || !claimed {
		t.Fatalf("claim after release = %v, %v; want true", claimed, err)
	}
	// Release is scoped: wrong op type or key must not free the live claim.
	if err := ReleaseIdempotencyKey(ctx, database, 7, "other-op", key); err != nil {
		t.Fatal(err)
	}
	if err := ReleaseIdempotencyKey(ctx, database, 7, "trigger-intent:4", "different-key"); err != nil {
		t.Fatal(err)
	}
	claimed, err = ClaimIdempotencyKey(ctx, database, 7, "trigger-intent:4", &key)
	if err != nil || claimed {
		t.Fatalf("claim after scoped non-release = %v, %v; want false", claimed, err)
	}
	// Empty key release is a no-op and must not error.
	if err := ReleaseIdempotencyKey(ctx, database, 7, "trigger-intent:4", ""); err != nil {
		t.Fatal(err)
	}
}
