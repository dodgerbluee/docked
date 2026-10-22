package auth

import (
	"context"
	"fmt"

	"github.com/golang-jwt/jwt/v5"
)

// accessClaims mirrors the JWT payload the Node backend issues.
// Using a concrete struct avoids MapClaims' custom aud decoder which
// chokes on string-valued aud (Node writes "aud":"docked-users", not an array).
type accessClaims struct {
	UserID       int64  `json:"userId"`
	Username     string `json:"username"`
	Role         string `json:"role"`
	TokenVersion int64  `json:"tokenVersion"`
	jwt.RegisteredClaims
}

// ValidateToken parses and validates a JWT access token, returning the user ID.
func ValidateToken(tokenString, secret string) (int64, error) {
	userID, _, _, err := ValidateTokenWithVersion(tokenString, secret)
	return userID, err
}

// ValidateTokenClaims parses and validates a JWT access token, returning the
// user ID and the exp claim (unix seconds). Logout needs the expiry to size
// the revocation row so it can be pruned once the token would have died anyway.
func ValidateTokenClaims(tokenString, secret string) (int64, int64, error) {
	userID, _, exp, err := ValidateTokenWithVersion(tokenString, secret)
	return userID, exp, err
}

// ValidateTokenWithVersion parses and validates a JWT access token and
// returns the user ID, the tokenVersion claim, and the exp claim (unix
// seconds). Auth layers that already load the user row compare the version
// against users.token_version to enforce password-change session eviction;
// tokens minted before versioning carry no claim and read as version 0.
func ValidateTokenWithVersion(tokenString, secret string) (userID, tokenVersion, exp int64, err error) {
	parser := jwt.NewParser(
		jwt.WithIssuer("docked"),
		jwt.WithAudience("docked-users"),
		jwt.WithExpirationRequired(),
		jwt.WithValidMethods([]string{"HS256"}),
	)

	claims := &accessClaims{}
	_, err = parser.ParseWithClaims(tokenString, claims, func(_ *jwt.Token) (any, error) {
		return []byte(secret), nil
	})
	if err != nil {
		return 0, 0, 0, fmt.Errorf("invalid token: %w", err)
	}
	if claims.UserID == 0 {
		return 0, 0, 0, fmt.Errorf("token missing userId claim")
	}
	if claims.ExpiresAt != nil {
		exp = claims.ExpiresAt.Unix()
	}
	return claims.UserID, claims.TokenVersion, exp, nil
}

// ContextWithUserID returns a context carrying the user ID using the same
// key that the auth middleware uses, so UserIDFromContext works uniformly.
func ContextWithUserID(ctx context.Context, userID int64) context.Context {
	return context.WithValue(ctx, contextKey{}, userID)
}

type rawTokenKey struct{}

// ContextWithRawToken stashes the verified bearer token so the logout resolver
// can revoke exactly the token the caller presented.
func ContextWithRawToken(ctx context.Context, raw string) context.Context {
	return context.WithValue(ctx, rawTokenKey{}, raw)
}

// RawTokenFromContext returns the bearer token stored by the auth middleware,
// or "" when the request was unauthenticated.
func RawTokenFromContext(ctx context.Context) string {
	raw, _ := ctx.Value(rawTokenKey{}).(string)
	return raw
}
