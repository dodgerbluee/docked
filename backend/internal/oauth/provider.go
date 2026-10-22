package oauth

// OIDC provider ported from Node's services/oauth/providers/BaseProvider.js
// (+ the Authentik/GenericOIDC normalizers). Same flow: discovery (1h cache),
// authorization URL with PKCE/state/nonce, code exchange, ID-token validation
// against the provider JWKS, userinfo fetch, and claim normalization.

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/golang-jwt/jwt/v5"
)

// DiscoveryDoc is the subset of the OpenID configuration document the flow
// uses. Required fields mirror Node's validation list.
type DiscoveryDoc struct {
	Issuer                string `json:"issuer"`
	AuthorizationEndpoint string `json:"authorization_endpoint"`
	TokenEndpoint         string `json:"token_endpoint"`
	JWKSURI               string `json:"jwks_uri"`
	UserinfoEndpoint      string `json:"userinfo_endpoint"`
}

// TokenResponse is the provider's token-endpoint payload.
type TokenResponse struct {
	AccessToken  string `json:"access_token"`
	IDToken      string `json:"id_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int64  `json:"expires_in"`
}

// NormalizedUser is the standard shape both providers normalize into.
type NormalizedUser struct {
	ID          string
	Username    string
	Email       string // "" means absent (Node uses null)
	DisplayName string
	Groups      []string
	// EmailVerified is the provider's email_verified claim: nil when the
	// claim is absent (provider silent — treated as unverified-but-allowed,
	// matching Node), otherwise the explicit verdict. A false here must
	// never drive account matching (SSO takeover guard).
	EmailVerified *bool
}

// Provider is a configured OIDC provider with a cached discovery document.
type Provider struct {
	Name         string
	DisplayName  string
	ProviderType string // "authentik" | "generic_oidc"
	ClientID     string
	ClientSecret string
	IssuerURL    string
	Scopes       []string

	mu        sync.Mutex
	discovery *DiscoveryDoc
	fetchedAt time.Time
	keySet    oidc.KeySet
}

// NewProvider builds a provider; empty displayName falls back the way the
// JS subclasses do (authentik → "Authentik", generic_oidc → "SSO", else name).
func NewProvider(providerType, name, displayName, clientID, clientSecret, issuerURL string, scopes []string) *Provider {
	if len(scopes) == 0 {
		scopes = []string{"openid", "profile", "email"}
	}
	if displayName == "" {
		switch providerType {
		case "authentik":
			displayName = "Authentik"
		case "generic_oidc":
			displayName = "SSO"
		default:
			displayName = name
		}
	}
	return &Provider{
		Name: name, DisplayName: displayName, ProviderType: providerType,
		ClientID: clientID, ClientSecret: clientSecret, IssuerURL: issuerURL, Scopes: scopes,
	}
}

// Discover fetches (and caches for 1 hour) the provider's OIDC discovery
// document, wiring up the remote JWKS key set for ID-token validation.
func (p *Provider) Discover(ctx context.Context) (*DiscoveryDoc, error) {
	p.mu.Lock()
	defer p.mu.Unlock()

	if p.discovery != nil && time.Since(p.fetchedAt) < time.Hour {
		return p.discovery, nil
	}

	discoveryURL := buildDiscoveryURL(p.IssuerURL)
	var doc *DiscoveryDoc
	err := retry(ctx, 2, func() error {
		reqCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, discoveryURL, nil)
		if err != nil {
			return err
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return err
		}
		defer resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return fmt.Errorf("unexpected status %d fetching discovery document", resp.StatusCode)
		}
		body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		if err != nil {
			return err
		}
		var d DiscoveryDoc
		if err := json.Unmarshal(body, &d); err != nil {
			return fmt.Errorf("invalid discovery document: %w", err)
		}
		for _, f := range []struct{ name, val string }{
			{"authorization_endpoint", d.AuthorizationEndpoint},
			{"token_endpoint", d.TokenEndpoint},
			{"issuer", d.Issuer},
		} {
			if f.val == "" {
				return fmt.Errorf("Discovery document missing required field: %s", f.name)
			}
		}
		doc = &d
		return nil
	})
	if err != nil {
		slog.Error("Failed to fetch OIDC discovery", "url", discoveryURL, "error", err.Error())
		return nil, fmt.Errorf("SSO provider unavailable: %w", err)
	}

	if doc.JWKSURI != "" {
		p.keySet = oidc.NewRemoteKeySet(ctx, doc.JWKSURI)
	} else {
		p.keySet = nil
	}
	p.discovery = doc
	p.fetchedAt = time.Now()
	return doc, nil
}

func buildDiscoveryURL(issuerURL string) string {
	u := strings.TrimRight(issuerURL, "/")
	if strings.HasSuffix(u, "/.well-known/openid-configuration") {
		return u
	}
	return u + "/.well-known/openid-configuration"
}

// GeneratePKCE returns a code verifier (43-char base64url of 32 random bytes)
// and its S256 challenge.
func GeneratePKCE() (codeVerifier, codeChallenge string, err error) {
	buf := make([]byte, 32)
	if _, err = rand.Read(buf); err != nil {
		return "", "", err
	}
	codeVerifier = base64.RawURLEncoding.EncodeToString(buf)
	sum := sha256.Sum256([]byte(codeVerifier))
	return codeVerifier, base64.RawURLEncoding.EncodeToString(sum[:]), nil
}

// GenerateHexRandom backs both the CSRF state and the OIDC nonce (32 random
// bytes, hex encoded).
func GenerateHexRandom() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}

// AuthorizationURL builds the provider authorize URL (response_type=code,
// PKCE S256, state, nonce, joined scopes).
func (p *Provider) AuthorizationURL(ctx context.Context, state, codeChallenge, nonce, redirectURI string) (string, error) {
	discovery, err := p.Discover(ctx)
	if err != nil {
		return "", err
	}
	params := url.Values{}
	params.Set("response_type", "code")
	params.Set("client_id", p.ClientID)
	params.Set("redirect_uri", redirectURI)
	params.Set("scope", strings.Join(p.Scopes, " "))
	params.Set("state", state)
	params.Set("nonce", nonce)
	params.Set("code_challenge", codeChallenge)
	params.Set("code_challenge_method", "S256")
	return discovery.AuthorizationEndpoint + "?" + params.Encode(), nil
}

// ExchangeCode swaps the authorization code for tokens (client-secret post +
// PKCE verifier, matching Node's form encoding).
func (p *Provider) ExchangeCode(ctx context.Context, code, codeVerifier, redirectURI string) (*TokenResponse, error) {
	discovery, err := p.Discover(ctx)
	if err != nil {
		return nil, err
	}

	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", redirectURI)
	form.Set("client_id", p.ClientID)
	form.Set("client_secret", p.ClientSecret)
	form.Set("code_verifier", codeVerifier)

	var tok TokenResponse
	var detail string
	err = retry(ctx, 2, func() error {
		reqCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		defer cancel()
		req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, discovery.TokenEndpoint, strings.NewReader(form.Encode()))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return err
		}
		defer resp.Body.Close()
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			var e struct {
				Error            string `json:"error"`
				ErrorDescription string `json:"error_description"`
			}
			_ = json.Unmarshal(body, &e)
			detail = e.ErrorDescription
			if detail == "" {
				detail = e.Error
			}
			if detail == "" {
				detail = fmt.Sprintf("unexpected status %d", resp.StatusCode)
			}
			return errors.New(detail)
		}
		return json.Unmarshal(body, &tok)
	})
	if err != nil {
		if detail == "" {
			detail = err.Error()
		}
		slog.Error("OAuth code exchange failed", "error", detail)
		return nil, fmt.Errorf("Token exchange failed: %s", detail)
	}
	return &tok, nil
}

// ValidateIDToken verifies signature (remote JWKS), issuer, audience, expiry,
// and the stored nonce. Error strings match Node's ("ID token validation
// failed: ..." wrapper) because the callback maps on these substrings.
func (p *Provider) ValidateIDToken(ctx context.Context, rawIDToken, nonce string) (jwt.MapClaims, error) {
	discovery, err := p.Discover(ctx)
	if err != nil {
		return nil, err
	}
	if p.keySet == nil {
		return nil, errors.New("ID token validation failed: JWKS not available - discovery may have failed")
	}

	verifier := oidc.NewVerifier(discovery.Issuer, p.keySet, &oidc.Config{ClientID: p.ClientID})
	idToken, err := verifier.Verify(ctx, rawIDToken)
	if err != nil {
		slog.Error("ID token validation failed", "error", err.Error())
		return nil, fmt.Errorf("ID token validation failed: %w", err)
	}
	if idToken.Nonce != nonce {
		slog.Error("ID token validation failed", "error", "ID token nonce mismatch")
		return nil, errors.New("ID token validation failed: ID token nonce mismatch")
	}

	var claims jwt.MapClaims
	if err := idToken.Claims(&claims); err != nil {
		return nil, fmt.Errorf("ID token validation failed: %w", err)
	}
	return claims, nil
}

// GetUserInfo fetches the userinfo endpoint payload; failures are non-fatal
// (the ID token claims remain usable), matching Node.
func (p *Provider) GetUserInfo(ctx context.Context, accessToken string) map[string]any {
	discovery, err := p.Discover(ctx)
	if err != nil {
		return map[string]any{}
	}
	if discovery.UserinfoEndpoint == "" {
		return map[string]any{}
	}
	var info map[string]any
	err = retry(ctx, 2, func() error {
		reqCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		defer cancel()
		req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, discovery.UserinfoEndpoint, nil)
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", "Bearer "+accessToken)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			return err
		}
		defer resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return fmt.Errorf("unexpected status %d", resp.StatusCode)
		}
		body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
		if err != nil {
			return err
		}
		return json.Unmarshal(body, &info)
	})
	if err != nil {
		slog.Warn("Failed to fetch user info", "error", err.Error())
		return map[string]any{}
	}
	if info == nil {
		return map[string]any{}
	}
	return info
}

// NormalizeUserInfo merges userinfo over ID-token claims (userinfo wins, like
// the JS spread) and maps to the standard shape. The only behavioral
// difference between the two provider classes is the fallback username
// prefix and the missing-sub error wording.
func (p *Provider) NormalizeUserInfo(userInfo map[string]any, idTokenClaims jwt.MapClaims) (*NormalizedUser, error) {
	merged := map[string]any{}
	for k, v := range idTokenClaims {
		merged[k] = v
	}
	for k, v := range userInfo {
		merged[k] = v
	}

	id := claimString(merged["sub"])
	if id == "" {
		if p.ProviderType == "authentik" {
			return nil, errors.New("Authentik response missing 'sub' claim")
		}
		return nil, errors.New("OIDC response missing 'sub' claim")
	}

	username := claimString(merged["preferred_username"])
	email := claimString(merged["email"])
	if username == "" && email != "" {
		username = strings.SplitN(email, "@", 2)[0]
	}
	if username == "" {
		prefix := "oidc_"
		if p.ProviderType == "authentik" {
			prefix = "authentik_"
		}
		r := []rune(id)
		if len(r) > 8 {
			r = r[:8]
		}
		username = prefix + string(r)
	}

	var groups []string
	if g, ok := merged["groups"].([]any); ok {
		for _, item := range g {
			groups = append(groups, fmt.Sprint(item))
		}
	}

	var emailVerified *bool
	switch v := merged["email_verified"].(type) {
	case bool:
		emailVerified = &v
	case string:
		if v == "true" {
			t := true
			emailVerified = &t
		} else if v == "false" {
			f := false
			emailVerified = &f
		}
	}

	return &NormalizedUser{
		ID:            id,
		Username:      sanitizeUsername(username),
		Email:         email,
		DisplayName:   claimString(merged["name"]),
		Groups:        groups,
		EmailVerified: emailVerified,
	}, nil
}

// claimString renders a JSON claim as its string form when it is a string;
// non-string claims (objects, numbers) are treated as absent for these
// text fields, matching how the JS code only ever sees provider strings.
func claimString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

// sanitizeUsername strips characters that could cause issues and enforces a
// minimum length of 3 (exact port of the JS helper).
func sanitizeUsername(raw string) string {
	var b strings.Builder
	for _, r := range raw {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') ||
			r == '_' || r == '.' || r == '-' {
			b.WriteRune(r)
		} else {
			b.WriteRune('_')
		}
	}
	s := b.String()
	for strings.Contains(s, "__") {
		s = strings.ReplaceAll(s, "__", "_")
	}
	s = strings.Trim(s, "_")
	if len(s) < 3 {
		s = s + strings.Repeat("_", 3-len(s))
	}
	return s
}

// retry runs fn up to maxRetries+1 times with exponential backoff
// (baseDelay 1s, factor 2), mirroring Node's utils/retry.
func retry(ctx context.Context, maxRetries int, fn func() error) error {
	var last error
	for attempt := 0; attempt <= maxRetries; attempt++ {
		if err := fn(); err != nil {
			last = err
			if attempt < maxRetries {
				delay := time.Duration(1000*(1<<attempt)) * time.Millisecond
				select {
				case <-time.After(delay):
				case <-ctx.Done():
					return ctx.Err()
				}
			}
			continue
		}
		return nil
	}
	return last
}
