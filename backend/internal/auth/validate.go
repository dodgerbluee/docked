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
	UserID   int64  `json:"userId"`
	Username string `json:"username"`
	Role     string `json:"role"`
	jwt.RegisteredClaims
}

// ValidateToken parses and validates a JWT access token, returning the user ID.
func ValidateToken(tokenString, secret string) (int64, error) {
	parser := jwt.NewParser(
		jwt.WithIssuer("docked"),
		jwt.WithAudience("docked-users"),
		jwt.WithExpirationRequired(),
		jwt.WithValidMethods([]string{"HS256"}),
	)

	claims := &accessClaims{}
	_, err := parser.ParseWithClaims(tokenString, claims, func(_ *jwt.Token) (any, error) {
		return []byte(secret), nil
	})
	if err != nil {
		return 0, fmt.Errorf("invalid token: %w", err)
	}
	if claims.UserID == 0 {
		return 0, fmt.Errorf("token missing userId claim")
	}
	return claims.UserID, nil
}

// ContextWithUserID returns a context carrying the user ID using the same
// key that the auth middleware uses, so UserIDFromContext works uniformly.
func ContextWithUserID(ctx context.Context, userID int64) context.Context {
	return context.WithValue(ctx, contextKey{}, userID)
}
