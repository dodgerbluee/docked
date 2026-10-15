package db

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

// UserRow is the raw user data from the database.
type UserRow struct {
	ID              int64
	Username        string
	PasswordHash    sql.NullString
	Role            string
	PasswordChanged int
	InstanceAdmin   int
	CreatedAt       string
	UpdatedAt       string
}

const userCols = `id, username, password_hash, role, password_changed, instance_admin, created_at, updated_at`

// GetUserByID fetches a single user by primary key.
func GetUserByID(ctx context.Context, database *sql.DB, id int64) (*UserRow, error) {
	row := database.QueryRowContext(ctx,
		"SELECT "+userCols+" FROM users WHERE id = ?", id)

	var u UserRow
	err := row.Scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role,
		&u.PasswordChanged, &u.InstanceAdmin, &u.CreatedAt, &u.UpdatedAt)
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
		&u.PasswordChanged, &u.InstanceAdmin, &u.CreatedAt, &u.UpdatedAt)
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
			&u.PasswordChanged, &u.InstanceAdmin, &u.CreatedAt, &u.UpdatedAt); err != nil {
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
func RegisterUser(ctx context.Context, database *sql.DB, username, passwordHash string) (id int64, role string, instanceAdmin int, err error) {
	const stmt = `INSERT INTO users (username, password_hash, role, instance_admin)
	             SELECT ?, ?,
		            CASE WHEN (SELECT COUNT(*) FROM users) = 0 THEN 'Administrator' ELSE 'Member' END,
		            CASE WHEN (SELECT COUNT(*) FROM users) = 0 THEN 1 ELSE 0 END
	             RETURNING id, role, instance_admin`

	for attempt := 0; ; attempt++ {
		err = database.QueryRowContext(ctx, stmt, username, passwordHash).Scan(&id, &role, &instanceAdmin)
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
func RegisterUserWithCode(ctx context.Context, database *sql.DB, username, passwordHash, storedCode string) (id int64, role string, instanceAdmin int, err error) {
	const insert = `INSERT INTO users (username, password_hash, role, instance_admin)
		SELECT ?, ?,
			CASE WHEN (SELECT COUNT(*) FROM users) = 0 THEN 'Administrator' ELSE 'Member' END,
			CASE WHEN (SELECT COUNT(*) FROM users) = 0 THEN 1 ELSE 0 END
		RETURNING id, role, instance_admin`

	for attempt := 0; ; attempt++ {
		tx, beginErr := database.BeginTx(ctx, nil)
		if beginErr != nil {
			err = beginErr
		} else {
			var current string
			err = tx.QueryRowContext(ctx,
				"SELECT value FROM settings WHERE key = 'registration_code' AND value = ? LIMIT 1", storedCode).Scan(&current)
			if err == nil {
				err = tx.QueryRowContext(ctx, insert, username, passwordHash).Scan(&id, &role, &instanceAdmin)
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
func SetUserRole(ctx context.Context, database *sql.DB, userID int64, role string) error {
	_, err := database.ExecContext(ctx,
		"UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?",
		role, userID)
	return err
}

// GetUserCount returns the total number of users.
func GetUserCount(ctx context.Context, database *sql.DB) (int, error) {
	var count int
	err := database.QueryRowContext(ctx, "SELECT COUNT(*) FROM users").Scan(&count)
	return count, err
}
