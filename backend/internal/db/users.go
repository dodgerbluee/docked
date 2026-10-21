package db

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// UserRow is the raw user data from the database. The oauth_provider columns
// come from migration 0003; REST login needs oauth_provider to reject
// password sign-in for SSO-only accounts (no password_hash).
type UserRow struct {
	ID              int64
	Username        string
	PasswordHash    sql.NullString
	Role            string
	PasswordChanged int
	InstanceAdmin   int
	Email           sql.NullString
	LastLogin       sql.NullString
	CreatedAt       string
	UpdatedAt       string
	OAuthProvider   sql.NullString
	OAuthProviderID sql.NullString
}

const userCols = `id, username, password_hash, role, password_changed, instance_admin, email, last_login, created_at, updated_at, oauth_provider, oauth_provider_id`

// GetUserByID fetches a single user by primary key.
func GetUserByID(ctx context.Context, database *sql.DB, id int64) (*UserRow, error) {
	row := database.QueryRowContext(ctx,
		"SELECT "+userCols+" FROM users WHERE id = ?", id)

	var u UserRow
	err := row.Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role,
		&u.PasswordChanged, &u.InstanceAdmin, &u.Email, &u.LastLogin, &u.CreatedAt, &u.UpdatedAt,
		&u.OAuthProvider, &u.OAuthProviderID)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get user by id: %w", err)
	}
	return &u, nil
}

// GetUserByUsername fetches a single user by username.
func GetUserByUsername(ctx context.Context, database *sql.DB, username string) (*UserRow, error) {
	row := database.QueryRowContext(ctx,
		"SELECT "+userCols+" FROM users WHERE username = ?", username)

	var u UserRow
	err := row.Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role,
		&u.PasswordChanged, &u.InstanceAdmin, &u.Email, &u.LastLogin, &u.CreatedAt, &u.UpdatedAt,
		&u.OAuthProvider, &u.OAuthProviderID)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get user by username: %w", err)
	}
	return &u, nil
}

