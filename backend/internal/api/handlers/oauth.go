package handlers

// OAuth/SSO REST routes ported from Node's oauthController.js (phase 7d):
// provider listing, flow initiation (302 to the IdP), callback (code exchange,
// ID-token validation, account resolution, cookie handoff), and password-
// confirmed account linking. Node keeps the edge oauthLimiter and forwards
// these through utils/goRunnerProxy.js, so envelopes and redirect targets
// must match Node exactly.

import (
	"crypto/subtle"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/dockedapp/backend/internal/auth"
	"github.com/dockedapp/backend/internal/config"
	"github.com/dockedapp/backend/internal/db"
	"github.com/dockedapp/backend/internal/oauth"
)

// oauthRedirectTarget is the client-side landing page for the OAuth flow.
const oauthRedirectTarget = "/auth/oauth/complete"

// oauthStateCookieName binds an OAuth login to the browser that started it.
// The state param alone proves the state row exists, not that this browser
// initiated the flow; the HttpOnly cookie (set on login initiation, checked
// on callback) closes that login-CSRF gap.
const oauthStateCookieName = "docked_oauth_state"

// requestProtocol mirrors Node's `req.get("x-forwarded-proto") || req.protocol`
// (trust proxy is enabled, so req.protocol follows the forwarded header).
func requestProtocol(r *http.Request) string {
	if p := r.Header.Get("X-Forwarded-Proto"); p != "" {
		return p
	}
	if r.TLS != nil {
		return "https"
	}
	return "http"
}

// requestHost mirrors Node's `req.get("x-forwarded-host") || req.get("host")`.
func requestHost(r *http.Request) string {
	if h := r.Header.Get("X-Forwarded-Host"); h != "" {
		return h
	}
	return r.Host
}

// GetOAuthProviders lists configured SSO providers for the login page.
// Public endpoint (Node puts it behind publicLimiter).
func GetOAuthProviders(registry *oauth.Registry, database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		registry.EnsureFresh(r.Context())
		if !registry.Known() {
			// Unknown is not the same as empty: advertising allowLocalLogin:true
			// here would tell the login page there is a working password door
			// when storage simply could not be read.
			writeRunnerJSON(w, http.StatusOK, map[string]any{
				"success":         false,
				"error":           "Authentication providers are temporarily unavailable",
				"providers":       []any{},
				"allowLocalLogin": false,
			})
			return
		}
		if !registry.Enabled() {
			writeRunnerJSON(w, http.StatusOK, map[string]any{
				"success":         true,
				"providers":       []any{},
				"allowLocalLogin": true,
			})
			return
		}

		providers := registry.ConfiguredProviders()
		sort.Slice(providers, func(i, j int) bool { return providers[i].Name < providers[j].Name })

		// DB system setting wins over the env-var default (Node parity).
		allowLocalLogin := registry.AllowLocalLoginDefault()
		if dbValue, err := db.GetSystemSetting(r.Context(), database, "oauth_allow_local_login"); err == nil && dbValue != nil {
			allowLocalLogin = *dbValue != "false"
		}

		out := make([]map[string]any, 0, len(providers))
		for _, p := range providers {
			out = append(out, map[string]any{"name": p.Name, "displayName": p.DisplayName})
		}
		writeRunnerJSON(w, http.StatusOK, map[string]any{
			"success":         true,
			"providers":       out,
			"allowLocalLogin": allowLocalLogin,
		})
	}
}

