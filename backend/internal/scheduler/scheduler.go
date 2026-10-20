package scheduler

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/dockedapp/backend/internal/db"
	"github.com/dockedapp/backend/internal/imagesync"
)

// checkInterval mirrors Node's Scheduler.checkIntervalMs: the wall-clock
// cadence at which batch configs are re-evaluated.
const checkInterval = 5 * time.Minute

// Scheduler ports services/batch/Scheduler.js for the docker-hub-pull job:
// per-user batch_config intervals, lastRunTimes seeded from the latest
// completed batch_run, and a 1-minute retry nudge after failures.
type Scheduler struct {
	svc *imagesync.Service

	mu      sync.Mutex
	lastRun map[string]time.Time // "userID:jobType" -> last successful start
}

func New(svc *imagesync.Service) *Scheduler {
	return &Scheduler{svc: svc, lastRun: make(map[string]time.Time)}
}

// Start seeds stale-run cleanup and lastRunTimes, runs an immediate check,
// then ticks every 5 minutes until ctx is cancelled.
func (s *Scheduler) Start(ctx context.Context) {
	if n, err := db.MarkStaleBatchRunsFailed(ctx, s.svc.DB, imagesync.JobType, int((5 * time.Minute).Seconds())); err != nil {
		slog.Warn("failed to clean up stale batch jobs on startup", "error", err)
	} else if n > 0 {
		slog.Info("cleaned up stale batch jobs on startup", "count", n)
	}

	s.initLastRuns(ctx)
	s.tick(ctx)

	ticker := time.NewTicker(checkInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			slog.Info("batch scheduler stopped")
			return
		case <-ticker.C:
			s.tick(ctx)
		}
	}
}

func (s *Scheduler) initLastRuns(ctx context.Context) {
	users, err := db.GetAllUsers(ctx, s.svc.DB)
	if err != nil {
		slog.Warn("scheduler init: failed to load users", "error", err)
		return
	}
	for _, u := range users {
		run, err := db.GetLatestBatchRunByJobType(ctx, s.svc.DB, u.ID, imagesync.JobType)
		if err != nil {
			slog.Warn("scheduler init: failed to load last run time", "userId", u.ID, "error", err)
			continue
		}
		if run != nil && run.Status == "completed" && run.CompletedAt.Valid && run.CompletedAt.String != "" {
			if t, err := time.Parse("2006-01-02 15:04:05", run.CompletedAt.String); err == nil {
				s.mu.Lock()
				s.lastRun[fmt.Sprintf("%d:%s", u.ID, run.JobType)] = t.UTC()
				s.mu.Unlock()
			}
		}
	}
}

// tick ports checkAndScheduleJobs for the docker-hub-pull job type.
func (s *Scheduler) tick(ctx context.Context) {
	users, err := db.GetAllUsers(ctx, s.svc.DB)
	if err != nil || len(users) == 0 {
		if err != nil {
			slog.Error("scheduler check failed", "error", err)
		}
		return
	}

	now := time.Now()
	triggered := 0

	for _, u := range users {
		configs, err := db.GetBatchConfigs(ctx, s.svc.DB, u.ID)
		if err != nil {
			continue
		}
		for _, cfg := range configs {
			if cfg.JobType != imagesync.JobType || cfg.Enabled != 1 || cfg.IntervalMinutes < 1 {
				continue
			}
			key := fmt.Sprintf("%d:%s", u.ID, cfg.JobType)

			s.mu.Lock()
			last, seen := s.lastRun[key]
			s.mu.Unlock()

			interval := time.Duration(cfg.IntervalMinutes) * time.Minute
			shouldRun := !seen || now.Sub(last) >= interval
			if !shouldRun {
				continue
			}

			triggered++
			slog.Info("job due — triggering", "jobType", cfg.JobType, "userId", u.ID,
				"interval", cfg.IntervalMinutes)
			go s.runJob(ctx, u.ID, cfg.IntervalMinutes, key)
		}
	}

	if triggered > 0 {
		slog.Info("scheduler check: triggered jobs", "count", triggered)
	}
}

// runJob ports runJob + executeJob bookkeeping: on success the last-run
// stamp moves to now; on failure it is rewound so the next tick retries in
// roughly a minute.
func (s *Scheduler) runJob(ctx context.Context, userID int64, intervalMinutes int, key string) {
	_, err := s.svc.RunWithLock(ctx, userID, false)

	s.mu.Lock()
	defer s.mu.Unlock()
	if err != nil {
		if ctx.Err() != nil {
			return // shutting down
		}
		interval := time.Duration(intervalMinutes) * time.Minute
		s.lastRun[key] = time.Now().Add(-interval + time.Minute)
		slog.Warn("scheduled job failed, will retry in ~1 minute", "key", key, "error", err)
		return
	}
	s.lastRun[key] = time.Now()
	slog.Info("scheduled job completed", "key", key)
}
