package db

import (
	"context"
	"database/sql"
)

// AcquireUpgradeLock atomically claims a target across every process sharing
// the SQLite database. Expired locks can be replaced after ten minutes.
func AcquireUpgradeLock(ctx context.Context, database *sql.DB, targetKey, owner string) (bool, error) {
	result, err := database.ExecContext(ctx, `
		INSERT INTO upgrade_locks (target_key, owner, expires_at)
		VALUES (?, ?, datetime('now', '+10 minutes'))
		ON CONFLICT(target_key) DO UPDATE SET
			owner = excluded.owner,
			expires_at = excluded.expires_at,
			created_at = CURRENT_TIMESTAMP
		WHERE upgrade_locks.expires_at <= CURRENT_TIMESTAMP`, targetKey, owner)
	if err != nil {
		return false, err
	}
	changed, err := result.RowsAffected()
	return changed == 1, err
}

func ReleaseUpgradeLock(ctx context.Context, database *sql.DB, targetKey, owner string) error {
	_, err := database.ExecContext(ctx,
		"DELETE FROM upgrade_locks WHERE target_key = ? AND owner = ?", targetKey, owner)
	return err
}

// ClaimIdempotencyKey accepts a client key once per user and operation type.
// Claims expire after 24 hours to bound storage while covering normal retries.
func ClaimIdempotencyKey(ctx context.Context, database *sql.DB, userID int64, operationType string, key *string) (bool, error) {
	if key == nil || *key == "" {
		return true, nil
	}
	if _, err := database.ExecContext(ctx,
		"DELETE FROM idempotency_claims WHERE created_at < datetime('now', '-24 hours')"); err != nil {
		return false, err
	}
	result, err := database.ExecContext(ctx, `
		INSERT OR IGNORE INTO idempotency_claims (user_id, operation_type, idempotency_key)
		VALUES (?, ?, ?)`, userID, operationType, *key)
	if err != nil {
		return false, err
	}
	changed, err := result.RowsAffected()
	return changed == 1, err
}
