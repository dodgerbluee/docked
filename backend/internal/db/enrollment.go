package db

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"time"
)

func CreateEnrollmentToken(ctx context.Context, database *sql.DB, userID int64) (string, time.Time, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", time.Time{}, err
	}
	token := hex.EncodeToString(b)
	expires := time.Now().Add(15 * time.Minute)

	_, err := database.ExecContext(ctx,
		"INSERT INTO runner_enrollment_tokens (user_id, token, expires_at) VALUES (?, ?, ?)",
		userID, token, expires.Format("2006-01-02 15:04:05"))
	if err != nil {
		return "", time.Time{}, err
	}
	return token, expires, nil
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
