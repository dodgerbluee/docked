package api

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/99designs/gqlgen/complexity"
	"github.com/99designs/gqlgen/graphql"
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
	"github.com/dockedapp/backend/internal/intents"
	"github.com/dockedapp/backend/internal/oauth"
	runnerpkg "github.com/dockedapp/backend/internal/runner"
)

// wsConnectionCtxKey marks a context derived from a websocket
// connection-init (set by InitFunc) so the per-operation guard can tell WS
// traffic apart from plain HTTP requests.
type wsConnectionCtxKey struct{}

// Cost + depth budgets for the AroundOperations guard. The client's heaviest
// legitimate queries (paged containers with relation fields) stay far below
// these; the budgets exist to stop malicious alias/list fan-out.
const (
	maxQueryComplexity = 10000
	maxQueryDepth      = 15
)

// queryDepth measures the maximum selection-set nesting of a parsed query,
// following inline fragments and named fragment spreads.
func queryDepth(doc *ast.QueryDocument) int {
	deepest := 0
	var walk func(ast.SelectionSet, int)
	walk = func(sels ast.SelectionSet, depth int) {
		if depth > deepest {
			deepest = depth
		}
		for _, sel := range sels {
			switch node := sel.(type) {
			case *ast.Field:
				if len(node.SelectionSet) == 0 {
					continue
				}
				walk(node.SelectionSet, depth+1)
			case *ast.InlineFragment:
				walk(node.SelectionSet, depth)
			case *ast.FragmentSpread:
				for _, frag := range doc.Fragments {
					if frag.Name == node.Name {
						walk(frag.SelectionSet, depth)
						break
					}
				}
			}
		}
	}
	for _, op := range doc.Operations {
		walk(op.SelectionSet, 0)
	}
	return deepest
}

// Server bundles the HTTP handler with the background services the process
// owner (main.go) must start alongside it.
type Server struct {
	Handler http.Handler

	// Intents is the scheduled/immediate intent evaluator. The caller owns
	// its lifecycle: go Server.Intents.Start(ctx).
	Intents *intents.Evaluator
}