// OAuthLogin initiates the SSO flow: generate state/PKCE/nonce, persist them,
// and 302 the browser to the provider's authorization endpoint.
func OAuthLogin(registry *oauth.Registry, cfg config.OAuthConfig, database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		registry.EnsureFresh(r.Context())
		if !registry.Known() {
			runnerFail(w, http.StatusServiceUnavailable, "Authentication is temporarily unavailable")
			return
		}
		if !registry.Enabled() {
			runnerFail(w, http.StatusBadRequest, "No OAuth providers are configured")
			return
		}

		providerName := r.URL.Query().Get("provider")
		if providerName == "" {
			providerName = cfg.Provider
		}
		if providerName == "" {
			runnerFail(w, http.StatusBadRequest, "No OAuth provider specified")
			return
		}

		provider := registry.GetProvider(providerName)
		if provider == nil {
			runnerFail(w, http.StatusBadRequest, fmt.Sprintf("OAuth provider '%s' is not configured", providerName))
			return
		}

		codeVerifier, codeChallenge, err := oauth.GeneratePKCE()
		if err != nil {
			oauthInternalError(w)
			return
		}
		state, err := oauth.GenerateHexRandom()
		if err != nil {
			oauthInternalError(w)
			return
		}
		nonce, err := oauth.GenerateHexRandom()
		if err != nil {
			oauthInternalError(w)
			return
		}

		callbackURL := fmt.Sprintf("%s://%s/api/auth/oauth/callback", requestProtocol(r), requestHost(r))

		if err := db.CreateOAuthState(r.Context(), database, state, codeVerifier, nonce, &callbackURL, &providerName); err != nil {
			slog.Error("Failed to store OAuth state", "error", err.Error())
			oauthInternalError(w)
			return
		}

		// Browser binding for the callback (login-CSRF guard): only the
		// browser that started this flow presents the matching cookie.
		http.SetCookie(w, &http.Cookie{
			Name:     oauthStateCookieName,
			Value:    state,
			Path:     "/api/auth/oauth",
			MaxAge:   600,
			HttpOnly: true,
			Secure:   requestProtocol(r) == "https",
			SameSite: http.SameSiteLaxMode,
		})

		authorizationURL, err := provider.AuthorizationURL(r.Context(), state, codeChallenge, nonce, callbackURL)
		if err != nil {
			slog.Error("Failed to initiate OAuth login", "error", err.Error())
			oauthInternalError(w)
			return
		}

		slog.Info("OAuth login initiated")
		http.Redirect(w, r, authorizationURL, http.StatusFound)
	}
}

