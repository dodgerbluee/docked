package graph

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/dockedapp/backend/graph/model"
	"github.com/dockedapp/backend/internal/db"
)

// Helpers for the SSO admin resolvers (parity with Node's ssoAdminController).

var ssoSlugRe = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]*$`)

func isValidSSOSlug(name string) bool {
	return ssoSlugRe.MatchString(name) && len(name) >= 2 && len(name) <= 50
}

func maskSSOSecret(secret string) string {
	if len(secret) <= 4 {
		return "****"
	}
	return "****" + secret[len(secret)-4:]
}

func validSSOProviderType(t string) bool {
	return t == "authentik" || t == "generic_oidc"
}

func ssoProviderToModel(r *db.OAuthProviderRow) *model.SSOProvider {
	return &model.SSOProvider{
		ID:           strconv.FormatInt(r.ID, 10),
		Name:         r.Name,
		DisplayName:  r.DisplayName,
		ProviderType: r.ProviderType,
		ClientID:     r.ClientID,
		ClientSecret: maskSSOSecret(r.ClientSecret),
		IssuerURL:    r.IssuerURL,
		Scopes:       r.Scopes,
		AutoRegister: r.AutoRegister == 1,
		DefaultRole:  r.DefaultRole,
		Enabled:      r.Enabled == 1,
		CreatedAt:    parseTime(r.CreatedAt),
		UpdatedAt:    parseTime(r.UpdatedAt),
	}
}

// fetchOIDCDiscovery performs the .well-known/openid-configuration lookup used
// by testSSOProvider. Returns valid=false with an explanatory error instead of
// a Go error for expected failures (bad URL, HTTP errors, missing fields).
func fetchOIDCDiscovery(ctx context.Context, issuerURL string) (*model.SSOProviderTestResult, error) {
	parsed, err := url.Parse(issuerURL)
	if err != nil || parsed.Scheme == "" {
		return &model.SSOProviderTestResult{Valid: false, Error: strPtr("issuerUrl is not a valid URL")}, nil
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return &model.SSOProviderTestResult{Valid: false, Error: strPtr("issuerUrl must use http or https")}, nil
	}

	discoveryURL := parsed.JoinPath(".well-known/openid-configuration").String()

	reqCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, discoveryURL, nil)
	if err != nil {
		return &model.SSOProviderTestResult{Valid: false, Error: strPtr("issuerUrl is not a valid URL")}, nil
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return &model.SSOProviderTestResult{
			Valid: false,
			Error: strPtr(fmt.Sprintf("Failed to fetch discovery document: %s", err.Error())),
		}, nil
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return &model.SSOProviderTestResult{
			Valid: false,
			Error: strPtr(fmt.Sprintf("Failed to fetch discovery document: HTTP %d", resp.StatusCode)),
		}, nil
	}

	var doc map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&doc); err != nil {
		return &model.SSOProviderTestResult{
			Valid: false,
			Error: strPtr("Failed to fetch discovery document: invalid JSON"),
		}, nil
	}

	str := func(key string) *string {
		if v, ok := doc[key].(string); ok && v != "" {
			return &v
		}
		return nil
	}
	issuer := str("issuer")
	authz := str("authorization_endpoint")
	token := str("token_endpoint")
	userinfo := str("userinfo_endpoint")
	jwks := str("jwks_uri")

	var missing []string
	for _, f := range []struct {
		name string
		v    *string
	}{{"authorization_endpoint", authz}, {"token_endpoint", token}, {"issuer", issuer}} {
		if f.v == nil {
			missing = append(missing, f.name)
		}
	}
	if len(missing) > 0 {
		return &model.SSOProviderTestResult{
			Valid: false,
			Error: strPtr("Discovery document missing fields: " + strings.Join(missing, ", ")),
			Discovery: &model.OIDCDiscovery{
				Issuer:    issuer,
				Endpoints: &model.OIDCDiscoveryEndpoints{Authorization: authz, Token: token, Userinfo: userinfo},
			},
		}, nil
	}

	var scopes []string
	if list, ok := doc["scopes_supported"].([]any); ok {
		for _, v := range list {
			if s, ok := v.(string); ok {
				scopes = append(scopes, s)
			}
		}
	}
	return &model.SSOProviderTestResult{
		Valid: true,
		Discovery: &model.OIDCDiscovery{
			Issuer: issuer,
			Endpoints: &model.OIDCDiscoveryEndpoints{
				Authorization: authz, Token: token, Userinfo: userinfo, Jwks: jwks,
			},
			ScopesSupported: scopes,
		},
	}, nil
}
