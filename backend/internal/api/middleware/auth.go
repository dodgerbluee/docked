package middleware

import (
	"net/http"

	"github.com/dockedapp/backend/internal/auth"
	"github.com/dockedapp/backend/internal/respond"
)

// AuthedHandlerFunc is an http.HandlerFunc that also receives the authenticated user ID.
type AuthedHandlerFunc func(w http.ResponseWriter, r *http.Request, userID int64)

// WithUserID wraps an AuthedHandlerFunc, extracting the user ID from context
// and returning 401 if it is absent.
func WithUserID(handler AuthedHandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := auth.UserID(r.Context())
		if !ok {
			respond.Error(w, http.StatusUnauthorized, "unauthorized")
			return
		}
		handler(w, r, userID)
	}
}
