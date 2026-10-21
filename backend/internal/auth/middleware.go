package auth

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"

	"github.com/dockedapp/backend/internal/db"
)

type contextKey struct{}

// Middleware validates a JWT Bearer token on every request and stores the
// authenticated user ID in the request context.
//
// Token requirements (must match the Node.js jwt.js configuration):
//   - Algorithm: HS256
//   - Issuer:    "docked"
//   - Audience:  "docked-users"
//   - Claim key: "userId" (numeric)
func Middleware(secret string) func(http.Handler) http.Handler {
	parser := jwt.NewParser(
		jwt.WithIssuer("docked"),
		jwt.WithValidMethods([]string{"HS256"}),
	)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw, ok := bearerToken(r)
			if !ok {
				http.Error(w, `{"error":"missing or malformed token"}`, http.StatusUnauthorized)
				return
			}

			claims := jwt.MapClaims{}
			_, err := parser.ParseWithClaims(raw, claims, func(_ *jwt.Token) (any, error) {
				return []byte(secret), nil
			})
			if err != nil {
				slog.Debug("jwt validation failed", "error", err.Error())
				http.Error(w, `{"error":"invalid token"}`, http.StatusUnauthorized)
				return
			}

			userID, ok := userIDFrom(claims)
			if !ok {
				http.Error(w, `{"error":"token missing userId claim"}`, http.StatusUnauthorized)
				return
			}

			ctx := context.WithValue(r.Context(), contextKey{}, userID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// StrictMiddleware is the REST parity twin of Node's authenticate middleware:
// beyond signature validation it rejects tokens whose user was deleted and
// tokens revoked by logout (shared revoked_tokens table). The plain
// Middleware only validates the signature, which is sufficient for the
// GraphQL pipeline (its own auth layer performs these checks) but not for
// standalone REST handlers.
//
// Error bodies mirror Node exactly: {"success":false,"error":"..."}.
func StrictMiddleware(secret string, database *sql.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw, ok := bearerToken(r)
			if !ok {
				restError(w, http.StatusUnauthorized, "Authentication required")
				return
			}

			// ValidateTokenClaims uses the concrete claims struct: Node writes
			// "aud" as a bare string, which MapClaims' decoder rejects.
			userID, _, err := ValidateTokenClaims(raw, secret)
			if err != nil {
				slog.Debug("strict auth: token validation failed", "error", err.Error())
				msg := "Invalid token"
				if errors.Is(err, jwt.ErrTokenExpired) {
					msg = "Token expired"
				}
				restError(w, http.StatusUnauthorized, msg)
				return
			}

			user, err := db.GetUserByID(r.Context(), database, userID)
			if err != nil || user == nil {
				restError(w, http.StatusUnauthorized, "User not found")
				return
			}

			revoked, err := db.IsTokenRevoked(r.Context(), database, raw)
			if err != nil || revoked {
				restError(w, http.StatusUnauthorized, "Invalid token")
				return
			}

			ctx := context.WithValue(r.Context(), contextKey{}, userID)
			ctx = ContextWithRawToken(ctx, raw)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func restError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write([]byte(`{"success":false,"error":` + jsonQuote(message) + `}`))
}

func jsonQuote(s string) string {
	b, err := json.Marshal(s)
	if err != nil {
		return `"error"`
	}
	return string(b)
}

// UserID extracts the authenticated user ID from the request context.
// Returns (0, false) if the context contains no user ID.
func UserID(ctx context.Context) (int64, bool) {
	id, ok := ctx.Value(contextKey{}).(int64)
	return id, ok
}

func bearerToken(r *http.Request) (string, bool) {
	headerValue := r.Header.Get("Authorization")
	token, found := strings.CutPrefix(headerValue, "Bearer ")
	return token, found && token != ""
}

// userIDFrom extracts the userId claim. The jsonwebtoken Node.js library
// serialises numbers as JSON floats, so the claim arrives as float64.
func userIDFrom(claims jwt.MapClaims) (int64, bool) {
	value, ok := claims["userId"]
	if !ok {
		return 0, false
	}

	switch id := value.(type) {
	case float64:
		return int64(id), true
	case int64:
		return id, true
	case json.Number:
		n, err := id.Int64()
		return n, err == nil
	}

	return 0, false
}
