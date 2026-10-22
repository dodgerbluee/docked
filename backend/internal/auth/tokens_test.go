package auth

import (
	"bytes"
	"encoding/base64"
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

	access, refresh, err := GenerateTokens(42, "alice", "Member", 0)
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

// TestTokenVersionClaimRoundTrip guards the password-change session eviction
// primitive: both token kinds carry the user's token_version, and tokens
// minted before versioning (no claim) read as version 0 so pre-migration
// sessions keep working until the password actually changes.
func TestTokenVersionClaimRoundTrip(t *testing.T) {
	const secret = "unit-secret"
	SetSecret(secret)
	t.Setenv("JWT_REFRESH_SECRET", secret+"-refresh")

	access, refresh, err := GenerateTokens(42, "alice", "Member", 3)
	if err != nil {
		t.Fatalf("GenerateTokens: %v", err)
	}
	uid, tv, _, err := ValidateTokenWithVersion(access, secret)
	if err != nil || uid != 42 || tv != 3 {
		t.Fatalf("ValidateTokenWithVersion = (%d, %d, %v), want (42, 3, nil)", uid, tv, err)
	}
	rc, err := VerifyRefreshToken(refresh)
	if err != nil || rc.TokenVersion != 3 {
		t.Fatalf("refresh claims version = %d (%v), want 3", rc.TokenVersion, err)
	}

	// Version 0 omits the claim (omitempty): legacy-shaped tokens validate
	// and read as version 0, matching every pre-migration row's default.
	legacy := jwt.NewWithClaims(jwt.SigningMethodHS256, TokenClaims{
		UserID:   42,
		Username: "alice",
		Role:     "Member",
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "docked",
			Audience:  jwt.ClaimStrings{"docked-users"},
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	})
	raw, err := legacy.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	if _, tv, _, err := ValidateTokenWithVersion(raw, secret); err != nil || tv != 0 {
		t.Fatalf("legacy token version = %d (%v), want 0", tv, err)
	}
}

// Without a random jti, two logins in the same second mint byte-identical
// tokens: revoking one session (revoked_tokens stores the raw string) would
// silently kill the other.
func TestGenerateTokensSameSecondDiffer(t *testing.T) {
	const secret = "unit-secret"
	SetSecret(secret)
	t.Setenv("JWT_REFRESH_SECRET", secret+"-refresh")

	a1, r1, err := GenerateTokens(7, "bob", "Member", 0)
	if err != nil {
		t.Fatalf("GenerateTokens: %v", err)
	}
	a2, r2, err := GenerateTokens(7, "bob", "Member", 0)
	if err != nil {
		t.Fatalf("GenerateTokens: %v", err)
	}
	if a1 == a2 {
		t.Error("access tokens identical: same-second logins share a revocation identity")
	}
	if r1 == r2 {
		t.Error("refresh tokens identical: same-second logins share a revocation identity")
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

// TestStrictDecodingRejectsReEncodedToken guards the logout-revocation
// boundary: revoked_tokens stores the SHA-256 of the RAW token text, so a
// token re-encoded to different text that still verifies (lenient base64url
// decoding ignores the slack bits in the last signature character: same
// signature bytes, different string) slips past the hash lookup. WithStrictDecoding
// must reject the non-canonical form outright.
func TestStrictDecodingRejectsReEncodedToken(t *testing.T) {
	const secret = "unit-secret"
	SetSecret(secret)
	t.Setenv("JWT_REFRESH_SECRET", secret+"-refresh")

	access, refresh, err := GenerateTokens(42, "alice", "Member", 0)
	if err != nil {
		t.Fatalf("GenerateTokens: %v", err)
	}

	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
	reencode := func(tok string) string {
		parts := strings.Split(tok, ".")
		sig := parts[2]
		last := strings.IndexByte(alphabet, sig[len(sig)-1])
		if last < 0 {
			t.Fatalf("signature char %q not in base64url alphabet", sig[len(sig)-1])
		}
		// A 32-byte HMAC signature is 43 base64url chars: the last char
		// carries 4 significant bits + 2 slack bits. Flip only the slack.
		for delta := 1; delta <= 3; delta++ {
			v := byte((last & 0b111100) | delta)
			if int(v) != last {
				return parts[0] + "." + parts[1] + "." + sig[:len(sig)-1] + string(alphabet[v])
			}
		}
		t.Fatal("no re-encoding variant found")
		return ""
	}

	mutated := reencode(access)
	// Premise check: a lenient decoder sees the SAME signature bytes, so the
	// old (non-strict) parser accepted this token and its hash missed the
	// revocation table.
	sigA, err1 := base64.RawURLEncoding.DecodeString(strings.Split(access, ".")[2])
	sigB, err2 := base64.RawURLEncoding.DecodeString(strings.Split(mutated, ".")[2])
	if err1 != nil || err2 != nil || !bytes.Equal(sigA, sigB) {
		t.Fatal("premise broken: re-encoded signature does not decode identically")
	}

	if _, _, _, err := ValidateTokenWithVersion(mutated, secret); err == nil {
		t.Fatal("re-encoded access token accepted: revocation bypass possible")
	}
	if _, err := VerifyRefreshToken(reencode(refresh)); err == nil {
		t.Fatal("re-encoded refresh token accepted: revocation bypass possible")
	}
	// Canonical tokens must still validate.
	if uid, _, _, err := ValidateTokenWithVersion(access, secret); err != nil || uid != 42 {
		t.Fatalf("canonical access token rejected: %v", err)
	}
	if c, err := VerifyRefreshToken(refresh); err != nil || c.UserID != 42 {
		t.Fatalf("canonical refresh token rejected: %v", err)
	}
}