// NewServer builds the chi router with all middleware and routes registered.
// The GraphQL endpoint is mounted at /graphql; the playground at /playground.
// hub is the event hub shared by subscription resolvers and the Node bridge;
// syncSvc drives the docker-hub-pull container sync (may be nil, in which
// case pullContainers reports it as unavailable). poller backs the runner
// version poller; heartbeat URL changes reset its per-runner backoff.
func NewServer(cfg *config.Config, database *sql.DB, hub *events.Hub, syncSvc *imagesync.Service, poller *runnerpkg.VersionPoller) *Server {
	r := chi.NewRouter()

	r.Use(middleware.RequestID)
	// Trusted-proxy-aware replacement for middleware.RealIP (which believed
	// any X-Forwarded-For from any peer). cfg.TrustedProxies defaults to
	// loopback+private ranges; TRUSTED_PROXIES overrides the list.
	r.Use(apimiddleware.RealIPFrom(cfg.TrustedProxies))
	r.Use(apimiddleware.Logger)
	r.Use(middleware.Recoverer)

	// Edge surface (phase 8b): helmet + cors ports, applied globally like
	// Node's server.js. Gated behind EDGE_SERVE because during the
	// transition Node is still the edge: it applies its own helmet/cors and
	// pipes proxied Go responses through, which would duplicate (and
	// intersect) the security headers. Set EDGE_SERVE=true when Go becomes
	// the edge (phase 8c).
	if cfg.Edge.ServeEdge {
		r.Use(apimiddleware.SecurityHeaders(cfg.Edge))
		r.Use(apimiddleware.CORS(cfg.Edge.CORSOrigins))
	}

	// Configure auth secret
	auth.SetSecret(cfg.JWTSecret)

	// Build the gqlgen server. Same transports as handler.NewDefaultServer,
	// plus a websocket connection-init authenticator: graphql-ws clients send
	// the JWT in connectionParams, which is the only place a token can ride
	// on a WS handshake. The returned context flows into every subscription
	// operation on that connection.
	resolver := &graph.Resolver{DB: database, Cfg: cfg, Hub: hub, Sync: syncSvc}
	// Intent engine: one shared executor (resolver-bound upgrade/publish/
	// notify) adopted by the evaluator AND the manual trigger resolvers, so
	// all execution paths use the same live matcher and lock semantics. The
	// sync service's post-scan hook fires immediate intents (Node's
	// BatchManager hook).
	intentExec := resolver.BuildIntentExecutor()
	intentEval := intents.NewEvaluator(database, intentExec)
	resolver.Intents = intentEval
	if syncSvc != nil {
		syncSvc.OnScanComplete = intentEval.EvaluateImmediateIntents
	}
	execSchema := graph.NewExecutableSchema(graph.Config{Resolvers: resolver})
	srv := handler.New(execSchema)
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
			// Stash the raw token like the HTTP middleware does: the
			// per-operation revalidation middleware and the subscription
			// watchdog need exactly the token this connection presented.
			ctx = auth.ContextWithRawToken(ctx, token)
			// Mark the connection so the per-operation guard knows to
			// re-validate (HTTP requests carry their own bearer tokens and
			// already pass through the revocation-aware middleware).
			ctx = context.WithValue(ctx, wsConnectionCtxKey{}, true)
			// Give the subscription watchdog a way to tear down the whole
			// connection when the session dies mid-stream (see
			// graph.WSDisconnectKey).
			connCtx, connCancel := context.WithCancel(ctx)
			ctx = context.WithValue(connCtx, graph.WSDisconnectKey{}, connCancel)
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

	// Per-operation hardening. Websocket auth rides the connectionParams
	// token and InitFunc only runs at handshake time, so a token that
	// expires or is revoked mid-connection must not keep executing
	// operations: re-validate the connection's token on every operation.
	// (HTTP requests already pass through the revocation-aware auth
	// middleware, so only WS connections pay for the extra checks.)
	srv.AroundOperations(func(ctx context.Context, next graphql.OperationHandler) graphql.ResponseHandler {
		reject := func(msg string) graphql.ResponseHandler {
			return func(c context.Context) *graphql.Response {
				return graphql.ErrorResponse(c, "%s", msg)
			}
		}
		if ctx.Value(wsConnectionCtxKey{}) != nil {
			raw := auth.RawTokenFromContext(ctx)
			uid, err := auth.ValidateToken(raw, cfg.JWTSecret)
			if err != nil {
				return reject("session expired")
			}
			if revoked, err := db.IsTokenRevoked(ctx, database, raw); err != nil || revoked {
				return reject("session revoked")
			}
			if u, err := db.GetUserByID(ctx, database, uid); err != nil || u == nil {
				return reject("session invalid")
			}
		}
		// Cost + depth budgets: cap aliasing/list fan-out amplification of
		// the DB and network work a single request can trigger.
		if opCtx := graphql.GetOperationContext(ctx); opCtx != nil && opCtx.Operation != nil {
			if cost := complexity.Calculate(ctx, execSchema, opCtx.Operation, opCtx.Variables); cost > maxQueryComplexity {
				return reject("query too complex")
			}
			if depth := queryDepth(opCtx.Doc); depth > maxQueryDepth {
				return reject("query nesting too deep")
			}
		}
		return next(ctx)
	})

	// Auth middleware for GraphQL: extracts JWT and puts userID in context
	//
	// Public abuse protection: unauthenticated /graphql traffic (bootstrap
	// mutations, register, login-page queries) gets a per-IP budget, replacing
	// the express-rate-limit guards Node applied to the pruned REST auth
	// routes. Sensitive public operations additionally enforce their own
	// per-operation budget inside the resolvers (see graph.publicOpLimiter),
	// which closes the aliasing and authenticated-exemption bypasses.
	// Identity comes from ClientKeyFromRequest: the peer address as
	// sanitized by RealIPFrom (forwarding headers honored only from
	// trusted proxy networks).
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
	authLimiter := apimiddleware.NewRateLimiter(20, 15*time.Minute, 10000)
	avatarLimiter := apimiddleware.NewRateLimiter(100, 15*time.Minute, 10000)
	oauthLimiter := apimiddleware.NewRateLimiter(10, 15*time.Minute, 10000)
	oauthPublicLimiter := apimiddleware.NewRateLimiter(20, 15*time.Minute, 10000)

	// SSO provider registry (DB-configured providers with env fallback),
	// lazily refreshed so GraphQL SSO CRUD is picked up without restarts.
	oauthRegistry := oauth.NewRegistry(database, cfg.OAuth)

	// Global safety net (Node's globalLimiter): 300 req/min per IP across
	// the whole /api surface; per-route limiters below stay stricter for
	// sensitive endpoints. Localhost is exempt outside production, matching
	// Node's skip function.
	globalLimiter := apimiddleware.NewRateLimiter(300, time.Minute, 10000)
	globalLimit := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			key := apimiddleware.ClientKeyFromRequest(req)
			if cfg.Edge.NodeEnv != "production" && isLocalKey(key) {
				next.ServeHTTP(w, req)
				return
			}
			if !globalLimiter.Allow(key) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusTooManyRequests)
				w.Write([]byte(`{"success":false,"error":"Too many requests, please try again later."}`))
				return
			}
			next.ServeHTTP(w, req)
		})
	}
	versionLimiter := apimiddleware.NewRateLimiter(20, 15*time.Minute, 10000)

	r.Route("/api", func(r chi.Router) {
		r.Use(globalLimit)

		// Health + version (Node's healthController/versionController). The
		// version endpoint keeps Node's publicLimiter budget (20/15min).
		r.Get("/health", handlers.Health())
		r.With(apimiddleware.RateLimit(versionLimiter, apimiddleware.RESTTooManyRequests)).
			Get("/version", handlers.Version(cfg))

		// Admin debug surface (Node's debugController). Auth twin of Node's
		// authenticate, then the debug_endpoints_enabled gate inside
		// DebugRoutes rejects everything when the setting is off.
		r.Group(func(r chi.Router) {
			r.Use(auth.StrictMiddleware(cfg.JWTSecret, database))
			r.Route("/debug", func(r chi.Router) {
				handlers.DebugRoutes(r, database, cfg, syncSvc)
			})
		})

		// Agent endpoints: unauthenticated (dockhand authenticates via
		// enrollment token / API key inside the handlers).
		r.Group(func(r chi.Router) {
			r.Use(apimiddleware.RateLimit(agentLimiter, apimiddleware.RESTTooManyRequests))
			r.Get("/runners/install/{token}", handlers.ServeInstallScript(cfg.DockedURL))
			r.Post("/runners/register", handlers.RegisterRunner(database))
			r.Post("/runners/heartbeat", handlers.HeartbeatRunner(database, poller))
			r.Post("/runners/re-enroll", handlers.ReEnrollRunner(database))
		})

		// Public auth endpoints (Node keeps the edge limiter and proxies).
		// /auth/verify is deliberately unthrottled, matching Node's route
		// table where no limiter is registered for it.
		r.With(apimiddleware.RateLimit(authLimiter, apimiddleware.RESTTooManyRequests)).
			Post("/auth/login", handlers.Login(database))
		r.With(apimiddleware.RateLimit(authLimiter, apimiddleware.RESTTooManyRequests)).
			Post("/auth/create-user-with-config", handlers.CreateUserWithConfig(database, cfg.JWTSecret))
		r.Get("/auth/verify", handlers.VerifyToken(database, cfg.JWTSecret))

		// OAuth/SSO endpoints (phase 7d). Node keeps the edge oauthLimiter
		// and proxies; budgets mirror Node's express-rate-limit placement
		// (publicLimiter on the providers list, oauthLimiter on the flow).
		r.With(apimiddleware.RateLimit(oauthPublicLimiter, apimiddleware.RESTTooManyRequests)).
			Get("/auth/oauth/providers", handlers.GetOAuthProviders(oauthRegistry, database))
		r.With(apimiddleware.RateLimit(oauthLimiter, apimiddleware.RESTTooManyRequests)).
			Get("/auth/oauth/login", handlers.OAuthLogin(oauthRegistry, cfg.OAuth, database))
		r.With(apimiddleware.RateLimit(oauthLimiter, apimiddleware.RESTTooManyRequests)).
			Get("/auth/oauth/callback", handlers.OAuthCallback(oauthRegistry, cfg.OAuth, database, cfg.JWTSecret))
		r.With(apimiddleware.RateLimit(oauthLimiter, apimiddleware.RESTTooManyRequests)).
			Post("/auth/oauth/link", handlers.OAuthLink(database, cfg.JWTSecret))

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

			// Config export + logout (Node mounts these after authenticate,
			// with no per-route limiter).
			r.Get("/auth/export-users", handlers.ExportUsers(database))
			r.Get("/user/export-config", handlers.ExportUserConfig(database))
			r.Post("/auth/logout", handlers.Logout(database, cfg.JWTSecret))

			// Avatar serving routes (limiter after auth, like Node).
			r.Group(func(r chi.Router) {
				r.Use(apimiddleware.RateLimit(avatarLimiter, apimiddleware.RESTTooManyRequests))
				r.Get("/avatars", handlers.GetAvatar(database))
				r.Get("/avatars/user/{userId}", handlers.GetAvatarByUserId(database))
				r.Get("/avatars/recent", handlers.GetRecentAvatars(database))
				r.Get("/avatars/recent/{filename}", handlers.GetRecentAvatar(database))
			})
		})
	})

	// Static SPA serving + history fallback (Node's express.static(publicPath)
	// plus the index.html fallback middleware). Enabled whenever the build
	// directory exists; the edge keeps pointing at Node until phase 8c, so
	// this is dormant until the cutover.
	r.NotFound(notFoundJSON)
	if st, err := os.Stat(cfg.Edge.StaticDir); err == nil && st.IsDir() {
		r.Handle("/*", spaHandler(cfg.Edge.StaticDir))
		slog.Info("static SPA serving enabled", "dir", cfg.Edge.StaticDir)
	}

	slog.Info("GraphQL server ready", "endpoint", "/graphql", "playground", "/playground")
	return &Server{Handler: r, Intents: intentEval}
}

