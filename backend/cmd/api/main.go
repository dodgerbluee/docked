package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/dockedapp/backend/internal/api"
	"github.com/dockedapp/backend/internal/api/handlers"
	"github.com/dockedapp/backend/internal/config"
	"github.com/dockedapp/backend/internal/db"
	"github.com/dockedapp/backend/internal/events"
	"github.com/dockedapp/backend/internal/imagesync"
	"github.com/dockedapp/backend/internal/runner"
	"github.com/dockedapp/backend/internal/scheduler"
)

func main() {
	cfg := config.Load()

	logLevel := slog.LevelInfo
	if cfg.Debug {
		logLevel = slog.LevelDebug
	}
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: logLevel})))

	if cfg.Debug {
		slog.Debug("debug logging enabled")
	}

	database, err := db.Open(cfg.DBPath)
	if err != nil {
		slog.Error("failed to open database", "path", cfg.DBPath, "error", err)
		os.Exit(1)
	}
	defer database.Close()

	// Own the full schema: Node's ensure block + versioned migrations, ported
	// to Go (internal/db/migrate.go). Runs before the listener opens, so the
	// entrypoint can treat "port is up" as "migrations are done" and Node's
	// legacy migration runner never races us on fresh or old databases.
	if err := db.Migrate(context.Background(), database); err != nil {
		slog.Error("failed to migrate database", "path", cfg.DBPath, "error", err)
		os.Exit(1)
	}

	// Event hub shared by subscription resolvers, the Node bridge, and the
	// container-sync service.
	hub := events.NewHub()
	syncSvc := imagesync.NewService(database, hub)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Batch scheduler (docker-hub-pull) runs alongside the HTTP server.
	go scheduler.New(syncSvc).Start(ctx)

	// Runner version poller (dockhand release badge + docker status), the Go
	// twin of Node's runnerVersionPoller. Heartbeat URL changes reset its
	// per-runner backoff in-process via the shared instance.
	versionPoller := runner.NewVersionPoller(database)
	go versionPoller.Start(ctx)

	// Enrollment token housekeeping (DB cleanup + in-memory sweep), the Go
	// twin of Node runnerController's startup cleanup + 30-minute interval.
	go handlers.StartEnrollmentMaintenance(ctx, database)

	// OAuth state housekeeping: the Go twin of Node server.js's
	// cleanExpiredOAuthStates (once at startup, then hourly).
	go func() {
		sweep := func() {
			if n, err := db.CleanExpiredOAuthStates(ctx, database); err != nil {
				slog.Error("failed to clean expired oauth states", "error", err)
			} else if n > 0 {
				slog.Info("cleaned expired oauth states", "count", n)
			}
		}
		sweep()
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				sweep()
			}
		}
	}()

	// Mark intent executions interrupted by a restart as failed (Node's
	// cleanupStaleIntentExecutions in BatchManager.start). Runs before the
	// evaluator starts so stale rows never shadow fresh executions.
	if n, err := db.CleanupStaleIntentExecutions(ctx, database); err != nil {
		slog.Error("failed to clean up stale intent executions", "error", err)
	} else if n > 0 {
		slog.Info("marked interrupted intent executions as failed", "count", n)
	}

	// Intent evaluator: 60s scheduled sweep + immediate-intent hook (wired
	// into syncSvc by NewServer). Node's evaluator is opted out while Go owns it.
	apiServer := api.NewServer(cfg, database, hub, syncSvc, versionPoller)
	go apiServer.Intents.Start(ctx)

	srv := &http.Server{
		Addr:         cfg.Addr,
		Handler:      apiServer.Handler,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	go func() {
		slog.Info("server listening", "addr", cfg.Addr)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()

	slog.Info("shutting down server")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		slog.Error("forced shutdown", "error", err)
	}
}
