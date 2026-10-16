package auth

import (
	"os"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// TestTokenAudienceExpiryAndSeparation guards the token security boundary:
//   - access and refresh tokens are signed with DIFFERENT secrets, so neither
//     can be replayed as the other (the class the old code allowed by signing
//     both with one secret and checking neither audience nor expiry);
//   - ValidateToken enforces the "docked-users" audience and a required expiry;
//   - VerifyRefreshToken uses the refresh secret and the same audience/expiry.
//
// TestBcryptTruncatesTo72Bytes matches Node's bcrypt behavior: inputs longer
// than 72 bytes are silently truncated rather than rejected, so passwords that
// existing hashes were created from keep working in Go.
func TestBcryptTruncatesTo72Bytes(t *testing.T) {
	long := "x" + strings.Repeat("y", 100) // 101 bytes, well past the 72-byte cap

	hash, err := HashPassword(long)
	if err != nil {
		t.Fatalf("HashPassword(>72 bytes): %v", err)
	}
	if !CheckPassword(hash, long) {
		t.Fatal("CheckPassword must accept the same long password")
	}
	// Truncation semantics: only the first 72 bytes matter, so a password that
	// differs only past byte 72 verifies against the same hash (this is exactly
	// what Node's bcrypt does).
	samePrefix := long[:72] + "different-tail"
	if !CheckPassword(hash, samePrefix) {
		t.Fatal("password differing past byte 72 must match (bcrypt truncation parity)")
	}
	// And a password differing within the first 72 bytes must not.
	if CheckPassword(hash, "z"+long[1:72]) {
		t.Fatal("password differing within first 72 bytes must not match")
	}
}

func TestTokenAudienceExpiryAndSeparation(t *testing.T) {
	const secret = "unit-secret"
	SetSecret(secret)
	// Pin the refresh secret so the derivation is deterministic regardless of
	// the ambient environment.
	t.Setenv("JWT_REFRESH_SECRET", secret+"-refresh")

	access, refresh, err := GenerateTokens(42, "alice", "Member")
	if err != nil {
		t.Fatalf("GenerateTokens: %v", err)
	}

	// Access validates on the access path.
	if uid, err := ValidateToken(access, secret); err != nil || uid != 42 {
		t.Fatalf("ValidateToken(access) = (%d, %v), want (42, nil)", uid, err)
	}
	// A refresh token must NOT be accepted as an access token.
	if _, err := ValidateToken(refresh, secret); err == nil {
		t.Fatal("refresh token was accepted as an access token")
	}
	// Refresh validates on the refresh path.
	if c, err := VerifyRefreshToken(refresh); err != nil || c.UserID != 42 {
		t.Fatalf("VerifyRefreshToken(refresh) = (%v, %v), want uid 42", c, err)
	}
	// An access token must NOT be accepted as a refresh token.
	if _, err := VerifyRefreshToken(access); err == nil {
		t.Fatal("access token was accepted as a refresh token")
	}
}

// TestValidateTokenRejectsMissingClaims asserts the parser rejects tokens that
// omit the audience or expiry, even when correctly signed and issued.
func TestValidateTokenRejectsMissingClaims(t *testing.T) {
	const secret = "unit-secret"
	SetSecret(secret)
	os.Unsetenv("JWT_REFRESH_SECRET")

	// No audience claim.
	noAud := jwt.NewWithClaims(jwt.SigningMethodHS256, TokenClaims{
		UserID: 7,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "docked",
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	})
	tok, err := noAud.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if _, err := ValidateToken(tok, secret); err == nil {
		t.Fatal("token without audience was accepted")
	}

	// No expiry claim.
	noExp := jwt.NewWithClaims(jwt.SigningMethodHS256, TokenClaims{
		UserID: 7,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:   "docked",
			Audience: jwt.ClaimStrings{"docked-users"},
		},
	})
	tok, err = noExp.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if _, err := ValidateToken(tok, secret); err == nil {
		t.Fatal("token without expiry was accepted")
	}
}
