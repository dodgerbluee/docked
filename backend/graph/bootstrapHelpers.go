package graph

import (
	"context"
	"crypto/rand"
	"database/sql"
	"fmt"
	"log/slog"
	"math/big"
	"regexp"
	"strings"
	"time"

	"github.com/dockedapp/backend/graph/model"
	"github.com/dockedapp/backend/internal/api/middleware"
	"github.com/dockedapp/backend/internal/db"
)

// publicOpLimiter enforces Node's authLimiter semantics (20 requests per
// 15 minutes per IP per route) at the RESOLVER level. The HTTP-layer limiter
// alone is bypassable: aliases fold many sensitive operations into one
// counted request, and authenticated callers are exempt from the public
// budget. Every resolver execution consumes budget regardless of auth or
// aliasing, so neither trick works.
var publicOpLimiter = middleware.NewRateLimiter(20, 15*time.Minute, 10000)

const tooManyRequestsMsg = "Too many requests; please try again later"

func allowPublicOp(ctx context.Context, op string) bool {
	ip := middleware.ClientIP(ctx)
	if ip == "" {
		ip = "unknown"
	}
	return publicOpLimiter.Allow(op + "|" + ip)
}

// Bootstrap secrets (first-user registration codes and instance-admin import
// tokens) use the same alphabets and XXXX-XXXX-XXXX format as Node's nanoid
// generators. Confusing characters (0 O I 1 l) are excluded.
const (
	registrationCodeAlphabet   = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*+=?"
	instanceAdminTokenAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*+-=?"

	bootstrapSecretLen = 12
)

// generateBootstrapSecret returns a cryptographically random 12-character
// secret from alphabet, formatted as XXXX-XXXX-XXXX.
func generateBootstrapSecret(alphabet string) (string, error) {
	var b strings.Builder
	for i := 0; i < bootstrapSecretLen; i++ {
		idx, err := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		if err != nil {
			return "", fmt.Errorf("generate secret: %w", err)
		}
		if i > 0 && i%4 == 0 {
			b.WriteByte('-')
		}
		b.WriteByte(alphabet[idx.Int64()])
	}
	return b.String(), nil
}

var emailPattern = regexp.MustCompile(`^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`)

// isValidEmailFormat mirrors Node's ReDoS-safe email regex plus the 254-char cap.
func isValidEmailFormat(email string) bool {
	if email == "" || len(email) > 254 {
		return false
	}
	return emailPattern.MatchString(email)
}

// logBootstrapSecret prints the operator-facing banner telling them the code
// they need to copy out of the container logs, matching Node's banner format.
func logBootstrapSecret(title, secret, warning, expiryWarning string) {
	bar := "═══════════════════════════════════════════════════════════"
	slog.Info(bar)
	slog.Info(title)
	slog.Info(bar)
	slog.Info("   " + secret)
	slog.Info(bar)
	slog.Info("⚠️  " + warning)
	slog.Info("⚠️  " + expiryWarning)
	slog.Info(bar)
}

// bootstrapOK / bootstrapFail build the REST-envelope-style results the
// client hooks branch on.
func bootstrapOK(message string) *model.BootstrapResult {
	return &model.BootstrapResult{Success: true, Message: strPtr(message)}
}

func bootstrapFail(errMsg string) *model.BootstrapResult {
	return &model.BootstrapResult{Success: false, Error: strPtr(errMsg)}
}

// tokenGranted is the response for generate/regenerate: the token is written
// ONLY to the container logs (operator must have host access to read it, the
// same trust model as the first-user registration code). Returning it in the
// GraphQL response would let any anonymous caller mint their own instance-admin
// grant credential.
func tokenGranted(message string) *model.InstanceAdminTokenResult {
	return &model.InstanceAdminTokenResult{Success: true, Message: strPtr(message)}
}

func tokenFail(errMsg string) *model.InstanceAdminTokenResult {
	return &model.InstanceAdminTokenResult{Success: false, Error: strPtr(errMsg)}
}

// pendingTokenKind is the pending_auth_tokens kind for instance-admin import tokens.
const pendingTokenKind = "instance_admin"

