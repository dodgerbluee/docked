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

// ConsumeOAuthState deletes and returns a state record atomically (single
// use). Returns nil when the state is unknown or older than 10 minutes
// (mirrors Node's expiry window: expired rows are deleted and treated as
// invalid). The DELETE ... RETURNING form is what makes it single-use:
// concurrent callbacks carrying the same CSRF state race, and only one of
// them receives the row — the old SELECT-then-DELETE pair let both pass.
func ConsumeOAuthState(ctx context.Context, database *sql.DB, state string) (*OAuthStateRow, error) {
	var r OAuthStateRow
	var createdAt string
	err := database.QueryRowContext(ctx,
		`DELETE FROM oauth_states WHERE state = ?
		 RETURNING code_verifier, nonce, redirect_uri, provider_name, created_at`, state).
		Scan(&r.CodeVerifier, &r.Nonce, &r.RedirectURI, &r.ProviderName, &createdAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("consume oauth state: %w", err)
	}

	created, perr := ParseSQLiteTime(createdAt)
	if perr == nil && time.Since(created) > 10*time.Minute {
		// Expired: the atomic DELETE already removed the row.
		return nil, nil
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
		&u.OAuthProvider, &u.OAuthProviderID, &u.TokenVersion)
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

// CreateOAuthUser inserts a password-less OAuth user (password_changed 0) and
// returns the new id plus whether it became the instance admin. The first-user
// privilege is decided INSIDE the insert statement (same atomic
// INSERT...SELECT pattern as RegisterUser): a separate GetUserCount check
// raced, letting two concurrent first logins both mint instance_admin=1.
func CreateOAuthUser(ctx context.Context, database *sql.DB, username string, email *string,
	oauthProvider, oauthProviderID, role string) (int64, bool, error) {
	const stmt = `INSERT INTO users (username, password_hash, email, role, password_changed, instance_admin, oauth_provider, oauth_provider_id)
		SELECT ?, NULL, ?, ?, 0,
			CASE WHEN (SELECT COUNT(*) FROM users) = 0 THEN 1 ELSE 0 END,
			?, ?
		RETURNING id, instance_admin`

	var id int64
	var admin int
	for attempt := 0; ; attempt++ {
		err := database.QueryRowContext(ctx, stmt, username, email, role, oauthProvider, oauthProviderID).
			Scan(&id, &admin)
		if err == nil {
			return id, admin == 1, nil
		}
		if !isBusy(err) || attempt >= 20 {
			return 0, false, fmt.Errorf("create oauth user: %w", err)
		}
		select {
		case <-ctx.Done():
			return 0, false, fmt.Errorf("create oauth user: %w", ctx.Err())
		case <-time.After(time.Duration(5*(1<<min(attempt, 5))) * time.Millisecond):
		}
	}
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