// OAuthCallback handles the IdP redirect-back: state consumption, code
// exchange, ID-token validation, account resolution, and the cookie handoff
// to the client landing page.
func OAuthCallback(registry *oauth.Registry, cfg config.OAuthConfig, database *sql.DB, secret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		registry.EnsureFresh(r.Context())

		q := r.URL.Query()
		code := q.Get("code")
		state := q.Get("state")
		oauthError := q.Get("error")
		// Node reads error_description but every message branch overrides it;
		// the mapping table below is the effective behavior.

		frontendBase := fmt.Sprintf("%s://%s", requestProtocol(r), requestHost(r))
		redirectErr := func(message string) {
			http.Redirect(w, r,
				frontendBase+oauthRedirectTarget+"?error="+url.QueryEscape(message), http.StatusFound)
		}

		// Provider-reported errors (user denied, IdP failure, ...).
		if oauthError != "" {
			redirectErr(oauthProviderErrorMessage(oauthError))
			return
		}

		if code == "" || state == "" {
			redirectErr("Missing authorization code or state parameter")
			return
		}

		// Login-CSRF guard: the callback must carry the same state in the
		// HttpOnly cookie set when this browser initiated the flow. A
		// borrowed or guessed state param alone cannot complete a login.
		stateCookie, cerr := r.Cookie(oauthStateCookieName)
		if cerr != nil || stateCookie.Value == "" ||
			subtle.ConstantTimeCompare([]byte(stateCookie.Value), []byte(state)) != 1 {
			redirectErr("Invalid or expired login session. Please try again.")
			return
		}
		// Single use: clear it whether or not the rest of the flow succeeds.
		http.SetCookie(w, &http.Cookie{
			Name:     oauthStateCookieName,
			Value:    "",
			Path:     "/api/auth/oauth",
			MaxAge:   -1,
			HttpOnly: true,
			Secure:   requestProtocol(r) == "https",
			SameSite: http.SameSiteLaxMode,
		})

		storedState, err := db.ConsumeOAuthState(r.Context(), database, state)
		if err != nil {
			slog.Error("OAuth callback failed", "error", err.Error())
			redirectErr("Authentication failed. Please try again or contact your administrator.")
			return
		}
		if storedState == nil {
			redirectErr("Invalid or expired login session. Please try again.")
			return
		}

		// Provider from stored state; env fallback covers in-flight upgrades.
		providerName := cfg.Provider
		if storedState.ProviderName.Valid && storedState.ProviderName.String != "" {
			providerName = storedState.ProviderName.String
		}
		provider := registry.GetProvider(providerName)
		if provider == nil {
			redirectErr("OAuth provider not available")
			return
		}

		redirectURI := ""
		if storedState.RedirectURI.Valid {
			redirectURI = storedState.RedirectURI.String
		}

		tokenResponse, err := provider.ExchangeCode(r.Context(), code, storedState.CodeVerifier, redirectURI)
		if err != nil {
			redirectErr(catchAllRedirectMessage(err))
			return
		}
		if tokenResponse.AccessToken == "" {
			redirectErr("Failed to obtain access token from provider")
			return
		}

		var idTokenClaims map[string]any
		if tokenResponse.IDToken != "" {
			claims, verr := provider.ValidateIDToken(r.Context(), tokenResponse.IDToken, storedState.Nonce)
			if verr != nil {
				redirectErr(catchAllRedirectMessage(verr))
				return
			}
			idTokenClaims = claims
		}

		rawUserInfo := provider.GetUserInfo(r.Context(), tokenResponse.AccessToken)

		normalizedUser, err := provider.NormalizeUserInfo(rawUserInfo, idTokenClaims)
		if err != nil {
			redirectErr(catchAllRedirectMessage(err))
			return
		}
		slog.Info("OAuth user info normalized", "username", normalizedUser.Username, "id", normalizedUser.ID)

		result, err := resolveOAuthUser(r, registry, database, providerName, normalizedUser)
		if err != nil {
			redirectErr(catchAllRedirectMessage(err))
			return
		}

		if result.linkRequired {
			linkToken, terr := signOAuthLinkToken(secret, providerName, normalizedUser, result.existingUserID, result.existingUsername)
			if terr != nil {
				slog.Error("OAuth callback failed", "error", terr.Error())
				redirectErr("Authentication failed. Please try again or contact your administrator.")
				return
			}
			params := url.Values{}
			params.Set("linkRequired", "true")
			params.Set("linkToken", linkToken)
			params.Set("username", result.existingUsername)
			http.Redirect(w, r, frontendBase+oauthRedirectTarget+"?"+params.Encode(), http.StatusFound)
			return
		}

		token, refreshToken, terr := auth.GenerateTokens(result.ID, result.Username, result.Role, result.TokenVersion)
		if terr != nil {
			slog.Error("OAuth callback failed", "error", terr.Error())
			redirectErr("Authentication failed. Please try again or contact your administrator.")
			return
		}

		if luerr := db.UpdateLastLogin(r.Context(), database, result.Username); luerr != nil {
			slog.Warn("Failed to update last login for OAuth user", "error", luerr.Error())
		}

		// SECURITY: cookies are a short-lived transport for the redirect flow
		// (client reads them on the landing page, moves to localStorage, and
		// clears them). httpOnly:false is required for js-cookie; maxAge 60s +
		// SameSite=Lax + Secure limit the exposure window. Node parity.
		secure := requestProtocol(r) == "https"
		cookieOpts := &http.Cookie{
			Path:     "/",
			HttpOnly: false,
			Secure:   secure,
			SameSite: http.SameSiteLaxMode,
			MaxAge:   60,
		}
		for _, c := range []struct{ name, value string }{
			{"authToken", token},
			{"refreshToken", refreshToken},
			{"username", result.Username},
			{"userRole", result.Role},
			{"instanceAdmin", fmt.Sprintf("%t", result.InstanceAdmin)},
		} {
			ck := *cookieOpts
			ck.Name, ck.Value = c.name, c.value
			http.SetCookie(w, &ck)
		}

		http.Redirect(w, r, frontendBase+oauthRedirectTarget, http.StatusFound)
	}
}

