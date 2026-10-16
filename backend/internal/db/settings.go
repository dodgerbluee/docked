package db

import (
	"context"
	"database/sql"
	"fmt"
)

// SettingsRow holds user preferences from the settings key-value table.
type SettingsRow struct {
	UserID                 int64
	ColorScheme            string
	DisablePortainerPage   int
	DisableTrackedAppsPage int
	RefreshingToggles      int
}

// GetUserSettings reads user preferences from the key-value settings table.
func GetUserSettings(ctx context.Context, database *sql.DB, userID int64) (*SettingsRow, error) {
	rows, err := database.QueryContext(ctx,
		"SELECT key, value FROM settings WHERE user_id = ?", userID)
	if err != nil {
		return nil, fmt.Errorf("get user settings: %w", err)
	}
	defer rows.Close()

	s := &SettingsRow{UserID: userID, ColorScheme: "system"}
	for rows.Next() {
		var key, value string
		if err := rows.Scan(&key, &value); err != nil {
			return nil, fmt.Errorf("scan setting: %w", err)
		}
		switch key {
		case "color_scheme":
			s.ColorScheme = value
		case "disablePortainerPage":
			if value == "true" {
				s.DisablePortainerPage = 1
			}
		case "disableTrackedAppsPage":
			if value == "true" {
				s.DisableTrackedAppsPage = 1
			}
		case "refreshing_toggles_enabled":
			if value == "true" {
				s.RefreshingToggles = 1
			}
		}
	}
	return s, rows.Err()
}

// UpsertUserSettings writes user preferences to the key-value settings table.
func UpsertUserSettings(ctx context.Context, database *sql.DB, userID int64,
	colorScheme *string, disablePortainer, disableTrackedApps, refreshingToggles *bool) error {

	tx, err := database.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	upsert := func(key, value string) error {
		_, err := tx.ExecContext(ctx,
			`INSERT INTO settings (user_id, key, value, updated_at) VALUES (?, ?, ?, datetime('now'))
			 ON CONFLICT(user_id, key) DO UPDATE SET value = ?, updated_at = datetime('now')`,
			userID, key, value, value)
		return err
	}

	if colorScheme != nil {
		if err := upsert("color_scheme", *colorScheme); err != nil {
			return err
		}
	}
	if disablePortainer != nil {
		v := "false"
		if *disablePortainer {
			v = "true"
		}
		if err := upsert("disablePortainerPage", v); err != nil {
			return err
		}
	}
	if disableTrackedApps != nil {
		v := "false"
		if *disableTrackedApps {
			v = "true"
		}
		if err := upsert("disableTrackedAppsPage", v); err != nil {
			return err
		}
	}
	if refreshingToggles != nil {
		v := "false"
		if *refreshingToggles {
			v = "true"
		}
		if err := upsert("refreshing_toggles_enabled", v); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// GetSetting reads a per-user setting from the key-value settings table.
// Returns nil when the key is unset for that user.
func GetSetting(ctx context.Context, database *sql.DB, key string, userID int64) (*string, error) {
	var val string
	err := database.QueryRowContext(ctx,
		"SELECT value FROM settings WHERE key = ? AND user_id = ?", key, userID).Scan(&val)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get setting: %w", err)
	}
	return &val, nil
}

// SetSetting writes a per-user setting (INSERT OR REPLACE, matching Node).
func SetSetting(ctx context.Context, database *sql.DB, key string, userID int64, value string) error {
	_, err := database.ExecContext(ctx,
		"INSERT OR REPLACE INTO settings (user_id, key, value, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
		userID, key, value)
	if err != nil {
		return fmt.Errorf("set setting: %w", err)
	}
	return nil
}

// GetSystemSetting reads a system-wide setting (user_id = 0).
func GetSystemSetting(ctx context.Context, database *sql.DB, key string) (*string, error) {
	var val string
	err := database.QueryRowContext(ctx,
		"SELECT value FROM settings WHERE key = ? AND user_id = 0", key).Scan(&val)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get system setting: %w", err)
	}
	return &val, nil
}

// SetSystemSetting writes a system-wide setting (user_id = 0).
func SetSystemSetting(ctx context.Context, database *sql.DB, key, value string) error {
	_, err := database.ExecContext(ctx,
		"INSERT OR REPLACE INTO settings (user_id, key, value, updated_at) VALUES (0, ?, ?, CURRENT_TIMESTAMP)",
		key, value)
	if err != nil {
		return fmt.Errorf("set system setting: %w", err)
	}
	return nil
}

// GetRegistrationCode returns the current registration code, if set.
func GetRegistrationCode(ctx context.Context, database *sql.DB) (*string, error) {
	row := database.QueryRowContext(ctx,
		"SELECT value FROM settings WHERE key = 'registration_code' AND value != '' LIMIT 1")

	var val string
	err := row.Scan(&val)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get registration code: %w", err)
	}
	return &val, nil
}

// HasRegistrationCode checks if a registration code is configured.
func HasRegistrationCode(ctx context.Context, database *sql.DB) (bool, error) {
	var count int
	err := database.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM settings WHERE key = 'registration_code' AND value != ''").Scan(&count)
	return count > 0, err
}
