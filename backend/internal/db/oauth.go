package db

// OAuth data layer ported from Node's db/oauth.js: CSRF/PKCE state storage
// for the SSO redirect flow plus user lookup, creation, and account linking
// against the users table's oauth_provider columns (migration 0003).

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// OAuthStateRow is the ephemeral state record consumed on callback.
type OAuthStateRow struct {
	CodeVerifier string
	Nonce        string
	RedirectURI  sql.NullString
	ProviderName sql.NullString
}

// CreateOAuthState stores the state + PKCE verifier + nonce for a pending
// SSO login (single-use; consumed by ConsumeOAuthState).
func CreateOAuthState(ctx context.Context, database *sql.DB, state, codeVerifier, nonce string, redirectURI, providerName *string) error {
	_, err := database.ExecContext(ctx,
		`INSERT INTO oauth_states (state, code_verifier, nonce, redirect_uri, provider_name)
		 VALUES (?, ?, ?, ?, ?)`,
		state, codeVerifier, nonce, redirectURI, providerName)
	if err != nil {
		return fmt.Errorf("create oauth state: %w", err)
	}
	return nil
}

// ConsumeOAuthState fetches and deletes a state record (single use). Returns
// nil when the state is unknown or older than 10 minutes (mirrors Node's
// expiry window: expired rows are deleted and treated as invalid).
func ConsumeOAuthState(ctx context.Context, database *sql.DB, state string) (*OAuthStateRow, error) {
	var r OAuthStateRow
	var createdAt string
	err := database.QueryRowContext(ctx,
		`SELECT code_verifier, nonce, redirect_uri, provider_name, created_at
		 FROM oauth_states WHERE state = ?`, state).
		Scan(&r.CodeVerifier, &r.Nonce, &r.RedirectURI, &r.ProviderName, &createdAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("consume oauth state: %w", err)
	}

	created, perr := ParseSQLiteTime(createdAt)
	if perr == nil && time.Since(created) > 10*time.Minute {
		// Expired: delete and treat as invalid (delete errors ignored, like Node).
		_, _ = database.ExecContext(ctx, "DELETE FROM oauth_states WHERE state = ?", state)
		return nil, nil
	}

	if _, derr := database.ExecContext(ctx, "DELETE FROM oauth_states WHERE state = ?", state); derr != nil {
		// Node still returns the data when the delete fails — the state was valid.
		// Log-and-continue equivalent: the row may linger until the hourly cleanup.
	}
	return &r, nil
}

// CleanExpiredOAuthStates deletes state rows older than 10 minutes and
// returns the number removed (Node's hourly maintenance task).
func CleanExpiredOAuthStates(ctx context.Context, database *sql.DB) (int64, error) {
	res, err := database.ExecContext(ctx,
		"DELETE FROM oauth_states WHERE created_at < datetime('now', '-10 minutes')")
	if err != nil {
		return 0, fmt.Errorf("clean expired oauth states: %w", err)
	}
	return res.RowsAffected()
}

func scanUserRow(scan func(dest ...any) error) (*UserRow, error) {
	var u UserRow
	err := scan(&u.ID, &u.Username, &u.PasswordHash, &u.Role,
		&u.PasswordChanged, &u.InstanceAdmin, &u.Email, &u.LastLogin, &u.CreatedAt, &u.UpdatedAt,
		&u.OAuthProvider, &u.OAuthProviderID)
	if err != nil {
		return nil, err
	}
	return &u, nil
}

// GetUserByOAuthID finds the user linked to a provider identity.
func GetUserByOAuthID(ctx context.Context, database *sql.DB, provider, providerID string) (*UserRow, error) {
	row := database.QueryRowContext(ctx,
		"SELECT "+userCols+" FROM users WHERE oauth_provider = ? AND oauth_provider_id = ?",
		provider, providerID)
	u, err := scanUserRow(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get user by oauth id: %w", err)
	}
	return u, nil
}

// GetUserByEmail finds a user by email address (SSO account-linking lookup).
func GetUserByEmail(ctx context.Context, database *sql.DB, email string) (*UserRow, error) {
	row := database.QueryRowContext(ctx,
		"SELECT "+userCols+" FROM users WHERE email = ?", email)
	u, err := scanUserRow(row.Scan)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get user by email: %w", err)
	}
	return u, nil
}

// CreateOAuthUser inserts a password-less OAuth user (password_changed 0)
// and returns the new id. Mirrors Node's createOAuthUser column list.
func CreateOAuthUser(ctx context.Context, database *sql.DB, username string, email *string,
	oauthProvider, oauthProviderID, role string, instanceAdmin bool) (int64, error) {
	admin := 0
	if instanceAdmin {
		admin = 1
	}
	res, err := database.ExecContext(ctx,
		`INSERT INTO users (username, password_hash, email, role, password_changed, instance_admin, oauth_provider, oauth_provider_id)
		 VALUES (?, NULL, ?, ?, 0, ?, ?, ?)`,
		username, email, role, admin, oauthProvider, oauthProviderID)
	if err != nil {
		return 0, fmt.Errorf("create oauth user: %w", err)
	}
	return res.LastInsertId()
}

// LinkOAuthToUser attaches a provider identity to an existing user. Errors
// with ErrNoRows-style "user not found" when the id does not exist.
func LinkOAuthToUser(ctx context.Context, database *sql.DB, userID int64, provider, providerID string) error {
	res, err := database.ExecContext(ctx,
		"UPDATE users SET oauth_provider = ?, oauth_provider_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
		provider, providerID, userID)
	if err != nil {
		return fmt.Errorf("link oauth to user: %w", err)
	}
	changes, err := res.RowsAffected()
	if err != nil {
		return fmt.Errorf("link oauth to user: %w", err)
	}
	if changes == 0 {
		return errors.New("User not found")
	}
	return nil
}
