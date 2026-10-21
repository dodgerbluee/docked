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

// Scheduler ports services/batch/Scheduler.js for the docker-hub-pull and
// tracked-apps-check jobs: per-user batch_config intervals, lastRunTimes
// seeded from the latest completed batch_run, and a 1-minute retry nudge
// after failures.
type Scheduler struct {
	svc *imagesync.Service

	mu      sync.Mutex
	lastRun map[string]time.Time // "userID:jobType" -> last successful start
}

// schedulableJobTypes are the batch jobs the Go scheduler drives. Node's
// Scheduler.getSchedulableJobTypes excludes both (handlers opt out), so
// there is no double-scheduling across the two processes.
var schedulableJobTypes = []string{imagesync.JobType, imagesync.TrackedJobType}

func New(svc *imagesync.Service) *Scheduler {
	return &Scheduler{svc: svc, lastRun: make(map[string]time.Time)}
}

// Start seeds stale-run cleanup and lastRunTimes, runs an immediate check,
// then ticks every 5 minutes until ctx is cancelled.
func (s *Scheduler) Start(ctx context.Context) {
	for _, jobType := range schedulableJobTypes {
		if n, err := db.MarkStaleBatchRunsFailed(ctx, s.svc.DB, jobType, int((5 * time.Minute).Seconds())); err != nil {
			slog.Warn("failed to clean up stale batch jobs on startup", "jobType", jobType, "error", err)
		} else if n > 0 {
			slog.Info("cleaned up stale batch jobs on startup", "jobType", jobType, "count", n)
		}
	}

	s.initLastRuns(ctx)
	s.tick(ctx)

	// Revoked-token cleanup is shared by both stacks (same SQLite table):
	// Node never wired its prune, so the Go scheduler owns it. Run once at
	// startup, then daily.
	if err := db.PruneExpiredRevoked(ctx, s.svc.DB); err != nil {
		slog.Warn("failed to prune expired revoked tokens on startup", "error", err)
	}

	ticker := time.NewTicker(checkInterval)
	defer ticker.Stop()
	pruneTicker := time.NewTicker(24 * time.Hour)
	defer pruneTicker.Stop()
	for {
		select {
		case <-ctx.Done():
			slog.Info("batch scheduler stopped")
			return
		case <-ticker.C:
			s.tick(ctx)
		case <-pruneTicker.C:
			if err := db.PruneExpiredRevoked(ctx, s.svc.DB); err != nil {
				slog.Warn("failed to prune expired revoked tokens", "error", err)
			}
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
		for _, jobType := range schedulableJobTypes {
			run, err := db.GetLatestBatchRunByJobType(ctx, s.svc.DB, u.ID, jobType)
			if err != nil {
				slog.Warn("scheduler init: failed to load last run time", "userId", u.ID, "error", err)
				continue
			}
			if run != nil && run.Status == "completed" && run.CompletedAt.Valid && run.CompletedAt.String != "" {
				if t, err := db.ParseSQLiteTime(run.CompletedAt.String); err == nil {
					s.mu.Lock()
					s.lastRun[fmt.Sprintf("%d:%s", u.ID, run.JobType)] = t.UTC()
					s.mu.Unlock()
				} else {
					slog.Warn("scheduler init: unparseable completed_at", "userId", u.ID, "value", run.CompletedAt.String, "error", err)
				}
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
			if !isSchedulable(cfg.JobType) || cfg.Enabled != 1 || cfg.IntervalMinutes < 1 {
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
			go s.runJob(ctx, u.ID, cfg.JobType, cfg.IntervalMinutes, key)
		}
	}

	if triggered > 0 {
		slog.Info("scheduler check: triggered jobs", "count", triggered)
	}
}

func isSchedulable(jobType string) bool {
	for _, jt := range schedulableJobTypes {
		if jt == jobType {
			return true
		}
	}
	return false
}

// runJob ports runJob + executeJob bookkeeping: on success the last-run
// stamp moves to now; on failure it is rewound so the next tick retries in
// roughly a minute.
func (s *Scheduler) runJob(ctx context.Context, userID int64, jobType string, intervalMinutes int, key string) {
	var err error
	if jobType == imagesync.TrackedJobType {
		_, err = s.svc.RunWithLockTracked(ctx, userID, false)
	} else {
		_, err = s.svc.RunWithLock(ctx, userID, false)
	}

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
