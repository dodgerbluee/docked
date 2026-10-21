package handlers

// Tests for the OAuth/SSO REST handlers (phase 7d). A fake OIDC provider
// (httptest) serves discovery + JWKS + token + userinfo endpoints; the flow
// is driven end-to-end: login initiation → callback → (optional) link.

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"

	"github.com/dockedapp/backend/internal/auth"
	"github.com/dockedapp/backend/internal/config"
	"github.com/dockedapp/backend/internal/db"
	"github.com/dockedapp/backend/internal/oauth"
)

const (
	oauthTestClientID     = "test-client"
	oauthTestClientSecret = "test-secret"
)

// fakeIdP is a minimal OIDC provider: discovery, JWKS, token, userinfo.
type fakeIdP struct {
	srv   *httptest.Server
	key   *rsa.PrivateKey
	kid   string
	nonce string

	// knobs
	idTokenOverride func(nonce string) *string // nil → default claims
	tokenStatus     int
	tokenBody       map[string]any
	userInfo        map[string]any

	lastTokenForm url.Values
}

func newFakeIdP(t *testing.T) *fakeIdP {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("rsa key: %v", err)
	}
	f := &fakeIdP{key: key, kid: "test-kid"}
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, r *http.Request) {
		base := "http://" + r.Host
		json.NewEncoder(w).Encode(map[string]any{
			"issuer":                 base,
			"authorization_endpoint": base + "/authorize",
			"token_endpoint":         base + "/token",
			"jwks_uri":               base + "/jwks",
			"userinfo_endpoint":      base + "/userinfo",
		})
	})
	mux.HandleFunc("/jwks", func(w http.ResponseWriter, r *http.Request) {
		n := base64.RawURLEncoding.EncodeToString(f.key.N.Bytes())
		e := base64.RawURLEncoding.EncodeToString(big.NewInt(int64(f.key.E)).Bytes())
		json.NewEncoder(w).Encode(map[string]any{
			"keys": []map[string]any{{"kty": "RSA", "use": "sig", "alg": "RS256", "kid": f.kid, "n": n, "e": e}},
		})
	})
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		f.lastTokenForm = r.PostForm
		if f.tokenStatus != 0 {
			w.WriteHeader(f.tokenStatus)
			if f.tokenBody != nil {
				json.NewEncoder(w).Encode(f.tokenBody)
			}
			return
		}
		body := map[string]any{"access_token": "test-access-token", "token_type": "Bearer"}
		if f.idTokenOverride != nil {
			if raw := f.idTokenOverride(f.nonce); raw != nil {
				body["id_token"] = *raw
			}
		} else {
			raw := f.signIDToken(jwt.MapClaims{
				"sub":                "oidc-sub-1",
				"nonce":              f.nonce,
				"email":              "sso@example.com",
				"preferred_username": "ssouser",
				"name":               "SSO User",
			})
			body["id_token"] = raw
		}
		json.NewEncoder(w).Encode(body)
	})
	mux.HandleFunc("/userinfo", func(w http.ResponseWriter, r *http.Request) {
		info := f.userInfo
		if info == nil {
			info = map[string]any{}
		}
		json.NewEncoder(w).Encode(info)
	})
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	return f
}