// GetAllUsers returns all users (admin listing).
func GetAllUsers(ctx context.Context, database *sql.DB) ([]UserRow, error) {
	rows, err := database.QueryContext(ctx,
		"SELECT "+userCols+" FROM users ORDER BY id")
	if err != nil {
		return nil, fmt.Errorf("get all users: %w", err)
	}
	defer rows.Close()

	var users []UserRow
	for rows.Next() {
		var u UserRow
		if err := rows.Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role,
			&u.PasswordChanged, &u.InstanceAdmin, &u.Email, &u.LastLogin, &u.CreatedAt, &u.UpdatedAt,
			&u.OAuthProvider, &u.OAuthProviderID); err != nil {
			return nil, fmt.Errorf("scan user: %w", err)
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

// UserExists checks if a username is taken.
func UserExists(ctx context.Context, database *sql.DB, username string) (bool, error) {
	var count int
	err := database.QueryRowContext(ctx, "SELECT 1 FROM users WHERE username = ?", username).Scan(&count)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("user exists: %w", err)
	}
	return true, nil
}

// CreateUser inserts a new user and returns the new ID.
func CreateUser(ctx context.Context, database *sql.DB, username, passwordHash, role string, instanceAdmin int) (int64, error) {
	result, err := database.ExecContext(ctx,
		"INSERT INTO users (username, password_hash, role, instance_admin) VALUES (?, ?, ?, ?)",
		username, passwordHash, role, instanceAdmin)
	if err != nil {
		return 0, fmt.Errorf("create user: %w", err)
	}
	return result.LastInsertId()
}

// RegisterUser atomically decides the bootstrap role and inserts the user in a
// single statement. SQLite evaluates the COUNT(*) guard under the same write
// lock as the INSERT, so two concurrent first-registrations cannot both be
// minted Administrator: the second sees count=1 and becomes a Member. This
// holds across processes because Node and Go share one DB file and SQLite
// permits a single writer at a time. Returns the new id and the role actually
// persisted so the caller can mint a matching token.
//
// modernc/sqlite can return SQLITE_BUSY immediately when a write tries to take
// the lock another writer already holds, without waiting out the busy timeout.
// A failed attempt inserts nothing, so we retry a bounded number of times with
// a short backoff; the COUNT(*) guard is re-evaluated on each attempt.
//
// Deliberate deviation from the retired Node registerUser, which hardcoded
// role='Administrator' for EVERY public registration: here only the first
// user bootstraps to Administrator + instance_admin, later registrants get
// Member. Public registration must not mint admins; role changes go through
// the admin-gated user-management mutations.
func RegisterUser(ctx context.Context, database *sql.DB, username, passwordHash, email string) (id int64, role string, instanceAdmin int, err error) {
	const stmt = `INSERT INTO users (username, password_hash, email, role, instance_admin)
	             SELECT ?, ?, ?,
		            CASE WHEN (SELECT COUNT(*) FROM users) = 0 THEN 'Administrator' ELSE 'Member' END,
		            CASE WHEN (SELECT COUNT(*) FROM users) = 0 THEN 1 ELSE 0 END
	             RETURNING id, role, instance_admin`

	var emailArg any
	if email != "" {
		emailArg = email
	}
	for attempt := 0; ; attempt++ {
		err = database.QueryRowContext(ctx, stmt, username, passwordHash, emailArg).Scan(&id, &role, &instanceAdmin)
		if err == nil {
			return id, role, instanceAdmin, nil
		}
		if !isBusy(err) || attempt >= 20 {
			return 0, "", 0, fmt.Errorf("register user: %w", err)
		}
		select {
		case <-ctx.Done():
			return 0, "", 0, fmt.Errorf("register user: %w", ctx.Err())
		case <-time.After(time.Duration(5*(1<<min(attempt, 5))) * time.Millisecond):
		}
	}
}

// RegisterUserWithCode atomically consumes a shared bootstrap code and inserts
// the user. If either operation fails, neither is committed.
func RegisterUserWithCode(ctx context.Context, database *sql.DB, username, passwordHash, email, storedCode string) (id int64, role string, instanceAdmin int, err error) {
	const insert = `INSERT INTO users (username, password_hash, email, role, instance_admin)
		SELECT ?, ?, ?,
			CASE WHEN (SELECT COUNT(*) FROM users) = 0 THEN 'Administrator' ELSE 'Member' END,
			CASE WHEN (SELECT COUNT(*) FROM users) = 0 THEN 1 ELSE 0 END
		RETURNING id, role, instance_admin`

	var emailArg any
	if email != "" {
		emailArg = email
	}
	for attempt := 0; ; attempt++ {
		tx, beginErr := database.BeginTx(ctx, nil)
		if beginErr != nil {
			err = beginErr
		} else {
			var current string
			err = tx.QueryRowContext(ctx,
				"SELECT value FROM settings WHERE key = 'registration_code' AND value = ? LIMIT 1", storedCode).Scan(&current)
			if err == nil {
				err = tx.QueryRowContext(ctx, insert, username, passwordHash, emailArg).Scan(&id, &role, &instanceAdmin)
			}
			if err == nil {
				var result sql.Result
				result, err = tx.ExecContext(ctx,
					"DELETE FROM settings WHERE key = 'registration_code' AND value = ?", storedCode)
				if err == nil {
					var changed int64
					changed, err = result.RowsAffected()
					if err == nil && changed != 1 {
						err = fmt.Errorf("registration code was already consumed")
					}
				}
			}
			if err == nil {
				err = tx.Commit()
			} else {
				_ = tx.Rollback()
			}
		}
		if err == nil {
			return id, role, instanceAdmin, nil
		}
		if !isBusy(err) || attempt >= 20 {
			return 0, "", 0, fmt.Errorf("register user with code: %w", err)
		}
		select {
		case <-ctx.Done():
			return 0, "", 0, fmt.Errorf("register user with code: %w", ctx.Err())
		case <-time.After(time.Duration(5*(1<<min(attempt, 5))) * time.Millisecond):
		}
	}
}

// isBusy reports whether err is a SQLite write-lock contention error.
func isBusy(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	return strings.Contains(msg, "SQLITE_BUSY") || strings.Contains(msg, "database is locked")
}

// UpdateUserPassword updates a user's password hash.
func UpdateUserPassword(ctx context.Context, database *sql.DB, userID int64, passwordHash string) error {
	_, err := database.ExecContext(ctx,
		"UPDATE users SET password_hash = ?, password_changed = 1, updated_at = datetime('now') WHERE id = ?",
		passwordHash, userID)
	return err
}

// UpdateUsername updates a user's username.
func UpdateUsername(ctx context.Context, database *sql.DB, userID int64, newUsername string) error {
	_, err := database.ExecContext(ctx,
		"UPDATE users SET username = ?, updated_at = datetime('now') WHERE id = ?",
		newUsername, userID)
	return err
}

// SetUserRole updates a user's role.
// SetUserRole updates a user's role and instance-admin flag (parity with Node's
// updateUserRole, which always writes both columns).
func SetUserRole(ctx context.Context, database *sql.DB, userID int64, role string, instanceAdmin bool) error {
	ia := 0
	if instanceAdmin {
		ia = 1
	}
	_, err := database.ExecContext(ctx,
		"UPDATE users SET role = ?, instance_admin = ?, updated_at = datetime('now') WHERE id = ?",
		role, ia, userID)
	return err
}

// GetUserCount returns the total number of users.
func GetUserCount(ctx context.Context, database *sql.DB) (int, error) {
	var count int
	err := database.QueryRowContext(ctx, "SELECT COUNT(*) FROM users").Scan(&count)
	return count, err
}

// InstanceAdminExists reports whether any user holds the instance-admin flag
// (Node's instanceAdminExists). A missing users table reads as false.
func InstanceAdminExists(ctx context.Context, database *sql.DB) (bool, error) {
	var one int
	err := database.QueryRowContext(ctx,
		"SELECT 1 FROM users WHERE instance_admin = 1 LIMIT 1").Scan(&one)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		if isNoSuchTable(err) {
			return false, nil
		}
		return false, fmt.Errorf("instance admin exists: %w", err)
	}
	return true, nil
}

