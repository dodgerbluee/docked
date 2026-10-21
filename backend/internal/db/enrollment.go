package db

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"time"
)

// CreateEnrollmentToken mints a single-use enrollment token. Timestamps are
// written in the same ISO-8601 UTC format Node uses so mixed-format rows and
// string comparisons in CleanupExpiredEnrollmentTokens behave identically.
func CreateEnrollmentToken(ctx context.Context, database *sql.DB, userID int64) (string, string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", "", err
	}
	token := hex.EncodeToString(b)
	expires := time.Now().Add(10 * time.Minute).UTC()
	expiresAt := expires.Format("2006-01-02T15:04:05.000Z07:00")

	_, err := database.ExecContext(ctx,
		"INSERT INTO runner_enrollment_tokens (user_id, token, expires_at) VALUES (?, ?, ?)",
		userID, token, expiresAt)
	if err != nil {
		return "", "", err
	}
	return token, expiresAt, nil
}

// ConsumeEnrollmentToken atomically claims a token (single UPDATE, no
// TOCTOU race) and returns its owning user. The expiry check runs in Go
// because rows written by Node and by Go store expires_at in different
// textual formats; parseDBTime accepts both. A claimed-but-expired token
// stays marked used — it is dead either way.
func ConsumeEnrollmentToken(ctx context.Context, database *sql.DB, token string) (int64, bool) {
	result, err := database.ExecContext(ctx,
		"UPDATE runner_enrollment_tokens SET used = 1 WHERE token = ? AND used = 0", token)
	if err != nil {
		return 0, false
	}
	changed, err := result.RowsAffected()
	if err != nil || changed != 1 {
		return 0, false
	}

	var userID int64
	var expiresAt string
	if err := database.QueryRowContext(ctx,
		"SELECT user_id, expires_at FROM runner_enrollment_tokens WHERE token = ?", token).
		Scan(&userID, &expiresAt); err != nil {
		return 0, false
	}
	exp := parseDBTime(expiresAt)
	if exp.IsZero() || time.Now().After(exp) {
		return 0, false
	}
	return userID, true
}

// CleanupExpiredEnrollmentTokens deletes expired tokens and used tokens older
// than one hour. Same SQL as Node's cleanupExpiredTokens (both write
// ISO-8601, so the string comparisons line up).
func CleanupExpiredEnrollmentTokens(ctx context.Context, database *sql.DB) (int64, error) {
	cutoff := time.Now().Add(-time.Hour).UTC().Format("2006-01-02T15:04:05.000Z07:00")
	result, err := database.ExecContext(ctx,
		"DELETE FROM runner_enrollment_tokens WHERE expires_at < ? OR (used = 1 AND created_at < ?)",
		cutoff, cutoff)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

func ValidateEnrollmentToken(ctx context.Context, database *sql.DB, token string) (int64, error) {
	var userID int64
	var expiresAt string
	var used int
	err := database.QueryRowContext(ctx,
		"SELECT user_id, expires_at, used FROM runner_enrollment_tokens WHERE token = ?", token).
		Scan(&userID, &expiresAt, &used)
	if err == sql.ErrNoRows {
		return 0, sql.ErrNoRows
	}
	if err != nil {
		return 0, err
	}
	if used == 1 {
		return 0, sql.ErrNoRows
	}
	exp := parseDBTime(expiresAt)
	if time.Now().After(exp) {
		return 0, sql.ErrNoRows
	}
	database.ExecContext(ctx, "UPDATE runner_enrollment_tokens SET used = 1 WHERE token = ?", token)
	return userID, nil
}

func parseDBTime(s string) time.Time {
	t, _ := time.Parse("2006-01-02 15:04:05", s)
	if t.IsZero() {
		t, _ = time.Parse(time.RFC3339, s)
	}
	return t
}
