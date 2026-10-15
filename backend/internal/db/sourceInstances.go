package db

import (
	"context"
	"database/sql"
	"fmt"
)

// SourceInstanceRow is the raw source_instances row.
type SourceInstanceRow struct {
	ID           int64
	UserID       int64
	Name         string
	URL          string
	Username     sql.NullString
	Password     sql.NullString
	APIKey       sql.NullString
	AuthType     string
	DisplayOrder int
	IPAddress    sql.NullString
	CreatedAt    string
	UpdatedAt    string
}

// GetAllSourceInstances returns all source instances for a user.
func GetAllSourceInstances(ctx context.Context, database *sql.DB, userID int64) ([]SourceInstanceRow, error) {
	rows, err := database.QueryContext(ctx,
		`SELECT id, user_id, name, url, username, password, api_key, auth_type, display_order, ip_address, created_at, updated_at
		 FROM source_instances WHERE user_id = ? ORDER BY display_order ASC, created_at ASC`, userID)
	if err != nil {
		return nil, fmt.Errorf("get source instances: %w", err)
	}
	defer rows.Close()

	var results []SourceInstanceRow
	for rows.Next() {
		var r SourceInstanceRow
		if err := rows.Scan(&r.ID, &r.UserID, &r.Name, &r.URL, &r.Username, &r.Password,
			&r.APIKey, &r.AuthType, &r.DisplayOrder, &r.IPAddress, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan source instance: %w", err)
		}
		results = append(results, r)
	}
	return results, rows.Err()
}

// GetSourceInstanceByID returns a single source instance by ID, scoped to user.
func GetSourceInstanceByID(ctx context.Context, database *sql.DB, id, userID int64) (*SourceInstanceRow, error) {
	row := database.QueryRowContext(ctx,
		`SELECT id, user_id, name, url, username, password, api_key, auth_type, display_order, ip_address, created_at, updated_at
		 FROM source_instances WHERE id = ? AND user_id = ?`, id, userID)

	var r SourceInstanceRow
	err := row.Scan(&r.ID, &r.UserID, &r.Name, &r.URL, &r.Username, &r.Password,
		&r.APIKey, &r.AuthType, &r.DisplayOrder, &r.IPAddress, &r.CreatedAt, &r.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get source instance: %w", err)
	}
	return &r, nil
}

// CreateSourceInstance inserts a new source instance.
func CreateSourceInstance(ctx context.Context, database *sql.DB, userID int64, name, url, authType string,
	username, password, apiKey, ipAddress *string) (int64, error) {

	result, err := database.ExecContext(ctx,
		`INSERT INTO source_instances (user_id, name, url, auth_type, username, password, api_key, ip_address)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		userID, name, url, authType, username, password, apiKey, ipAddress)
	if err != nil {
		return 0, fmt.Errorf("create source instance: %w", err)
	}
	return result.LastInsertId()
}

// UpdateSourceInstance updates fields on a source instance.
func UpdateSourceInstance(ctx context.Context, database *sql.DB, id, userID int64,
	name, url, authType *string, username, password, apiKey, ipAddress *string) error {

	// Build dynamic SET clause
	setClauses := []string{}
	args := []any{}

	if name != nil {
		setClauses = append(setClauses, "name = ?")
		args = append(args, *name)
	}
	if url != nil {
		setClauses = append(setClauses, "url = ?")
		args = append(args, *url)
	}
	if authType != nil {
		setClauses = append(setClauses, "auth_type = ?")
		args = append(args, *authType)
	}
	if username != nil {
		setClauses = append(setClauses, "username = ?")
		args = append(args, *username)
	}
	if password != nil {
		setClauses = append(setClauses, "password = ?")
		args = append(args, *password)
	}
	if apiKey != nil {
		setClauses = append(setClauses, "api_key = ?")
		args = append(args, *apiKey)
	}
	if ipAddress != nil {
		setClauses = append(setClauses, "ip_address = ?")
		args = append(args, *ipAddress)
	}

	if len(setClauses) == 0 {
		return nil
	}

	setClauses = append(setClauses, "updated_at = datetime('now')")
	args = append(args, id, userID)

	query := fmt.Sprintf("UPDATE source_instances SET %s WHERE id = ? AND user_id = ?",
		joinStrings(setClauses, ", "))

	_, err := database.ExecContext(ctx, query, args...)
	return err
}

// DeleteSourceInstance removes a source instance.
func DeleteSourceInstance(ctx context.Context, database *sql.DB, id, userID int64) error {
	_, err := database.ExecContext(ctx,
		"DELETE FROM source_instances WHERE id = ? AND user_id = ?", id, userID)
	return err
}

// ReorderSourceInstances updates display_order for multiple instances.
func ReorderSourceInstances(ctx context.Context, database *sql.DB, userID int64, orders map[int64]int) error {
	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	for id, order := range orders {
		_, err := tx.ExecContext(ctx,
			"UPDATE source_instances SET display_order = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
			order, id, userID)
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

func joinStrings(parts []string, sep string) string {
	result := ""
	for i, p := range parts {
		if i > 0 {
			result += sep
		}
		result += p
	}
	return result
}
