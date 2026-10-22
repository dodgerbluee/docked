package auth

import (
	"context"
	"fmt"
	"os"
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
// bcrypt only consumes the first 72 bytes of the input; Node's bcrypt truncates
// silently, so we do the same rather than erroring on longer passwords that
// existing hashes were created from.
func HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword(truncateBcrypt([]byte(password)), bcrypt.DefaultCost)
	return string(bytes), err
}

// CheckPassword compares a bcrypt hash with a plaintext password.
func CheckPassword(hash, password string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), truncateBcrypt([]byte(password)))
	return err == nil
}

func truncateBcrypt(b []byte) []byte {
	if len(b) > 72 {
		return b[:72]
	}
	return b
}

// TokenClaims holds the claims we embed in access/refresh tokens.
type TokenClaims struct {
	UserID   int64  `json:"userId"`
	Username string `json:"username"`
	Role     string `json:"role"`
	// TokenVersion mirrors users.token_version at mint time. The auth
	// layers reject tokens whose version lags the user row, so a password
	// change evicts every session (access AND refresh) immediately.
	// Tokens minted before the column existed carry no claim (0), which
	// matches every pre-existing row's default version (0).
	TokenVersion int64 `json:"tokenVersion,omitempty"`
	jwt.RegisteredClaims
}

// RefreshClaims holds claims for refresh tokens.
type RefreshClaims struct {
	UserID       int64 `json:"userId"`
	TokenVersion int64 `json:"tokenVersion,omitempty"`
	jwt.RegisteredClaims
}

// GenerateTokens creates an access token and a refresh token for the user.
// tokenVersion must be the user row's current token_version so that a later
// password change (which bumps the column) invalidates both tokens.
func GenerateTokens(userID int64, username, role string, tokenVersion int64) (accessToken, refreshToken string, err error) {
	secret := getSecret()

	now := time.Now()
	accessClaims := TokenClaims{
		UserID:       userID,
		Username:     username,
		Role:         role,
		TokenVersion: tokenVersion,
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
		UserID:       userID,
		TokenVersion: tokenVersion,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer: "docked",
			// Node signs refresh tokens with the SAME audience as access
			// tokens ("docked-users") but a DIFFERENT secret. Matching that
			// keeps Go- and Node-issued tokens interchangeable across the two
			// backends while the distinct signing secret is what prevents a
			// refresh token from being replayed as an access token (and vice
			// versa).
			Audience:  jwt.ClaimStrings{"docked-users"},
			ExpiresAt: jwt.NewNumericDate(now.Add(7 * 24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(now),
		},
	}
	refreshToken, err = jwt.NewWithClaims(jwt.SigningMethodHS256, refreshClaims).SignedString([]byte(getRefreshSecret()))
	if err != nil {
		return "", "", fmt.Errorf("sign refresh token: %w", err)
	}

	return accessToken, refreshToken, nil
}

// VerifyRefreshToken validates a refresh token and returns its claims.
// It uses the refresh secret (distinct from the access secret) and enforces
// the shared "docked-users" audience plus a required expiry, so an access
// token cannot be accepted here and an expired token is always rejected.
func VerifyRefreshToken(tokenString string) (*RefreshClaims, error) {
	parser := jwt.NewParser(
		jwt.WithIssuer("docked"),
		jwt.WithAudience("docked-users"),
		jwt.WithExpirationRequired(),
		jwt.WithValidMethods([]string{"HS256"}),
	)

	token, err := parser.ParseWithClaims(tokenString, &RefreshClaims{}, func(_ *jwt.Token) (any, error) {
		return []byte(getRefreshSecret()), nil
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

// getSecret returns the secret installed by SetSecret at startup. The old
// public fallback string is gone: config.Load always yields a real secret
// (env var or generated+persisted), so reaching this empty means a wiring
// bug, and silently signing with a known key is exactly the failure we are
// eliminating.
func getSecret() string {
	if jwtSecret == "" {
		panic("auth: JWT secret not configured — call auth.SetSecret at startup")
	}
	return jwtSecret
}

// getRefreshSecret mirrors the Node backend's refresh-secret derivation:
// JWT_REFRESH_SECRET if set, otherwise the access secret with a "-refresh"
// suffix. Keeping this identical is what lets tokens minted by either backend
// verify on the other.
func getRefreshSecret() string {
	if s := os.Getenv("JWT_REFRESH_SECRET"); s != "" {
		return s
	}
	return getSecret() + "-refresh"
}

// jwtSecret is set at startup by the server initialization.
var jwtSecret string

// SetSecret configures the JWT signing secret at application startup.
func SetSecret(secret string) {
	jwtSecret = secret
}
