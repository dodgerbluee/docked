package api

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/99designs/gqlgen/graphql/handler"
	"github.com/99designs/gqlgen/graphql/handler/extension"
	"github.com/99designs/gqlgen/graphql/handler/lru"
	"github.com/99designs/gqlgen/graphql/handler/transport"
	"github.com/99designs/gqlgen/graphql/playground"
	coderws "github.com/coder/websocket"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/vektah/gqlparser/v2/ast"

	"github.com/dockedapp/backend/graph"
	"github.com/dockedapp/backend/internal/api/handlers"
	apimiddleware "github.com/dockedapp/backend/internal/api/middleware"
	"github.com/dockedapp/backend/internal/auth"
	"github.com/dockedapp/backend/internal/config"
	"github.com/dockedapp/backend/internal/db"
	"github.com/dockedapp/backend/internal/events"
	"github.com/dockedapp/backend/internal/imagesync"
	runnerpkg "github.com/dockedapp/backend/internal/runner"
)

// NewServer builds the chi router with all middleware and routes registered.
// The GraphQL endpoint is mounted at /graphql; the playground at /playground.
// hub is the event hub shared by subscription resolvers and the Node bridge;
// syncSvc drives the docker-hub-pull container sync (may be nil, in which
// case pullContainers reports it as unavailable). poller backs the runner
// version poller; heartbeat URL changes reset its per-runner backoff.
func NewServer(cfg *config.Config, database *sql.DB, hub *events.Hub, syncSvc *imagesync.Service, poller *runnerpkg.VersionPoller) http.Handler {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(apimiddleware.Logger)
	r.Use(middleware.Recoverer)

	// Configure auth secret
	auth.SetSecret(cfg.JWTSecret)

	// Build the gqlgen server. Same transports as handler.NewDefaultServer,
	// plus a websocket connection-init authenticator: graphql-ws clients send
	// the JWT in connectionParams, which is the only place a token can ride
	// on a WS handshake. The returned context flows into every subscription
	// operation on that connection.
	resolver := &graph.Resolver{DB: database, Cfg: cfg, Hub: hub, Sync: syncSvc}
	srv := handler.New(graph.NewExecutableSchema(graph.Config{Resolvers: resolver}))
	srv.AddTransport(transport.Websocket{
		// Auth is the JWT in connectionParams (see InitFunc), not cookies, so
		// the default same-origin handshake check only breaks proxied setups
		// (Vite dev proxy, Node upgrade proxy) where Origin and Host differ.
		Implementation: transport.CoderWebsocketImplementation{
			AcceptOptions: coderws.AcceptOptions{InsecureSkipVerify: true},
		},
		KeepAlivePingInterval: 10 * time.Second,
		// KeepAlivePingInterval only covers the legacy graphql-ws subprotocol;
		// graphql-transport-ws (what the clients use) needs PongOnlyInterval or
		// the socket goes idle and proxies (nginx read timeout) reap it ~90s in.
		PongOnlyInterval: 10 * time.Second,
		InitFunc: func(ctx context.Context, initPayload transport.InitPayload) (context.Context, *transport.InitPayload, error) {
			// In graphql-transport-ws, failures are signaled by the close frame
			// (connection_error is a no-op), so set close code 4401 (the
			// graphql-ws "Unauthorized" convention) — clients stop retrying on it.
			reject := func(msg string) (context.Context, *transport.InitPayload, error) {
				ctx = transport.WithWebsocketCloseCode(ctx, 4401)
				ctx = transport.AppendCloseReason(ctx, "unauthorized")
				return ctx, nil, errors.New(msg)
			}
			token, _ := initPayload["token"].(string)
			if token == "" {
				return reject("authentication required")
			}
			userID, err := auth.ValidateToken(token, cfg.JWTSecret)
			if err != nil {
				return reject("invalid token")
			}
			user, err := db.GetUserByID(ctx, database, userID)
			if err != nil || user == nil {
				return reject("invalid token")
			}
			if revoked, err := db.IsTokenRevoked(ctx, database, token); err != nil || revoked {
				return reject("invalid token")
			}
			return auth.ContextWithUserID(ctx, userID), nil, nil
		},
	})
	srv.AddTransport(transport.Options{})
	srv.AddTransport(transport.GET{})
	srv.AddTransport(transport.POST{})
	srv.AddTransport(transport.MultipartForm{})
	srv.SetQueryCache(lru.New[*ast.QueryDocument](1000))
	srv.Use(extension.Introspection{})
	srv.Use(extension.AutomaticPersistedQuery{
		Cache: lru.New[string](100),
	})

	// Auth middleware for GraphQL: extracts JWT and puts userID in context
	//
	// Public abuse protection: unauthenticated /graphql traffic (bootstrap
	// mutations, register, login-page queries) gets a per-IP budget, replacing
	// the express-rate-limit guards Node applied to the pruned REST auth
	// routes. Sensitive public operations additionally enforce their own
	// per-operation budget inside the resolvers (see graph.publicOpLimiter),
	// which closes the aliasing and authenticated-exemption bypasses.
	// Identity comes from ClientKeyFromRequest: the rightmost X-Forwarded-For
	// entry (the one the Node proxy controls), never client-supplied prefixes.
	publicLimiter := apimiddleware.NewRateLimiter(60, time.Minute, 10000)
	graphqlAuth := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			ctx := apimiddleware.WithClientIP(req.Context(), apimiddleware.ClientKeyFromRequest(req))
			req = req.WithContext(ctx)
			clientKey := apimiddleware.ClientIP(ctx)

			// For WebSocket upgrades, check connection params
			if req.Header.Get("Upgrade") == "websocket" {
				if !publicLimiter.Allow(clientKey) {
					apimiddleware.GraphQLTooManyRequests(w)
					return
				}
				next.ServeHTTP(w, req)
				return
			}

			raw, ok := bearerToken(req)
			if !ok {
				// Allow unauthenticated access (health, login, register handle their own auth)
				if !publicLimiter.Allow(clientKey) {
					apimiddleware.GraphQLTooManyRequests(w)
					return
				}
				next.ServeHTTP(w, req)
				return
			}

			userID, err := auth.ValidateToken(raw, cfg.JWTSecret)
			if err != nil {
				// Token invalid — proceed without user context
				slog.Debug("graphql auth: token validation failed", "error", err.Error())
				if !publicLimiter.Allow(clientKey) {
					apimiddleware.GraphQLTooManyRequests(w)
					return
				}
				next.ServeHTTP(w, req)
				return
			}
			// Match Node's authentication boundary: a cryptographically valid token
			// is not sufficient after its user has been deleted. Without this check,
			// deleted users retained access to every resolver guarded by requireUser.
			user, err := db.GetUserByID(req.Context(), database, userID)
			if err != nil || user == nil {
				slog.Debug("graphql auth: token user no longer exists", "userID", userID)
				if !publicLimiter.Allow(clientKey) {
					apimiddleware.GraphQLTooManyRequests(w)
					return
				}
				next.ServeHTTP(w, req)
				return
			}
			// Revocation: a cryptographically valid token is rejected once its
			// hash is in revoked_tokens (logout). Fail closed on DB error, the
			// same way the user lookup above does.
			revoked, err := db.IsTokenRevoked(req.Context(), database, raw)
			if err != nil {
				slog.Warn("graphql auth: revocation check failed", "error", err.Error())
			}
			if err != nil || revoked {
				slog.Debug("graphql auth: token revoked", "userID", userID)
				if !publicLimiter.Allow(clientKey) {
					apimiddleware.GraphQLTooManyRequests(w)
					return
				}
				next.ServeHTTP(w, req)
				return
			}
			slog.Debug("graphql auth: token validated", "userID", userID)

			ctx = auth.ContextWithUserID(ctx, userID)
			ctx = auth.ContextWithRawToken(ctx, raw)
			next.ServeHTTP(w, req.WithContext(ctx))
		})
	}

	r.Handle("/graphql", graphqlAuth(srv))
	r.Handle("/playground", playground.Handler("Docked GraphQL", "/graphql"))

	// Cross-process event bridge (Node → Go hub). Shared-secret guarded.
	r.Post("/internal/events", handlers.InternalEvents(hub, cfg.JWTSecret))

	// Health check (no auth)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	})

	// Runner agent protocol + enrollment endpoints (migrated from Node's
	// runnerController). Node proxies /api/runners/* here during the
	// transition; qbit-proxy points straight at Go once Node retires.
	// Limiter budgets mirror Node's express-rate-limit placement:
	// publicLimiter (20/15min) on the unauthenticated agent endpoints,
	// writeLimiter (30/15min) on enrollment creation and the operation-run
	// streams, destructiveLimiter (10/min) on container upgrades.
	agentLimiter := apimiddleware.NewRateLimiter(20, 15*time.Minute, 10000)
	writeLimiter := apimiddleware.NewRateLimiter(30, 15*time.Minute, 10000)
	destructiveLimiter := apimiddleware.NewRateLimiter(10, time.Minute, 10000)

	r.Route("/api", func(r chi.Router) {
		// Agent endpoints: unauthenticated (dockhand authenticates via
		// enrollment token / API key inside the handlers).
		r.Group(func(r chi.Router) {
			r.Use(apimiddleware.RateLimit(agentLimiter, apimiddleware.RESTTooManyRequests))
			r.Get("/runners/install/{token}", handlers.ServeInstallScript(cfg.DockedURL))
			r.Post("/runners/register", handlers.RegisterRunner(database))
			r.Post("/runners/heartbeat", handlers.HeartbeatRunner(database, poller))
			r.Post("/runners/re-enroll", handlers.ReEnrollRunner(database))
		})

		// Browser-facing enrollment endpoints behind the strict auth twin of
		// Node's authenticate (signature + user exists + not revoked), plus
		// the commit-B runner proxy routes (operations/apps listings, app
		// history, and the upgrade/operation-run/app-run SSE streams).
		// Limiter placement mirrors Node's express-rate-limit registration.
		r.Group(func(r chi.Router) {
			r.Use(auth.StrictMiddleware(cfg.JWTSecret, database))
			r.With(apimiddleware.RateLimit(writeLimiter, apimiddleware.RESTTooManyRequests)).
				Post("/runners/enrollment", handlers.CreateEnrollment(database, cfg.DockedURL))
			r.Get("/runners/enrollment-status", handlers.EnrollmentStatus(database))

			r.Get("/runners/{runnerId}/operations", handlers.RunnerOperations(database))
			r.With(apimiddleware.RateLimit(writeLimiter, apimiddleware.RESTTooManyRequests)).
				Post("/runners/{runnerId}/operations/{name}/run", handlers.RunRunnerOperation(database))
			r.Get("/runners/{runnerId}/apps", handlers.RunnerApps(database))
			r.Get("/runners/{runnerId}/apps/history", handlers.RunnerAppsHistory(database))
			r.With(apimiddleware.RateLimit(writeLimiter, apimiddleware.RESTTooManyRequests)).
				Post("/runners/{runnerId}/apps/{appName}/operations/{opName}/run", handlers.RunRunnerAppOperation(database))
			r.With(apimiddleware.RateLimit(destructiveLimiter, apimiddleware.RESTTooManyRequests)).
				Post("/runners/{runnerId}/containers/{containerId}/upgrade", handlers.RunnerUpgradeStream(database))
		})
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
