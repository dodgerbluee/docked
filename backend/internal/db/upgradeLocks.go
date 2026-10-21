package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
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

// RefreshUpgradeLock extends a held lock's expiry. Mirrors the 60s heartbeat
// in Node's upgradeLockManager: only the holder (owner token) can extend it.
func RefreshUpgradeLock(ctx context.Context, database *sql.DB, targetKey, owner string) error {
	_, err := database.ExecContext(ctx,
		`UPDATE upgrade_locks SET expires_at = datetime('now', '+10 minutes')
		 WHERE target_key = ? AND owner = ?`, targetKey, owner)
	return err
}

// GetActiveUpgradeLockOwner returns the owner token of a non-expired lock,
// if one exists. Used to name the current holder in 409 conflict messages.
func GetActiveUpgradeLockOwner(ctx context.Context, database *sql.DB, targetKey string) (string, bool, error) {
	var owner string
	err := database.QueryRowContext(ctx,
		`SELECT owner FROM upgrade_locks WHERE target_key = ? AND expires_at > CURRENT_TIMESTAMP`,
		targetKey).Scan(&owner)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("get upgrade lock owner: %w", err)
	}
	return owner, true, nil
}

// UpgradeLockRow is one live entry in the cross-process upgrade lock table
// (debug introspection view of what Node's in-memory lock manager used to
// expose).
type UpgradeLockRow struct {
	Key       string
	Owner     string
	CreatedAt string
	ExpiresAt string
}

// ListActiveUpgradeLocks returns every non-expired lock.
func ListActiveUpgradeLocks(ctx context.Context, database *sql.DB) ([]UpgradeLockRow, error) {
	rows, err := database.QueryContext(ctx,
		`SELECT target_key, owner, created_at, expires_at
		 FROM upgrade_locks WHERE expires_at > CURRENT_TIMESTAMP ORDER BY created_at`)
	if err != nil {
		return nil, fmt.Errorf("list upgrade locks: %w", err)
	}
	defer rows.Close()
	var out []UpgradeLockRow
	for rows.Next() {
		var l UpgradeLockRow
		if err := rows.Scan(&l.Key, &l.Owner, &l.CreatedAt, &l.ExpiresAt); err != nil {
			return nil, fmt.Errorf("scan upgrade lock: %w", err)
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// CountActiveUpgradeLocks reports how many locks are currently held.
func CountActiveUpgradeLocks(ctx context.Context, database *sql.DB) (int, error) {
	var n int
	err := database.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM upgrade_locks WHERE expires_at > CURRENT_TIMESTAMP`).Scan(&n)
	return n, err
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

// ReleaseIdempotencyKey undoes a claim. Callers that claim a key and then
// fail BEFORE any work was recorded (e.g. the batch-run insert errors out)
// must release it, otherwise a legitimate retry with the same key is
// rejected as a duplicate for the full 24h expiry window.
func ReleaseIdempotencyKey(ctx context.Context, database *sql.DB, userID int64, operationType string, key string) error {
	if key == "" {
		return nil
	}
	_, err := database.ExecContext(ctx, `
		DELETE FROM idempotency_claims
		WHERE user_id = ? AND operation_type = ? AND idempotency_key = ?`,
		userID, operationType, key)
	return err
}
