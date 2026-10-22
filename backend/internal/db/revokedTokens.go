package db

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"time"
)

// Token revocation. JWTs are stateless, so logging out cannot by itself
// invalidate a leaked token before its exp claim (up to 24h of replay window).
// Both backends share this table: the logout path records the SHA-256 hash of
// the presented token, and every authenticated request rejects a hash found
// here. Rows become redundant once the token would have expired on its own and
// are pruned then.

func revokedTokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// RevokeToken records a token so it is rejected before its natural expiry.
// expiresAt is the token's exp claim (unix seconds). Idempotent.
func RevokeToken(ctx context.Context, database *sql.DB, token string, userID, expiresAt int64) error {
	if _, err := database.ExecContext(ctx,
		`INSERT OR IGNORE INTO revoked_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)`,
		revokedTokenHash(token), userID, expiresAt); err != nil {
		return fmt.Errorf("revoke token: %w", err)
	}
	return nil
}

// ClaimToken atomically marks a token as consumed and reports whether THIS
// call was the first to do it. Unlike check-then-revoke, two racing requests
// cannot both claim the same refresh token: exactly one sees RowsAffected==1.
func ClaimToken(ctx context.Context, database *sql.DB, token string, userID, expiresAt int64) (bool, error) {
	res, err := database.ExecContext(ctx,
		`INSERT INTO revoked_tokens (token_hash, user_id, expires_at) VALUES (?, ?, ?)
		 ON CONFLICT(token_hash) DO NOTHING`,
		revokedTokenHash(token), userID, expiresAt)
	if err != nil {
		return false, fmt.Errorf("claim token: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("claim token rows: %w", err)
	}
	return n == 1, nil
}

// IsTokenRevoked reports whether a token has been revoked and not yet pruned.
func IsTokenRevoked(ctx context.Context, database *sql.DB, token string) (bool, error) {
	var one int
	err := database.QueryRowContext(ctx,
		`SELECT 1 FROM revoked_tokens WHERE token_hash = ? LIMIT 1`, revokedTokenHash(token)).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("check revoked token: %w", err)
	}
	return true, nil
}

// PruneExpiredRevoked deletes rows whose token has already expired on its own,
// keeping the table bounded to the set of still-replayable revoked tokens.
func PruneExpiredRevoked(ctx context.Context, database *sql.DB) error {
	if _, err := database.ExecContext(ctx,
		`DELETE FROM revoked_tokens WHERE expires_at < ?`, time.Now().Unix()); err != nil {
		return fmt.Errorf("prune revoked tokens: %w", err)
	}
	return nil
}
