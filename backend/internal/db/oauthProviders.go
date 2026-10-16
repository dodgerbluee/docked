package db

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// OAuthProviderRow mirrors a row of the oauth_providers table
// (admin-managed runtime SSO providers).
type OAuthProviderRow struct {
	ID           int64
	Name         string
	DisplayName  string
	ProviderType string
	ClientID     string
	ClientSecret string
	IssuerURL    string
	Scopes       string
	AutoRegister int
	DefaultRole  string
	Enabled      int
	CreatedAt    string
	UpdatedAt    string
}

const oauthProviderCols = `id, name, display_name, provider_type, client_id, client_secret,
	issuer_url, scopes, auto_register, default_role, enabled, created_at, updated_at`

func scanOAuthProvider(scan func(dest ...any) error) (*OAuthProviderRow, error) {
	var r OAuthProviderRow
	err := scan(&r.ID, &r.Name, &r.DisplayName, &r.ProviderType, &r.ClientID, &r.ClientSecret,
		&r.IssuerURL, &r.Scopes, &r.AutoRegister, &r.DefaultRole, &r.Enabled, &r.CreatedAt, &r.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &r, nil
}

func GetAllOAuthProviders(ctx context.Context, database *sql.DB) ([]OAuthProviderRow, error) {
	rows, err := database.QueryContext(ctx, "SELECT "+oauthProviderCols+" FROM oauth_providers ORDER BY name")
	if err != nil {
		return nil, fmt.Errorf("get all oauth providers: %w", err)
	}
	defer rows.Close()

	var result []OAuthProviderRow
	for rows.Next() {
		r, err := scanOAuthProvider(rows.Scan)
		if err != nil {
			return nil, fmt.Errorf("scan oauth provider: %w", err)
		}
		result = append(result, *r)
	}
	return result, rows.Err()
}

func GetOAuthProviderByName(ctx context.Context, database *sql.DB, name string) (*OAuthProviderRow, error) {
	row := database.QueryRowContext(ctx,
		"SELECT "+oauthProviderCols+" FROM oauth_providers WHERE name = ?", name)
	r, err := scanOAuthProvider(row.Scan)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get oauth provider by name: %w", err)
	}
	return r, nil
}

func GetOAuthProviderByID(ctx context.Context, database *sql.DB, id int64) (*OAuthProviderRow, error) {
	row := database.QueryRowContext(ctx,
		"SELECT "+oauthProviderCols+" FROM oauth_providers WHERE id = ?", id)
	r, err := scanOAuthProvider(row.Scan)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get oauth provider by id: %w", err)
	}
	return r, nil
}

// CreateOAuthProvider inserts a provider row and returns its id.
// Defaults mirror Node's createOAuthProvider: scopes "openid,profile,email",
// auto_register 1, default_role "Administrator", enabled 1.
func CreateOAuthProvider(ctx context.Context, database *sql.DB, r *OAuthProviderRow) (int64, error) {
	res, err := database.ExecContext(ctx,
		`INSERT INTO oauth_providers
		 (name, display_name, provider_type, client_id, client_secret, issuer_url,
		  scopes, auto_register, default_role, enabled)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		r.Name, r.DisplayName, r.ProviderType, r.ClientID, r.ClientSecret, r.IssuerURL,
		r.Scopes, r.AutoRegister, r.DefaultRole, r.Enabled)
	if err != nil {
		return 0, fmt.Errorf("create oauth provider: %w", err)
	}
	return res.LastInsertId()
}

// UpdateOAuthProvider applies the given column updates (keys are column names).
// Returns rows affected.
func UpdateOAuthProvider(ctx context.Context, database *sql.DB, id int64, updates map[string]any) (int, error) {
	if len(updates) == 0 {
		return 0, nil
	}
	sets := make([]string, 0, len(updates))
	args := make([]any, 0, len(updates)+1)
	for col, val := range updates {
		sets = append(sets, col+" = ?")
		args = append(args, val)
	}
	sets = append(sets, "updated_at = CURRENT_TIMESTAMP")
	args = append(args, id)
	res, err := database.ExecContext(ctx,
		"UPDATE oauth_providers SET "+strings.Join(sets, ", ")+" WHERE id = ?", args...)
	if err != nil {
		return 0, fmt.Errorf("update oauth provider: %w", err)
	}
	changes, err := res.RowsAffected()
	return int(changes), err
}

func DeleteOAuthProvider(ctx context.Context, database *sql.DB, id int64) (int, error) {
	res, err := database.ExecContext(ctx, "DELETE FROM oauth_providers WHERE id = ?", id)
	if err != nil {
		return 0, fmt.Errorf("delete oauth provider: %w", err)
	}
	changes, err := res.RowsAffected()
	return int(changes), err
}
