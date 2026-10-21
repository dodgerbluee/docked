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
