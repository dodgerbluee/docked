package api

import (
	"database/sql"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/dockedapp/backend/internal/api/handlers"
	apimiddleware "github.com/dockedapp/backend/internal/api/middleware"
	"github.com/dockedapp/backend/internal/auth"
	"github.com/dockedapp/backend/internal/config"
	"github.com/dockedapp/backend/internal/containers"
)

// NewServer builds the chi router with all middleware and routes registered.
// It is returned as an http.Handler so main.go can attach it to an http.Server.
func NewServer(cfg *config.Config, database *sql.DB) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(apimiddleware.Logger)
	r.Use(middleware.Recoverer)

	containerSvc := containers.NewService(database)

	r.Route("/api", func(r chi.Router) {
		r.Use(auth.Middleware(cfg.JWTSecret))

		r.Get("/containers", handlers.Containers(containerSvc))
	})

	return r
}