// OAuthLink completes account linking after password confirmation.
func OAuthLink(database *sql.DB, secret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		body, ok := decodeJSONObject(w, r)
		if !ok {
			return
		}

		if !jsTruthy(body["linkToken"]) || !jsTruthy(body["password"]) {
			runnerFail(w, http.StatusBadRequest, "Link token and password are required")
			return
		}
		linkToken, _ := body["linkToken"].(string)
		password, _ := body["password"].(string)

		parser := jwt.NewParser(
			jwt.WithIssuer("docked"),
			jwt.WithAudience("docked-oauth-link"),
			jwt.WithStrictDecoding(), // canonical form only (see auth parsers)
		)
		token, err := parser.Parse(linkToken, func(t *jwt.Token) (any, error) {
			if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
				return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
			}
			return []byte(secret), nil
		})
		if err != nil {
			msg := "Invalid linking session. Please try signing in with SSO again."
			if errors.Is(err, jwt.ErrTokenExpired) {
				msg = "This linking session has expired. Please try signing in with SSO again."
			}
			runnerFail(w, http.StatusBadRequest, msg)
			return
		}
		claims, _ := token.Claims.(jwt.MapClaims)

		if claims["purpose"] != "oauth_link" {
			runnerFail(w, http.StatusBadRequest, "Invalid link token")
			return
		}

		targetUsername, _ := claims["targetUsername"].(string)
		targetUserID, _ := claims["targetUserId"].(float64)

		user, err := db.GetUserByUsername(r.Context(), database, targetUsername)
		if err != nil {
			slog.Error("Account linking failed", "error", err.Error())
			runnerFail(w, http.StatusInternalServerError, "Account linking failed")
			return
		}
		if user == nil || user.ID != int64(targetUserID) {
			runnerFail(w, http.StatusBadRequest, "User account not found")
			return
		}

		if !auth.CheckPassword(user.PasswordHash.String, password) {
			runnerFail(w, http.StatusUnauthorized, "Incorrect password")
			return
		}

		providerName, _ := claims["providerName"].(string)
		oauthID, _ := claims["oauthId"].(string)
		if err := db.LinkOAuthToUser(r.Context(), database, user.ID, providerName, oauthID); err != nil {
			slog.Error("Account linking failed", "error", err.Error())
			runnerFail(w, http.StatusInternalServerError, "Account linking failed")
			return
		}
		slog.Info("Linked OAuth identity to existing user with password confirmation",
			"provider", providerName, "username", user.Username)

		accessToken, refreshToken, terr := auth.GenerateTokens(user.ID, user.Username, user.Role, user.TokenVersion)
		if terr != nil {
			slog.Error("Account linking failed", "error", terr.Error())
			runnerFail(w, http.StatusInternalServerError, "Account linking failed")
			return
		}

		if luerr := db.UpdateLastLogin(r.Context(), database, user.Username); luerr != nil {
			slog.Warn("Failed to update last login", "error", luerr.Error())
		}

		writeRunnerJSON(w, http.StatusOK, map[string]any{
			"success":       true,
			"token":         accessToken,
			"refreshToken":  refreshToken,
			"username":      user.Username,
			"role":          user.Role,
			"instanceAdmin": user.InstanceAdmin == 1,
		})
	}
}

// oauthResolvedUser is the outcome of account resolution: either a resolved
// local account or a "link required" marker with the colliding user.
type oauthResolvedUser struct {
	ID               int64
	Username         string
	Role             string
	InstanceAdmin    bool
	TokenVersion     int64
	linkRequired     bool
	existingUserID   int64
	existingUsername string
}

