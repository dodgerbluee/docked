package auth

import (
	"context"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

// UserIDFromContext extracts the authenticated user ID from context.
// Returns 0 if not authenticated.
func UserIDFromContext(ctx context.Context) int64 {
	id, _ := UserID(ctx)
	return id
}

// HashPassword hashes a plaintext password using bcrypt.
func HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(bytes), err
}

// CheckPassword compares a bcrypt hash with a plaintext password.
func CheckPassword(hash, password string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

// TokenClaims holds the claims we embed in access/refresh tokens.
type TokenClaims struct {
	UserID   int64  `json:"userId"`
	Username string `json:"username"`
	Role     string `json:"role"`
	jwt.RegisteredClaims
}

// RefreshClaims holds claims for refresh tokens.
type RefreshClaims struct {
	UserID int64 `json:"userId"`
	jwt.RegisteredClaims
}

// GenerateTokens creates an access token and a refresh token for the user.
func GenerateTokens(userID int64, username, role string) (accessToken, refreshToken string, err error) {
	secret := getSecret()

	now := time.Now()
	accessClaims := TokenClaims{
		UserID:   userID,
		Username: username,
		Role:     role,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "docked",
			Audience:  jwt.ClaimStrings{"docked-users"},
			ExpiresAt: jwt.NewNumericDate(now.Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}
	accessToken, err = jwt.NewWithClaims(jwt.SigningMethodHS256, accessClaims).SignedString([]byte(secret))
	if err != nil {
		return "", "", fmt.Errorf("sign access token: %w", err)
	}

	refreshClaims := RefreshClaims{
		UserID: userID,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "docked",
			Audience:  jwt.ClaimStrings{"docked-refresh"},
			ExpiresAt: jwt.NewNumericDate(now.Add(7 * 24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}
	refreshToken, err = jwt.NewWithClaims(jwt.SigningMethodHS256, refreshClaims).SignedString([]byte(secret))
	if err != nil {
		return "", "", fmt.Errorf("sign refresh token: %w", err)
	}

	return accessToken, refreshToken, nil
}

// VerifyRefreshToken validates a refresh token and returns its claims.
func VerifyRefreshToken(tokenString string) (*RefreshClaims, error) {
	secret := getSecret()

	parser := jwt.NewParser(
		jwt.WithIssuer("docked"),
		jwt.WithValidMethods([]string{"HS256"}),
	)

	token, err := parser.ParseWithClaims(tokenString, &RefreshClaims{}, func(_ *jwt.Token) (any, error) {
		return []byte(secret), nil
	})
	if err != nil {
		return nil, fmt.Errorf("parse refresh token: %w", err)
	}

	claims, ok := token.Claims.(*RefreshClaims)
	if !ok || !token.Valid {
		return nil, fmt.Errorf("invalid refresh token")
	}
	return claims, nil
}

// getSecret reads the JWT secret from the environment.
// In production this is set via JWT_SECRET env var.
func getSecret() string {
	s := jwtSecret
	if s == "" {
		return "change-this-secret-in-production-use-strong-random-string"
	}
	return s
}

// jwtSecret is set at startup by the server initialization.
var jwtSecret string

// SetSecret configures the JWT signing secret at application startup.
func SetSecret(secret string) {
	jwtSecret = secret
}