// UpdateLastLogin stamps the login timestamp (Node's updateLastLogin).
// Missing users are silently ignored, matching Node's fire-and-forget call.
func UpdateLastLogin(ctx context.Context, database *sql.DB, username string) error {
	_, err := database.ExecContext(ctx,
		"UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE username = ?", username)
	if err != nil {
		return fmt.Errorf("update last login: %w", err)
	}
	return nil
}

// CreateUserFull inserts a user with the full column set Node's createUser
// writes: email plus password_changed = 1.
func CreateUserFull(ctx context.Context, database *sql.DB, username, passwordHash string,
	email *string, role string, instanceAdmin int) (int64, error) {
	result, err := database.ExecContext(ctx,
		`INSERT INTO users (username, password_hash, email, role, password_changed, instance_admin)
		 VALUES (?, ?, ?, ?, 1, ?)`,
		username, passwordHash, email, role, instanceAdmin)
	if err != nil {
		return 0, fmt.Errorf("create user full: %w", err)
	}
	return result.LastInsertId()
}

// UpdateVerificationToken stores a one-time instance-admin verification
// token for an existing user (mirrors Node's updateVerificationToken).
func UpdateVerificationToken(ctx context.Context, database *sql.DB, username, token string) error {
	_, err := database.ExecContext(ctx,
		"UPDATE users SET verification_token = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?",
		token, username)
	if err != nil {
		return fmt.Errorf("update verification token: %w", err)
	}
	return nil
}

// VerifyAndClearToken consumes a stored verification token in a single
// atomic statement; true means the token matched and was cleared.
func VerifyAndClearToken(ctx context.Context, database *sql.DB, username, token string) (bool, error) {
	result, err := database.ExecContext(ctx,
		"UPDATE users SET verification_token = NULL, updated_at = CURRENT_TIMESTAMP WHERE username = ? AND verification_token = ?",
		username, token)
	if err != nil {
		return false, fmt.Errorf("verify and clear token: %w", err)
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("verify and clear token rows: %w", err)
	}
	return changed == 1, nil
}

// UserStats carries per-user counts shown in the admin user detail modal.
type UserStats struct {
	TrackedApps int
	Containers  int
}

func CountUserStats(ctx context.Context, database *sql.DB, userID int64) (*UserStats, error) {
	var s UserStats
	if err := database.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM tracked_apps WHERE user_id = ?", userID).Scan(&s.TrackedApps); err != nil {
		return nil, fmt.Errorf("count tracked apps: %w", err)
	}
	if err := database.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM containers WHERE user_id = ?", userID).Scan(&s.Containers); err != nil {
		return nil, fmt.Errorf("count containers: %w", err)
	}
	return &s, nil
}

// DeleteUser removes a user and every user-scoped row in a single
// transaction so a mid-cascade failure can't leave orphaned rows behind.
// The table list covers every user_id column in the migrated schema;
// revoked_tokens and idempotency_claims are deliberately left behind:
// revoked entries must outlive the user to block token replay until their
// natural expiry, and claims are harmless tombstones. Returns rows deleted
// from users (0 or 1).
func DeleteUser(ctx context.Context, database *sql.DB, userID int64) (int, error) {
	tables := []string{
		"source_instances", "tracked_apps", "discord_webhooks", "containers",
		"deployed_images", "settings", "batch_config",
		"batch_runs", "discord_notifications_sent", "docker_hub_credentials",
		"intents", "intent_executions", "registry_image_versions",
		"repository_access_tokens", "runner_enrollment_tokens", "runners",
		"tracked_app_upgrade_history", "upgrade_history",
	}
	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin delete user: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck // no-op after commit
	for _, t := range tables {
		if _, err := tx.ExecContext(ctx, "DELETE FROM "+t+" WHERE user_id = ?", userID); err != nil {
			return 0, fmt.Errorf("delete %s for user: %w", t, err)
		}
	}
	// Pending auth tokens (password-change / instance-admin) are keyed by
	// username, not user_id; clear them while the user row still exists.
	if _, err := tx.ExecContext(ctx,
		"DELETE FROM pending_auth_tokens WHERE username = (SELECT username FROM users WHERE id = ?)", userID); err != nil {
		return 0, fmt.Errorf("delete pending auth tokens for user: %w", err)
	}
	res, err := tx.ExecContext(ctx, "DELETE FROM users WHERE id = ?", userID)
	if err != nil {
		return 0, fmt.Errorf("delete user: %w", err)
	}
	changes, err := res.RowsAffected()
	if err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit delete user: %w", err)
	}
	return int(changes), nil
}
