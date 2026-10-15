package db

import (
	"context"
	"database/sql"
)

type RegistryCredentialRow struct {
	ID       int64
	Username sql.NullString
	Token    sql.NullString
}

func GetRegistryCredentials(ctx context.Context, database *sql.DB, userID int64) (*RegistryCredentialRow, error) {
	var r RegistryCredentialRow
	err := database.QueryRowContext(ctx,
		"SELECT id, username, token FROM docker_hub_credentials WHERE user_id = ?", userID).
		Scan(&r.ID, &r.Username, &r.Token)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &r, err
}

func UpsertRegistryCredentials(ctx context.Context, database *sql.DB, userID int64, username, token *string) error {
	if username == nil && token == nil {
		return nil
	}
	_, err := database.ExecContext(ctx,
		`INSERT INTO docker_hub_credentials (user_id, username, token)
		 VALUES (?, COALESCE(?, NULL), COALESCE(?, NULL))
		 ON CONFLICT(user_id) DO UPDATE SET
		   username = COALESCE(?, username),
		   token = COALESCE(?, token),
		   updated_at = CURRENT_TIMESTAMP`,
		userID, username, token, username, token)
	return err
}

func DeleteRegistryCredentials(ctx context.Context, database *sql.DB, userID int64) error {
	_, err := database.ExecContext(ctx, "DELETE FROM docker_hub_credentials WHERE user_id = ?", userID)
	return err
}
