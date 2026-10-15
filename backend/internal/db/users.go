package db

import (
	"context"
	"database/sql"
	"fmt"
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
