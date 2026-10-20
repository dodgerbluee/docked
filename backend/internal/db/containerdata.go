package db

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// rawRecordTables are the container-related tables the developer-mode data
// viewer dumps per user. The ORDER BY clauses mirror the legacy REST route.
var rawRecordTables = []struct {
	name    string
	orderBy string
}{
	{"source_instances", "id ASC"},
	{"containers", "last_seen DESC"},
	{"deployed_images", "last_seen DESC"},
	{"registry_image_versions", "last_checked DESC"},
	{"tracked_apps", "name ASC"},
}

// GetRawDatabaseRecords returns every row of the container-related tables for
// the user, keyed by table name. A table that cannot be read yields an empty
// list plus a "<table>_error" message, matching the legacy contract.
func GetRawDatabaseRecords(ctx context.Context, database *sql.DB, userID int64) (map[string]any, error) {
	records := make(map[string]any, len(rawRecordTables))
	for _, table := range rawRecordTables {
		query := fmt.Sprintf("SELECT * FROM %s WHERE user_id = ? ORDER BY %s", table.name, table.orderBy)
		rows, err := database.QueryContext(ctx, query, userID)
		if err != nil {
			records[table.name] = []map[string]any{}
			records[table.name+"_error"] = err.Error()
			continue
		}
		list, scanErr := scanRawRows(rows)
		rows.Close()
		if scanErr != nil {
			records[table.name] = []map[string]any{}
			records[table.name+"_error"] = scanErr.Error()
			continue
		}
		records[table.name] = list
	}
	return records, nil
}

// scanRawRows turns a result set into a list of column→value maps. BLOB values
// are decoded as strings and timestamps as RFC3339 so the payload stays
// JSON-friendly.
func scanRawRows(rows *sql.Rows) ([]map[string]any, error) {
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}

	list := []map[string]any{}
	for rows.Next() {
		values := make([]any, len(columns))
		holders := make([]any, len(columns))
		for i := range values {
			holders[i] = &values[i]
		}
		if err := rows.Scan(holders...); err != nil {
			return nil, err
		}

		row := make(map[string]any, len(columns))
		for i, column := range columns {
			switch v := values[i].(type) {
			case []byte:
				row[column] = string(v)
			case time.Time:
				row[column] = v.Format(time.RFC3339)
			default:
				row[column] = v
			}
		}
		list = append(list, row)
	}
	return list, rows.Err()
}

// ClearUserContainerData deletes all container, deployed_images and
// registry_image_versions rows for the user in a single transaction.
// tracked_apps are managed separately and are deliberately left alone.
func ClearUserContainerData(ctx context.Context, database *sql.DB, userID int64) error {
	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin clear container data: %w", err)
	}
	for _, table := range []string{"containers", "deployed_images", "registry_image_versions"} {
		if _, err := tx.ExecContext(ctx, "DELETE FROM "+table+" WHERE user_id = ?", userID); err != nil {
			tx.Rollback()
			return fmt.Errorf("delete from %s: %w", table, err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit clear container data: %w", err)
	}
	return nil
}
