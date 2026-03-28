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
	"github.com/dockedapp/backend/internal/config"
	"github.com/dockedapp/backend/internal/db"
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

	srv := &http.Server{
		Addr:         cfg.Addr,
		Handler:      api.NewServer(cfg, database),
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

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	slog.Info("shutting down server")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		slog.Error("forced shutdown", "error", err)
	}
}