// isLocalKey matches Node's globalLimiter skip list (localhost in dev).
func isLocalKey(key string) bool {
	switch key {
	case "::1", "127.0.0.1", "::ffff:127.0.0.1":
		return true
	}
	return false
}

func notFoundJSON(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusNotFound)
	w.Write([]byte(`{"success":false,"error":"Not found"}`))
}

// spaHandler ports Node's static pipeline: express.static (serve the file
// when it exists, default index.html inside directories) followed by the
// SPA fallback that hands index.html to every unmatched non-/api route.
func spaHandler(dir string) http.HandlerFunc {
	fileServer := http.FileServer(http.Dir(dir))
	return func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api") {
			notFoundJSON(w, r)
			return
		}
		if r.Method == http.MethodGet || r.Method == http.MethodHead {
			candidate := filepath.Join(dir, filepath.Clean("/"+r.URL.Path))
			if st, err := os.Stat(candidate); err == nil {
				if !st.IsDir() {
					fileServer.ServeHTTP(w, r)
					return
				}
				if ist, err := os.Stat(filepath.Join(candidate, "index.html")); err == nil && !ist.IsDir() {
					fileServer.ServeHTTP(w, r)
					return
				}
			}
		}
		// SPA fallback (Node sends index.html for any unmatched route).
		index := filepath.Join(dir, "index.html")
		if _, err := os.Stat(index); err != nil {
			notFoundJSON(w, r)
			return
		}
		http.ServeFile(w, r, index)
	}
}

func bearerToken(r *http.Request) (string, bool) {
	header := r.Header.Get("Authorization")
	if len(header) > 7 && header[:7] == "Bearer " {
		return header[7:], true
	}
	return "", false
}
