package api

import (
	"database/sql"
	"log/slog"
	"net/http"

	"github.com/99designs/gqlgen/graphql/handler"
	"github.com/99designs/gqlgen/graphql/playground"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/dockedapp/backend/graph"
	apimiddleware "github.com/dockedapp/backend/internal/api/middleware"
	"github.com/dockedapp/backend/internal/auth"
	"github.com/dockedapp/backend/internal/config"
	"github.com/dockedapp/backend/internal/db"
)

// NewServer builds the chi router with all middleware and routes registered.
// The GraphQL endpoint is mounted at /graphql; the playground at /playground.
func NewServer(cfg *config.Config, database *sql.DB) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(apimiddleware.Logger)
	r.Use(middleware.Recoverer)

	// Configure auth secret
	auth.SetSecret(cfg.JWTSecret)

	// Build the gqlgen server (includes WebSocket transport for subscriptions by default)
	resolver := &graph.Resolver{DB: database, Cfg: cfg}
	srv := handler.NewDefaultServer(graph.NewExecutableSchema(graph.Config{Resolvers: resolver}))

	// Auth middleware for GraphQL: extracts JWT and puts userID in context
	graphqlAuth := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			// For WebSocket upgrades, check connection params
			if req.Header.Get("Upgrade") == "websocket" {
				next.ServeHTTP(w, req)
				return
			}

			raw, ok := bearerToken(req)
			if !ok {
				// Allow unauthenticated access (health, login, register handle their own auth)
				next.ServeHTTP(w, req)
				return
			}

			userID, err := auth.ValidateToken(raw, cfg.JWTSecret)
			if err != nil {
				// Token invalid — proceed without user context
				slog.Debug("graphql auth: token validation failed", "error", err.Error())
				next.ServeHTTP(w, req)
				return
			}
			// Match Node's authentication boundary: a cryptographically valid token
			// is not sufficient after its user has been deleted. Without this check,
			// deleted users retained access to every resolver guarded by requireUser.
			user, err := db.GetUserByID(req.Context(), database, userID)
			if err != nil || user == nil {
				slog.Debug("graphql auth: token user no longer exists", "userID", userID)
				next.ServeHTTP(w, req)
				return
			}
			slog.Debug("graphql auth: token validated", "userID", userID)

			ctx := auth.ContextWithUserID(req.Context(), userID)
			next.ServeHTTP(w, req.WithContext(ctx))
		})
	}

	r.Handle("/graphql", graphqlAuth(srv))
	r.Handle("/playground", playground.Handler("Docked GraphQL", "/graphql"))

	// Health check (no auth)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})

	// Keep legacy REST routes under /api for backward compat during transition
	r.Route("/api", func(r chi.Router) {
		r.Use(auth.Middleware(cfg.JWTSecret))
		// Legacy routes can be added here during migration
	})

	slog.Info("GraphQL server ready", "endpoint", "/graphql", "playground", "/playground")
	return r
}

func bearerToken(r *http.Request) (string, bool) {
	header := r.Header.Get("Authorization")
	if len(header) > 7 && header[:7] == "Bearer " {
		return header[7:], true
	}
	return "", false
}
