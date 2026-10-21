package db

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// SourceInstanceRow is a minimal row from the (legacy Portainer-era)
// source_instances table. The feature is retired, but the matching engine
// still consults it so stale rows keep Node's skip semantics: a container
// pointing at an unknown source instance is dropped from matching.
type SourceInstanceRow struct {
	ID  int64
	URL string
}

// GetAllSourceInstances returns every source instance for a user (Node's
// getAllSourceInstances). A missing table is treated as empty.
func GetAllSourceInstances(ctx context.Context, database *sql.DB, userID int64) ([]SourceInstanceRow, error) {
	rows, err := database.QueryContext(ctx,
		"SELECT id, url FROM source_instances WHERE user_id = ?", userID)
	if err != nil {
		if isNoSuchTable(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("get source instances: %w", err)
	}
	defer rows.Close()

	var results []SourceInstanceRow
	for rows.Next() {
		var r SourceInstanceRow
		if err := rows.Scan(&r.ID, &r.URL); err != nil {
			return nil, fmt.Errorf("scan source instance: %w", err)
		}
		results = append(results, r)
	}
	return results, rows.Err()
}

func isNoSuchTable(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(err.Error(), "no such table")
}

// SourceInstanceFull carries every column of the legacy source_instances
// table; the config export endpoints serialize a subset of these.
type SourceInstanceFull struct {
	ID           int64
	Name         string
	URL          string
	AuthType     string
	DisplayOrder int
	IPAddress    sql.NullString
	CreatedAt    sql.NullString
	UpdatedAt    sql.NullString
}

// GetAllSourceInstancesFull returns full rows for the config export (Node's
// getAllSourceInstances ordering). A missing table is treated as empty.
func GetAllSourceInstancesFull(ctx context.Context, database *sql.DB, userID int64) ([]SourceInstanceFull, error) {
	rows, err := database.QueryContext(ctx,
		`SELECT id, name, url, auth_type, display_order, ip_address, created_at, updated_at
		 FROM source_instances WHERE user_id = ? ORDER BY display_order ASC, created_at ASC`, userID)
	if err != nil {
		if isNoSuchTable(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("get source instances full: %w", err)
	}
	defer rows.Close()

	var results []SourceInstanceFull
	for rows.Next() {
		var r SourceInstanceFull
		if err := rows.Scan(&r.ID, &r.Name, &r.URL, &r.AuthType, &r.DisplayOrder,
			&r.IPAddress, &r.CreatedAt, &r.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan source instance full: %w", err)
		}
		results = append(results, r)
	}
	return results, rows.Err()
}

// CreateSourceInstance inserts a source instance the way Node's
// createSourceInstance does: display_order is max+1 per user and the
// auth_type decides which credential columns get populated.
func CreateSourceInstance(ctx context.Context, database *sql.DB, userID int64, name, url string,
	username, password, apiKey *string, authType string, ipAddress *string) (int64, error) {
	var maxOrder sql.NullInt64
	if err := database.QueryRowContext(ctx,
		"SELECT MAX(display_order) FROM source_instances WHERE user_id = ?", userID).Scan(&maxOrder); err != nil {
		return 0, fmt.Errorf("source instance display order: %w", err)
	}
	nextOrder := int64(0)
	if maxOrder.Valid {
		nextOrder = maxOrder.Int64 + 1
	}

	finalUsername, finalPassword := "", ""
	var finalAPIKey *string
	if authType == "apikey" {
		// Node: apiKey || null — empty string becomes NULL.
		if apiKey != nil && *apiKey != "" {
			finalAPIKey = apiKey
		}
	} else {
		if username != nil {
			finalUsername = *username
		}
		if password != nil {
			finalPassword = *password
		}
	}

	result, err := database.ExecContext(ctx,
		`INSERT INTO source_instances (user_id, name, url, username, password, api_key, auth_type, display_order, ip_address)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		userID, name, url, finalUsername, finalPassword, finalAPIKey, authType, nextOrder, ipAddress)
	if err != nil {
		return 0, fmt.Errorf("create source instance: %w", err)
	}
	return result.LastInsertId()
}