// resolveOAuthUser ports oauthController.resolveOAuthUser: linked identity →
// email match (link or linkRequired) → username collision → auto-register.
func resolveOAuthUser(r *http.Request, registry *oauth.Registry, database *sql.DB,
	providerName string, user *oauth.NormalizedUser) (*oauthResolvedUser, error) {
	ctx := r.Context()

	// 1. Existing linked account.
	existing, err := db.GetUserByOAuthID(ctx, database, providerName, user.ID)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		return &oauthResolvedUser{
			ID: existing.ID, Username: existing.Username, Role: existing.Role,
			InstanceAdmin: existing.InstanceAdmin == 1, TokenVersion: existing.TokenVersion,
		}, nil
	}

	// 2. Email match. An explicitly unverified email is never trusted for
	// account matching: an attacker who registers the victim's address at
	// the IdP (without the provider verifying it) must not be able to
	// claim the victim's local account.
	if user.Email != "" && !(user.EmailVerified != nil && !*user.EmailVerified) {
		byEmail, err := db.GetUserByEmail(ctx, database, user.Email)
		if err != nil {
			return nil, err
		}
		if byEmail != nil {
			if byEmail.OAuthProvider.Valid && byEmail.OAuthProvider.String != "" &&
				byEmail.OAuthProvider.String != providerName {
				return nil, fmt.Errorf(
					"This email is already linked to a different SSO provider (%s). Please sign in with that provider instead.",
					byEmail.OAuthProvider.String)
			}
			if byEmail.PasswordHash.Valid && byEmail.PasswordHash.String != "" {
				return &oauthResolvedUser{linkRequired: true,
					existingUserID: byEmail.ID, existingUsername: byEmail.Username}, nil
			}
			// Passwordless account: auto-linking on an email (or username)
			// match hands the account to whoever presents a matching IdP
			// identity, with nothing to confirm prior ownership. Reject and
			// let an administrator resolve it.
			return nil, errors.New(
				"This account exists but is linked to a different SSO identity. Please contact your administrator.")
		}
	}

	// 3. Username collision. Same rule as the email match: only accounts
	// with a password may be claimed (via the password-confirmation link
	// flow); passwordless accounts are never auto-linked.
	byName, err := db.GetUserByUsername(ctx, database, user.Username)
	if err != nil {
		return nil, err
	}
	if byName != nil {
		if byName.PasswordHash.Valid && byName.PasswordHash.String != "" {
			return &oauthResolvedUser{linkRequired: true,
				existingUserID: byName.ID, existingUsername: byName.Username}, nil
		}
		return nil, errors.New(
			"An account with this username already exists and is linked to a different SSO identity. Please contact your administrator.")
	}

	// 4. Auto-register. The first-user privilege is decided atomically by
	// the insert itself (a count-then-insert check raced: two concurrent
	// first logins could both become instance admin).
	settings := registry.ProviderSettings(providerName)
	if !settings.AutoRegister {
		return nil, errors.New("No account found for this identity. Please contact your administrator to create an account.")
	}

	var emailArg *string
	if user.Email != "" {
		emailArg = &user.Email
	}
	newID, isFirstUser, err := db.CreateOAuthUser(ctx, database, user.Username, emailArg,
		providerName, user.ID, settings.DefaultRole)
	if err != nil {
		return nil, err
	}
	slog.Info("Created new OAuth user", "username", user.Username, "provider", providerName, "firstUser", isFirstUser)

	return &oauthResolvedUser{
		ID: newID, Username: user.Username, Role: settings.DefaultRole, InstanceAdmin: isFirstUser,
	}, nil
}

// signOAuthLinkToken mints the short-lived link JWT (Node: HS256, 5m,
// issuer "docked", audience "docked-oauth-link" written as a string).
func signOAuthLinkToken(secret, providerName string, user *oauth.NormalizedUser,
	targetUserID int64, targetUsername string) (string, error) {
	now := time.Now()
	var emailArg any
	if user.Email != "" {
		emailArg = user.Email
	}
	claims := jwt.MapClaims{
		"purpose":        "oauth_link",
		"providerName":   providerName,
		"oauthId":        user.ID,
		"oauthUsername":  user.Username,
		"oauthEmail":     emailArg,
		"targetUserId":   targetUserID,
		"targetUsername": targetUsername,
		"iss":            "docked",
		"aud":            "docked-oauth-link",
		"iat":            now.Unix(),
		"exp":            now.Add(5 * time.Minute).Unix(),
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
}

// oauthProviderErrorMessage maps provider callback error codes to user
// messages (Node's handleCallback branch chain).
func oauthProviderErrorMessage(oauthError string) string {
	switch oauthError {
	case "access_denied":
		return "Sign-in was cancelled."
	case "invalid_request":
		return "Invalid sign-in request. Please try again."
	case "unauthorized_client":
		return "Sign-in service configuration error. Please contact your administrator."
	case "server_error", "temporarily_unavailable":
		return "Sign-in service is temporarily unavailable. Please try again later."
	default:
		return "Sign-in failed. Please try again or contact your administrator."
	}
}

// catchAllRedirectMessage mirrors the callback catch-block message mapping.
func catchAllRedirectMessage(err error) string {
	msg := err.Error()
	switch {
	case strings.Contains(msg, "Token exchange failed"):
		return "Unable to complete sign-in. The sign-in service may be experiencing issues. Please try again."
	case strings.Contains(msg, "ID token validation failed"):
		return "Sign-in verification failed. Please try again or contact your administrator."
	case strings.Contains(msg, "SSO provider unavailable"):
		return "Sign-in service is currently unavailable. Please try again later."
	default:
		return "Authentication failed. Please try again or contact your administrator."
	}
}

// oauthInternalError reproduces Node's production error-handler envelope for
// unexpected failures inside initiateLogin (next(error) → errorHandler).
func oauthInternalError(w http.ResponseWriter) {
	writeRunnerJSON(w, http.StatusInternalServerError, map[string]any{
		"success":   false,
		"error":     "Internal server error",
		"errorCode": "INTERNAL_ERROR",
	})
}
