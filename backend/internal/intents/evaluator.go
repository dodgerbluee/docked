// Intent evaluator — port of Node's services/intents/intentEvaluator.js.
// A 60s ticker evaluates scheduled intents for every user; immediate intents
// fire from the post-scan hook. An in-process guard prevents concurrent runs
// of the same intent, and scheduled intents are pre-marked to their cron
// trigger time BEFORE dispatch so a cron point can never fire twice.
package intents

import (
	"context"
	"database/sql"
	"log/slog"
	"sync"
	"time"

	"github.com/dockedapp/backend/internal/db"
)

const (
	evaluateInterval     = 60 * time.Second
	evaluateStartupDelay = 10 * time.Second
)

// Evaluator drives scheduled and immediate intent execution.
type Evaluator struct {
	DB   *sql.DB
	Exec *Executor

	mu         sync.Mutex
	inProgress map[int64]bool
}

func NewEvaluator(database *sql.DB, exec *Executor) *Evaluator {
	return &Evaluator{DB: database, Exec: exec, inProgress: map[int64]bool{}}
}

// Start runs the initial evaluation after a short settle delay, then every
// 60s until ctx is cancelled.
func (ev *Evaluator) Start(ctx context.Context) {
	slog.Info("starting intent evaluator", "intervalMs", evaluateInterval.Milliseconds())
	select {
	case <-ctx.Done():
		return
	case <-time.After(evaluateStartupDelay):
	}
	ev.EvaluateScheduledIntents(ctx)

	ticker := time.NewTicker(evaluateInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			slog.Info("intent evaluator stopped")
			return
		case <-ticker.C:
			ev.EvaluateScheduledIntents(ctx)
		}
	}
}

// EvaluateScheduledIntents checks every user's enabled scheduled intents.
func (ev *Evaluator) EvaluateScheduledIntents(ctx context.Context) {
	users, err := db.GetAllUsers(ctx, ev.DB)
	if err != nil {
		slog.Error("intent evaluator: user list failed", "error", err)
		return
	}
	for _, u := range users {
		ev.evaluateUserScheduledIntents(ctx, u.ID)
	}
}

func (ev *Evaluator) evaluateUserScheduledIntents(ctx context.Context, userID int64) {
	intents, err := db.GetEnabledIntents(ctx, ev.DB, userID)
	if err != nil {
		slog.Error("intent evaluator: enabled intents failed", "userId", userID, "error", err)
		return
	}
	for i := range intents {
		intent := intents[i]
		if intent.ScheduleType != "scheduled" {
			continue
		}
		if ev.inProgressSet(intent.ID) {
			slog.Debug("skipping intent — execution already in progress",
				"intentId", intent.ID, "intentName", intent.Name)
			continue
		}

		due := IsIntentDue(&intent, time.Now())
		if !due.IsDue {
			ev.inProgressClear(intent.ID)
			continue
		}

		slog.Info("scheduled intent is due — triggering execution",
			"intentId", intent.ID, "intentName", intent.Name, "reason", due.Reason, "userId", userID)

		// Pre-mark last_evaluated_at to the cron trigger point BEFORE
		// dispatch: the next tick computes the FOLLOWING cron point.
		if due.TriggerTime != nil {
			at := due.TriggerTime.UTC().Format(isoMillis)
			if err := db.SetIntentLastEvaluatedAt(ctx, ev.DB, intent.ID, userID, at, -1); err != nil {
				slog.Warn("failed to pre-mark intent lastEvaluatedAt (non-fatal)",
					"intentId", intent.ID, "error", err)
			}
		}
		ev.dispatch(ctx, &intent, userID, due.TriggerTime)
	}
}

// EvaluateImmediateIntents fires immediate intents after a scan detected
// updates (Node's BatchManager post-scan hook).
func (ev *Evaluator) EvaluateImmediateIntents(ctx context.Context, userID int64, itemsUpdated int) {
	if itemsUpdated <= 0 {
		return
	}
	slog.Info("scan detected updates — evaluating immediate intents",
		"userId", userID, "updatesFound", itemsUpdated)

	intents, err := db.GetEnabledIntents(ctx, ev.DB, userID)
	if err != nil {
		slog.Error("intent evaluator: enabled intents failed", "userId", userID, "error", err)
		return
	}
	for i := range intents {
		intent := intents[i]
		if intent.ScheduleType != "immediate" {
			continue
		}
		if ev.inProgressSet(intent.ID) {
			slog.Info("skipping immediate intent — execution already in progress",
				"intentId", intent.ID, "intentName", intent.Name)
			continue
		}
		ev.dispatch(ctx, &intent, userID, nil)
	}
}

// dispatch runs the intent fire-and-forget; triggerTime nil means the
// scan_detected path, set means scheduled_window (Node's mapping).
func (ev *Evaluator) dispatch(ctx context.Context, intent *db.IntentRow, userID int64, triggerTime *time.Time) {
	triggerType := "scan_detected"
	if triggerTime != nil {
		triggerType = "scheduled_window"
	}
	exec := ev.Exec
	intentCopy := *intent
	go func() {
		defer ev.inProgressClear(intentCopy.ID)
		defer func() {
			if rec := recover(); rec != nil {
				slog.Error("panic in intent execution", "intentId", intentCopy.ID, "recover", rec)
			}
		}()
		// Detach from the tick's context: an upgrade may outlive the tick.
		runCtx := context.WithoutCancel(ctx)
		result, err := exec.ExecuteIntent(runCtx, &intentCopy, userID, ExecOptions{
			TriggerType: triggerType,
			TriggerTime: triggerTime,
		})
		if err != nil {
			slog.Error("intent execution failed via evaluator",
				"intentId", intentCopy.ID, "intentName", intentCopy.Name,
				"triggerType", triggerType, "error", err)
			return
		}
		slog.Info("intent execution completed via evaluator",
			"intentId", intentCopy.ID, "intentName", intentCopy.Name,
			"triggerType", triggerType, "status", result.Status,
			"matched", result.ContainersMatched, "upgraded", result.ContainersUpgraded,
			"failed", result.ContainersFailed, "skipped", result.ContainersSkipped)
	}()
}

// inProgressSet atomically claims an intent id, returning true when it was
// already claimed.
func (ev *Evaluator) inProgressSet(intentID int64) bool {
	ev.mu.Lock()
	defer ev.mu.Unlock()
	if ev.inProgress[intentID] {
		return true
	}
	ev.inProgress[intentID] = true
	return false
}

func (ev *Evaluator) inProgressClear(intentID int64) {
	ev.mu.Lock()
	defer ev.mu.Unlock()
	delete(ev.inProgress, intentID)
}
