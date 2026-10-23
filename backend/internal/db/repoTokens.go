package db

import (
	"context"
	"database/sql"
)

type RepositoryTokenRow struct {
	ID          int64
	Provider    string
	Name        string
	AccessToken string
	CreatedAt   string
	UpdatedAt   string
}

func GetRepositoryTokens(ctx context.Context, database *sql.DB, userID int64) ([]RepositoryTokenRow, error) {
	rows, err := database.QueryContext(ctx,
		"SELECT id, provider, name, access_token, created_at, updated_at FROM repository_access_tokens WHERE user_id = ? ORDER BY provider, name", userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []RepositoryTokenRow
	for rows.Next() {
		var r RepositoryTokenRow
		if err := rows.Scan(&r.ID, &r.Provider, &r.Name, &r.AccessToken, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, err
		}
		result = append(result, r)
	}
	return result, rows.Err()
}

func GetRepositoryTokenByProvider(ctx context.Context, database *sql.DB, userID int64, provider string) (*RepositoryTokenRow, error) {
	var r RepositoryTokenRow
	err := database.QueryRowContext(ctx,
		"SELECT id, provider, name, access_token, created_at, updated_at FROM repository_access_tokens WHERE user_id = ? AND provider = ? LIMIT 1",
		userID, provider).Scan(&r.ID, &r.Provider, &r.Name, &r.AccessToken, &r.CreatedAt, &r.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func GetRepositoryTokenByID(ctx context.Context, database *sql.DB, userID, tokenID int64) (*RepositoryTokenRow, error) {
	var r RepositoryTokenRow
	err := database.QueryRowContext(ctx,
		"SELECT id, provider, name, access_token, created_at, updated_at FROM repository_access_tokens WHERE id = ? AND user_id = ?",
		tokenID, userID).Scan(&r.ID, &r.Provider, &r.Name, &r.AccessToken, &r.CreatedAt, &r.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func UpsertRepositoryToken(ctx context.Context, database *sql.DB, userID int64, provider, name, accessToken string) (int64, error) {
	_, err := database.ExecContext(ctx,
		`INSERT INTO repository_access_tokens (user_id, provider, name, access_token)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(user_id, provider, name) DO UPDATE SET access_token = excluded.access_token, updated_at = CURRENT_TIMESTAMP`,
		userID, provider, name, accessToken)
	if err != nil {
		return 0, err
	}
	// SQLite does not advance last_insert_rowid() for the DO UPDATE branch, so
	// res.LastInsertId() would report whatever an earlier INSERT left behind on
	// that pooled connection - possibly another user's row. Read the identity
	// back from the row we just wrote.
	var id int64
	if err := database.QueryRowContext(ctx,
		"SELECT id FROM repository_access_tokens WHERE user_id = ? AND provider = ? AND name = ?",
		userID, provider, name).Scan(&id); err != nil {
		return 0, err
	}
	return id, nil
}

// DeleteRepositoryToken reports how many rows it removed so the caller can
// tell a real delete from an id that matched nothing (stale UI, or another
// user's row).
func DeleteRepositoryToken(ctx context.Context, database *sql.DB, id, userID int64) (int64, error) {
	res, err := database.ExecContext(ctx, "DELETE FROM repository_access_tokens WHERE id = ? AND user_id = ?", id, userID)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