func (f *fakeIdP) signIDToken(claims jwt.MapClaims) string {
	now := time.Now()
	claims["iss"] = f.srv.URL
	claims["aud"] = oauthTestClientID
	claims["iat"] = now.Unix()
	if _, ok := claims["exp"]; !ok {
		claims["exp"] = now.Add(10 * time.Minute).Unix()
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tok.Header["kid"] = f.kid
	raw, err := tok.SignedString(f.key)
	if err != nil {
		panic(err)
	}
	return raw
}

func newOAuthTestDB(t *testing.T) *sql.DB {
	t.Helper()
	database := newAuthTestDB(t)
	if _, err := database.Exec(`CREATE TABLE oauth_providers (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT UNIQUE NOT NULL,
		display_name TEXT NOT NULL,
		provider_type TEXT NOT NULL,
		client_id TEXT NOT NULL,
		client_secret TEXT NOT NULL,
		issuer_url TEXT NOT NULL,
		scopes TEXT DEFAULT 'openid,profile,email',
		auto_register INTEGER DEFAULT 1,
		default_role TEXT DEFAULT 'Administrator',
		enabled INTEGER DEFAULT 1,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	)`); err != nil {
		t.Fatalf("create oauth_providers: %v", err)
	}
	return database
}

func insertOAuthProvider(t *testing.T, database *sql.DB, name, idpURL string, autoRegister int) {
	t.Helper()
	_, err := database.Exec(`INSERT INTO oauth_providers
		(name, display_name, provider_type, client_id, client_secret, issuer_url, auto_register)
		VALUES (?, 'SSO Test', 'generic_oidc', ?, ?, ?, ?)`,
		name, oauthTestClientID, oauthTestClientSecret, idpURL, autoRegister)
	if err != nil {
		t.Fatalf("insert provider: %v", err)
	}
}

// newOAuthRouter mirrors the server.go mount (without the edge limiters).
func newOAuthRouter(database *sql.DB, cfg config.OAuthConfig) http.Handler {
	registry := oauth.NewRegistry(database, cfg)
	r := chi.NewRouter()
	r.Get("/auth/oauth/providers", GetOAuthProviders(registry, database))
	r.Get("/auth/oauth/login", OAuthLogin(registry, cfg, database))
	r.Get("/auth/oauth/callback", OAuthCallback(registry, cfg, database, authTestSecret))
	r.Post("/auth/oauth/link", OAuthLink(database, authTestSecret))
	return r
}

func doOAuthGet(t *testing.T, h http.Handler, target string, headers map[string]string) *http.Response {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	req.Host = "docked.example.com"
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Result()
}

// startFlow calls /auth/oauth/login and returns the state + stored row data.
func startFlow(t *testing.T, h http.Handler, database *sql.DB, provider string) (state, nonce, verifier string) {
	t.Helper()
	resp := doOAuthGet(t, h, "/auth/oauth/login?provider="+provider, nil)
	if resp.StatusCode != http.StatusFound {
		t.Fatalf("login status = %d", resp.StatusCode)
	}
	loc, err := url.Parse(resp.Header.Get("Location"))
	if err != nil {
		t.Fatalf("location: %v", err)
	}
	state = loc.Query().Get("state")
	nonce = loc.Query().Get("nonce")
	if state == "" || nonce == "" {
		t.Fatalf("missing state/nonce in %q", loc.String())
	}
	if err := database.QueryRow("SELECT code_verifier FROM oauth_states WHERE state = ?", state).Scan(&verifier); err != nil {
		t.Fatalf("state row: %v", err)
	}
	return
}

func TestOAuthProvidersDisabled(t *testing.T) {
	database := newOAuthTestDB(t)
	h := newOAuthRouter(database, config.OAuthConfig{})

	status, body := doJSON(t, h, http.MethodGet, "/auth/oauth/providers", nil, "")
	if status != http.StatusOK {
		t.Fatalf("status = %d", status)
	}
	if body["success"] != true {
		t.Fatalf("body = %v", body)
	}
	if list, ok := body["providers"].([]any); !ok || len(list) != 0 {
		t.Fatalf("providers = %v", body["providers"])
	}
	if body["allowLocalLogin"] != true {
		t.Fatalf("allowLocalLogin = %v", body["allowLocalLogin"])
	}
}

func TestOAuthProvidersFromDBWithSettingOverride(t *testing.T) {
	database := newOAuthTestDB(t)
	idp := newFakeIdP(t)
	insertOAuthProvider(t, database, "myidp", idp.srv.URL, 1)
	if err := db.SetSystemSetting(context.Background(), database, "oauth_allow_local_login", "false"); err != nil {
		t.Fatalf("set setting: %v", err)
	}
	h := newOAuthRouter(database, config.OAuthConfig{AllowLocalLogin: true})

	status, body := doJSON(t, h, http.MethodGet, "/auth/oauth/providers", nil, "")
	if status != http.StatusOK {
		t.Fatalf("status = %d", status)
	}
	list, ok := body["providers"].([]any)
	if !ok || len(list) != 1 {
		t.Fatalf("providers = %v", body["providers"])
	}
	p := list[0].(map[string]any)
	if p["name"] != "myidp" || p["displayName"] != "SSO Test" {
		t.Fatalf("provider = %v", p)
	}
	if body["allowLocalLogin"] != false {
		t.Fatalf("allowLocalLogin = %v", body["allowLocalLogin"])
	}
}

func TestOAuthLoginErrors(t *testing.T) {
	database := newOAuthTestDB(t)

	status, body := doJSON(t, newOAuthRouter(database, config.OAuthConfig{}),
		http.MethodGet, "/auth/oauth/login", nil, "")
	if status != http.StatusBadRequest || body["error"] != "No OAuth providers are configured" {
		t.Fatalf("disabled: %d %v", status, body)
	}

	// Fresh router so the registry reloads and sees the DB provider.
	insertOAuthProvider(t, database, "myidp", "http://127.0.0.1:1", 1)
	status, body = doJSON(t, newOAuthRouter(database, config.OAuthConfig{}),
		http.MethodGet, "/auth/oauth/login?provider=nope", nil, "")
	if status != http.StatusBadRequest || body["error"] != "OAuth provider 'nope' is not configured" {
		t.Fatalf("unknown provider: %d %v", status, body)
	}
}

func TestOAuthLoginRedirectAndState(t *testing.T) {
	database := newOAuthTestDB(t)
	idp := newFakeIdP(t)
	insertOAuthProvider(t, database, "myidp", idp.srv.URL, 1)
	h := newOAuthRouter(database, config.OAuthConfig{})

	resp := doOAuthGet(t, h, "/auth/oauth/login?provider=myidp", map[string]string{
		"X-Forwarded-Proto": "https",
		"X-Forwarded-Host":  "docked.example.com",
	})
	if resp.StatusCode != http.StatusFound {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	loc := resp.Header.Get("Location")
	if !strings.HasPrefix(loc, idp.srv.URL+"/authorize?") {
		t.Fatalf("location = %q", loc)
	}
	u, _ := url.Parse(loc)
	p := u.Query()
	if p.Get("response_type") != "code" || p.Get("client_id") != oauthTestClientID {
		t.Fatalf("params = %v", p)
	}
	if p.Get("code_challenge_method") != "S256" || p.Get("code_challenge") == "" {
		t.Fatalf("pkce params = %v", p)
	}
	if p.Get("redirect_uri") != "https://docked.example.com/api/auth/oauth/callback" {
		t.Fatalf("redirect_uri = %q", p.Get("redirect_uri"))
	}
	if p.Get("scope") != "openid profile email" {
		t.Fatalf("scope = %q", p.Get("scope"))
	}

	var providerName, redirectURI string
	err := database.QueryRow("SELECT provider_name, redirect_uri FROM oauth_states WHERE state = ?", p.Get("state")).
		Scan(&providerName, &redirectURI)
	if err != nil {
		t.Fatalf("state row: %v", err)
	}
	if providerName != "myidp" || redirectURI != "https://docked.example.com/api/auth/oauth/callback" {
		t.Fatalf("state row = %q %q", providerName, redirectURI)
	}
}

func TestOAuthCallbackProviderErrorAndMissingParams(t *testing.T) {
	database := newOAuthTestDB(t)
	h := newOAuthRouter(database, config.OAuthConfig{})

	cases := []struct{ query, want string }{
		{"error=access_denied", "Sign-in was cancelled."},
		{"error=server_error", "Sign-in service is temporarily unavailable. Please try again later."},
		{"error=whatever", "Sign-in failed. Please try again or contact your administrator."},
		{"code=abc", "Missing authorization code or state parameter"},
		{"code=abc&state=missing", "Invalid or expired login session. Please try again."},
	}
	for _, c := range cases {
		resp := doOAuthGet(t, h, "/auth/oauth/callback?"+c.query, nil)
		if resp.StatusCode != http.StatusFound {
			t.Fatalf("%s: status = %d", c.query, resp.StatusCode)
		}
		loc, _ := url.Parse(resp.Header.Get("Location"))
		if loc.Path != "/auth/oauth/complete" {
			t.Fatalf("%s: path = %q", c.query, loc.Path)
		}
		if got := loc.Query().Get("error"); got != c.want {
			t.Fatalf("%s: error = %q, want %q", c.query, got, c.want)
		}
	}
}

func TestOAuthCallbackAutoRegisterFirstUser(t *testing.T) {
	database := newOAuthTestDB(t)
	idp := newFakeIdP(t)
	insertOAuthProvider(t, database, "myidp", idp.srv.URL, 1)
	h := newOAuthRouter(database, config.OAuthConfig{})

	state, nonce, _ := startFlow(t, h, database, "myidp")
	idp.nonce = nonce

	resp := doOAuthGet(t, h, "/auth/oauth/callback?code=thecode&state="+state, nil)
	if resp.StatusCode != http.StatusFound {
		t.Fatalf("status = %d", resp.StatusCode)
	}
	loc, _ := url.Parse(resp.Header.Get("Location"))
	if loc.Path != "/auth/oauth/complete" || loc.Query().Get("error") != "" {
		t.Fatalf("location = %q", resp.Header.Get("Location"))
	}

	cookies := map[string]*http.Cookie{}
	for _, c := range resp.Cookies() {
		cookies[c.Name] = c
	}
	for _, name := range []string{"authToken", "refreshToken", "username", "userRole", "instanceAdmin"} {
		if cookies[name] == nil {
			t.Fatalf("missing cookie %q", name)
		}
	}
	if cookies["username"].Value != "ssouser" || cookies["instanceAdmin"].Value != "true" {
		t.Fatalf("cookies = %q / %q", cookies["username"].Value, cookies["instanceAdmin"].Value)
	}
	if cookies["authToken"].HttpOnly || cookies["authToken"].MaxAge != 60 ||
		cookies["authToken"].SameSite != http.SameSiteLaxMode {
		t.Fatalf("cookie opts = %+v", cookies["authToken"])
	}

	// Token payload must match the docked scheme.
	claims := decodeJWTClaims(t, cookies["authToken"].Value)
	if claims["username"] != "ssouser" || claims["iss"] != "docked" {
		t.Fatalf("claims = %v", claims)
	}

	var (
		pwNull     sql.NullString
		provider   sql.NullString
		providerID sql.NullString
		admin      int
	)
	err := database.QueryRow(`SELECT password_hash, oauth_provider, oauth_provider_id, instance_admin
		FROM users WHERE username = 'ssouser'`).Scan(&pwNull, &provider, &providerID, &admin)
	if err != nil {
		t.Fatalf("user row: %v", err)
	}
	if pwNull.Valid {
		t.Fatalf("password_hash should be NULL, got %q", pwNull.String)
	}
	if provider.String != "myidp" || providerID.String != "oidc-sub-1" || admin != 1 {
		t.Fatalf("user row = %q %q %d", provider.String, providerID.String, admin)
	}

	// State must be single-use.
	resp2 := doOAuthGet(t, h, "/auth/oauth/callback?code=thecode&state="+state, nil)
	loc2, _ := url.Parse(resp2.Header.Get("Location"))
	if loc2.Query().Get("error") != "Invalid or expired login session. Please try again." {
		t.Fatalf("replay: %q", resp2.Header.Get("Location"))
	}

	// Token endpoint received the PKCE verifier + client credentials.
	if idp.lastTokenForm.Get("code_verifier") == "" ||
		idp.lastTokenForm.Get("client_id") != oauthTestClientID ||
		idp.lastTokenForm.Get("client_secret") != oauthTestClientSecret ||
		idp.lastTokenForm.Get("grant_type") != "authorization_code" {
		t.Fatalf("token form = %v", idp.lastTokenForm)
	}
}

func TestOAuthCallbackNonceMismatch(t *testing.T) {
	database := newOAuthTestDB(t)
	idp := newFakeIdP(t)
	insertOAuthProvider(t, database, "myidp", idp.srv.URL, 1)
	h := newOAuthRouter(database, config.OAuthConfig{})

	state, _, _ := startFlow(t, h, database, "myidp")
	idp.nonce = "totally-different-nonce"

	resp := doOAuthGet(t, h, "/auth/oauth/callback?code=thecode&state="+state, nil)
	loc, _ := url.Parse(resp.Header.Get("Location"))
	if got := loc.Query().Get("error"); got != "Sign-in verification failed. Please try again or contact your administrator." {
		t.Fatalf("error = %q", got)
	}
}

func TestOAuthCallbackTokenExchangeFailureMessage(t *testing.T) {
	database := newOAuthTestDB(t)
	idp := newFakeIdP(t)
	insertOAuthProvider(t, database, "myidp", idp.srv.URL, 1)
	h := newOAuthRouter(database, config.OAuthConfig{})

	state, _, _ := startFlow(t, h, database, "myidp")
	idp.tokenStatus = http.StatusBadRequest
	idp.tokenBody = map[string]any{"error": "invalid_grant", "error_description": "code expired"}

	resp := doOAuthGet(t, h, "/auth/oauth/callback?code=thecode&state="+state, nil)
	loc, _ := url.Parse(resp.Header.Get("Location"))
	if got := loc.Query().Get("error"); got != "Unable to complete sign-in. The sign-in service may be experiencing issues. Please try again." {
		t.Fatalf("error = %q", got)
	}
}

func TestOAuthCallbackAutoRegisterDisabled(t *testing.T) {
	database := newOAuthTestDB(t)
	idp := newFakeIdP(t)
	insertOAuthProvider(t, database, "myidp", idp.srv.URL, 0) // auto_register off
	h := newOAuthRouter(database, config.OAuthConfig{})

	state, nonce, _ := startFlow(t, h, database, "myidp")
	idp.nonce = nonce

	resp := doOAuthGet(t, h, "/auth/oauth/callback?code=thecode&state="+state, nil)
	loc, _ := url.Parse(resp.Header.Get("Location"))
	if got := loc.Query().Get("error"); got != "Authentication failed. Please try again or contact your administrator." {
		t.Fatalf("error = %q", got)
	}
	var count int
	if err := database.QueryRow("SELECT COUNT(*) FROM users").Scan(&count); err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 0 {
		t.Fatalf("users created: %d", count)
	}
}

func TestOAuthCallbackLinkRequiredThenLink(t *testing.T) {
	database := newOAuthTestDB(t)
	idp := newFakeIdP(t)
	insertOAuthProvider(t, database, "myidp", idp.srv.URL, 1)
	h := newOAuthRouter(database, config.OAuthConfig{})

	hash, err := auth.HashPassword("Str0ngPass!")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	if _, err := database.Exec(
		`INSERT INTO users (username, password_hash, email, role, password_changed, instance_admin)
		 VALUES ('localuser', ?, 'sso@example.com', 'Administrator', 1, 1)`, hash); err != nil {
		t.Fatalf("insert user: %v", err)
	}

	state, nonce, _ := startFlow(t, h, database, "myidp")
	idp.nonce = nonce

	resp := doOAuthGet(t, h, "/auth/oauth/callback?code=thecode&state="+state, nil)
	loc, _ := url.Parse(resp.Header.Get("Location"))
	q := loc.Query()
	if q.Get("linkRequired") != "true" || q.Get("linkToken") == "" || q.Get("username") != "localuser" {
		t.Fatalf("location = %q", resp.Header.Get("Location"))
	}
	linkToken := q.Get("linkToken")

	// Missing fields → 400.
	status, body := doJSON(t, h, http.MethodPost, "/auth/oauth/link", map[string]any{}, "")
	if status != http.StatusBadRequest || body["error"] != "Link token and password are required" {
		t.Fatalf("missing fields: %d %v", status, body)
	}
	// Invalid token → 400.
	status, body = doJSON(t, h, http.MethodPost, "/auth/oauth/link",
		map[string]any{"linkToken": "garbage", "password": "Str0ngPass!"}, "")
	if status != http.StatusBadRequest ||
		body["error"] != "Invalid linking session. Please try signing in with SSO again." {
		t.Fatalf("bad token: %d %v", status, body)
	}
	// Wrong password → 401.
	status, body = doJSON(t, h, http.MethodPost, "/auth/oauth/link",
		map[string]any{"linkToken": linkToken, "password": "wrong"}, "")
	if status != http.StatusUnauthorized || body["error"] != "Incorrect password" {
		t.Fatalf("wrong password: %d %v", status, body)
	}
	// Correct password → link + tokens.
	status, body = doJSON(t, h, http.MethodPost, "/auth/oauth/link",
		map[string]any{"linkToken": linkToken, "password": "Str0ngPass!"}, "")
	if status != http.StatusOK || body["success"] != true {
		t.Fatalf("link: %d %v", status, body)
	}
	if body["username"] != "localuser" || body["instanceAdmin"] != true {
		t.Fatalf("link body = %v", body)
	}
	token, _ := body["token"].(string)
	claims := decodeJWTClaims(t, token)
	if claims["username"] != "localuser" {
		t.Fatalf("token claims = %v", claims)
	}

	var provider sql.NullString
	if err := database.QueryRow("SELECT oauth_provider FROM users WHERE username = 'localuser'").Scan(&provider); err != nil {
		t.Fatalf("user row: %v", err)
	}
	if provider.String != "myidp" {
		t.Fatalf("provider = %q", provider.String)
	}

	// Reusing the link token after success still works (Node has no replay
	// guard either) but a second callback for the same identity resolves the
	// linked account directly.
	state2, nonce2, _ := startFlow(t, h, database, "myidp")
	idp.nonce = nonce2
	resp2 := doOAuthGet(t, h, "/auth/oauth/callback?code=thecode&state="+state2, nil)
	loc2, _ := url.Parse(resp2.Header.Get("Location"))
	if loc2.Query().Get("linkRequired") != "" || loc2.Query().Get("error") != "" {
		t.Fatalf("second callback = %q", resp2.Header.Get("Location"))
	}
}

func TestOAuthCallbackEmailLinkedToOtherProviderRejected(t *testing.T) {
	database := newOAuthTestDB(t)
	idp := newFakeIdP(t)
	insertOAuthProvider(t, database, "myidp", idp.srv.URL, 1)
	h := newOAuthRouter(database, config.OAuthConfig{})

	if _, err := database.Exec(
		`INSERT INTO users (username, email, role, oauth_provider, oauth_provider_id)
		 VALUES ('otheruser', 'sso@example.com', 'Member', 'otheridp', 'x')`); err != nil {
		t.Fatalf("insert user: %v", err)
	}

	state, nonce, _ := startFlow(t, h, database, "myidp")
	idp.nonce = nonce

	resp := doOAuthGet(t, h, "/auth/oauth/callback?code=thecode&state="+state, nil)
	loc, _ := url.Parse(resp.Header.Get("Location"))
	if got := loc.Query().Get("error"); got != "Authentication failed. Please try again or contact your administrator." {
		t.Fatalf("error = %q", got)
	}
}

func TestOAuthLinkExpiredToken(t *testing.T) {
	database := newOAuthTestDB(t)
	h := newOAuthRouter(database, config.OAuthConfig{})

	// Mint an already-expired link token.
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"purpose": "oauth_link", "iss": "docked", "aud": "docked-oauth-link",
		"iat": time.Now().Add(-time.Hour).Unix(), "exp": time.Now().Add(-time.Minute).Unix(),
	})
	raw, err := tok.SignedString([]byte(authTestSecret))
	if err != nil {
		t.Fatalf("sign expired: %v", err)
	}

	status, body := doJSON(t, h, http.MethodPost, "/auth/oauth/link",
		map[string]any{"linkToken": raw, "password": "x"}, "")
	if status != http.StatusBadRequest ||
		body["error"] != "This linking session has expired. Please try signing in with SSO again." {
		t.Fatalf("expired: %d %v", status, body)
	}
}

// decodeJWTClaims parses a docked access token without signature checks
// (payload inspection only).
func decodeJWTClaims(t *testing.T, raw string) jwt.MapClaims {
	t.Helper()
	parser := jwt.NewParser(jwt.WithoutClaimsValidation())
	tok, _, err := parser.ParseUnverified(raw, jwt.MapClaims{})
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	return tok.Claims.(jwt.MapClaims)
}