// generateRegistrationCodeImpl stores a fresh first-user registration code in
// the shared settings table (consumed atomically by RegisterUserWithCode).
func generateRegistrationCodeImpl(ctx context.Context, database *sql.DB) *model.BootstrapResult {
	count, err := db.GetUserCount(ctx, database)
	if err != nil {
		return bootstrapFail("Failed to generate registration code")
	}
	if count > 0 {
		return bootstrapFail("Registration code can only be generated when no users exist")
	}
	code, err := generateBootstrapSecret(registrationCodeAlphabet)
	if err != nil {
		return bootstrapFail("Failed to generate registration code")
	}
	if err := db.SetRegistrationCode(ctx, database, code); err != nil {
		return bootstrapFail("Failed to store registration code")
	}
	logBootstrapSecret(
		"🔐 FIRST USER REGISTRATION CODE",
		code,
		"This code is required to create the first user account.",
		"The code will be invalidated after the first user is created.",
	)
	return bootstrapOK("Registration code generated and logged to container logs")
}

// verifyRegistrationCodeImpl checks a candidate code against the stored one
// without consuming it; consumption happens atomically in Register.
func verifyRegistrationCodeImpl(ctx context.Context, database *sql.DB, code string) *model.BootstrapResult {
	if code == "" {
		return bootstrapFail("Registration code is required")
	}
	stored, err := db.GetRegistrationCode(ctx, database)
	if err != nil {
		return bootstrapFail("Failed to verify registration code")
	}
	if stored == nil {
		return bootstrapFail("Registration code has not been generated. Please click 'Create User' first.")
	}
	if !registrationCodesEqual(code, *stored) {
		return bootstrapFail("Invalid registration code")
	}
	return bootstrapOK("Registration code is valid")
}

func generateInstanceAdminTokenImpl(ctx context.Context, database *sql.DB, username string) *model.InstanceAdminTokenResult {
	if username == "" {
		return tokenFail("Username is required")
	}
	token, err := generateBootstrapSecret(instanceAdminTokenAlphabet)
	if err != nil {
		return tokenFail("Failed to generate token")
	}
	if err := db.SetPendingToken(ctx, database, pendingTokenKind, username, token); err != nil {
		return tokenFail("Failed to store token")
	}
	logBootstrapSecret(
		fmt.Sprintf("🔐 REGISTRATION CODE FOR %s", username),
		token,
		fmt.Sprintf("This code is required to create %s as an instance admin.", username),
		"The code will be invalidated after verification.",
	)
	return tokenGranted("Verification token generated and logged to server logs")
}

// regenerateInstanceAdminTokenImpl re-issues a token for an existing instance
// admin by writing users.verification_token directly (the user exists, so the
// pending-token path no longer applies).
func regenerateInstanceAdminTokenImpl(ctx context.Context, database *sql.DB, username string) *model.InstanceAdminTokenResult {
	if username == "" {
		return tokenFail("Username is required")
	}
	user, err := db.GetUserByUsername(ctx, database, username)
	if err != nil {
		return tokenFail("Failed to regenerate token")
	}
	if user == nil {
		return tokenFail("User not found")
	}
	if user.InstanceAdmin != 1 {
		return tokenFail("User is not an instance admin")
	}
	token, err := generateBootstrapSecret(instanceAdminTokenAlphabet)
	if err != nil {
		return tokenFail("Failed to generate token")
	}
	if err := db.UpdateVerificationToken(ctx, database, username, token); err != nil {
		return tokenFail("Failed to store token")
	}
	if err := db.DeletePendingToken(ctx, database, pendingTokenKind, username); err != nil {
		return tokenFail("Failed to store token")
	}
	logBootstrapSecret(
		fmt.Sprintf("🔐 REGISTRATION CODE FOR %s", username),
		token,
		fmt.Sprintf("This code is required to create %s as an instance admin.", username),
		"The code will be invalidated after verification.",
	)
	return tokenGranted("Verification token regenerated and logged to server logs")
}

// verifyInstanceAdminTokenImpl checks a candidate token WITHOUT consuming it:
// the pending token must survive verification so Node's
// create-user-with-config can consume it atomically at the moment it grants
// the instance-admin privilege (see server/controllers/authController.js).
// For users that already exist, the token lives on the users row and IS
// consumed here, since no grant call follows for existing users.
func verifyInstanceAdminTokenImpl(ctx context.Context, database *sql.DB, username, token string) *model.BootstrapResult {
	if username == "" || token == "" {
		return bootstrapFail("Username and token are required")
	}
	stored, err := db.GetPendingToken(ctx, database, pendingTokenKind, username)
	if err != nil {
		return bootstrapFail("Failed to verify token")
	}
	if stored != nil && registrationCodesEqual(token, *stored) {
		return bootstrapOK("Token verified successfully")
	}
	ok, err := db.VerifyAndClearToken(ctx, database, username, token)
	if err != nil {
		return bootstrapFail("Failed to verify token")
	}
	if !ok {
		return bootstrapFail("Invalid token")
	}
	return bootstrapOK("Token verified successfully")
}
