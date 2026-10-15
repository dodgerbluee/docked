package db

import (
	"context"
	"database/sql"
	"fmt"
)

// DiscordWebhookRow is a row from the discord_webhooks table.
type DiscordWebhookRow struct {
	ID          int64
	UserID      int64
	WebhookURL  string
	ServerName  sql.NullString
	ChannelName sql.NullString
	Name        sql.NullString
	Enabled     int
	AvatarURL   sql.NullString
	GuildID     sql.NullString
	ChannelID   sql.NullString
	CreatedAt   string
	UpdatedAt   string
}

const webhookCols = `id, user_id, webhook_url, server_name, channel_name, name, enabled, avatar_url, guild_id, channel_id, created_at, updated_at`

func scanWebhook(row interface{ Scan(...any) error }) (DiscordWebhookRow, error) {
	var r DiscordWebhookRow
	err := row.Scan(&r.ID, &r.UserID, &r.WebhookURL, &r.ServerName, &r.ChannelName,
		&r.Name, &r.Enabled, &r.AvatarURL, &r.GuildID, &r.ChannelID, &r.CreatedAt, &r.UpdatedAt)
	return r, err
}

func GetDiscordWebhooks(ctx context.Context, database *sql.DB, userID int64) ([]DiscordWebhookRow, error) {
	rows, err := database.QueryContext(ctx,
		"SELECT "+webhookCols+" FROM discord_webhooks WHERE user_id = ? ORDER BY created_at ASC", userID)
	if err != nil {
		return nil, fmt.Errorf("get discord webhooks: %w", err)
	}
	defer rows.Close()

	var results []DiscordWebhookRow
	for rows.Next() {
		r, err := scanWebhook(rows)
		if err != nil {
			return nil, fmt.Errorf("scan discord webhook: %w", err)
		}
		results = append(results, r)
	}
	return results, rows.Err()
}

func GetDiscordWebhookByID(ctx context.Context, database *sql.DB, id, userID int64) (*DiscordWebhookRow, error) {
	row := database.QueryRowContext(ctx,
		"SELECT "+webhookCols+" FROM discord_webhooks WHERE id = ? AND user_id = ?", id, userID)

	r, err := scanWebhook(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get discord webhook: %w", err)
	}
	return &r, nil
}

func CreateDiscordWebhook(ctx context.Context, database *sql.DB, userID int64, webhookURL string,
	serverName, channelName *string, enabled bool) (int64, error) {

	enabledInt := 0
	if enabled {
		enabledInt = 1
	}
	result, err := database.ExecContext(ctx,
		`INSERT INTO discord_webhooks (user_id, webhook_url, server_name, channel_name, enabled)
		 VALUES (?, ?, ?, ?, ?)`,
		userID, webhookURL, serverName, channelName, enabledInt)
	if err != nil {
		return 0, fmt.Errorf("create discord webhook: %w", err)
	}
	return result.LastInsertId()
}

func UpdateDiscordWebhook(ctx context.Context, database *sql.DB, id, userID int64,
	webhookURL, serverName, channelName *string, enabled *bool) error {

	setClauses := []string{}
	args := []any{}

	if webhookURL != nil {
		setClauses = append(setClauses, "webhook_url = ?")
		args = append(args, *webhookURL)
	}
	if serverName != nil {
		setClauses = append(setClauses, "server_name = ?")
		args = append(args, *serverName)
	}
	if channelName != nil {
		setClauses = append(setClauses, "channel_name = ?")
		args = append(args, *channelName)
	}
	if enabled != nil {
		enabledInt := 0
		if *enabled {
			enabledInt = 1
		}
		setClauses = append(setClauses, "enabled = ?")
		args = append(args, enabledInt)
	}

	if len(setClauses) == 0 {
		return nil
	}

	setClauses = append(setClauses, "updated_at = datetime('now')")
	args = append(args, id, userID)

	query := fmt.Sprintf("UPDATE discord_webhooks SET %s WHERE id = ? AND user_id = ?",
		joinStrings(setClauses, ", "))

	_, err := database.ExecContext(ctx, query, args...)
	return err
}

func DeleteDiscordWebhook(ctx context.Context, database *sql.DB, id, userID int64) error {
	_, err := database.ExecContext(ctx,
		"DELETE FROM discord_webhooks WHERE id = ? AND user_id = ?", id, userID)
	return err
}
