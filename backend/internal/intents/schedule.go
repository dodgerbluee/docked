// Package intents ports Node's services/intents engine: the matching engine
// (live runner + DB containers against intent criteria), the stack-aware
// upgrade executor, and the 60s scheduled/immediate evaluator loop.
package intents

import (
	"strings"
	"time"

	cron "github.com/robfig/cron/v3"

	"github.com/dockedapp/backend/internal/db"
)

// DueResult mirrors scheduleEvaluator.isIntentDue's return shape.
type DueResult struct {
	IsDue       bool
	Reason      string
	TriggerTime *time.Time
	// Legacy marks the "fire now because last_evaluated_at is missing or
	// unparseable" paths, where TriggerTime is wall-clock rather than a
	// real cron point. The evaluator buckets those claims so concurrent
	// processes compute the SAME claim key and only one of them wins.
	Legacy bool
}

// parseCron accepts the 5-field standard form (plus @descriptors) and the
// 6-field seconds form, matching croner's grammar used Node-side.
func parseCron(expr string) (cron.Schedule, error) {
	expr = strings.TrimSpace(expr)
	if s, err := cron.ParseStandard(expr); err == nil {
		return s, nil
	}
	p := cron.NewParser(cron.Second | cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow)
	return p.Parse(expr)
}

// IsIntentDue reports whether a scheduled intent has an unprocessed cron
// trigger point: nextRun(last_evaluated_at) <= now. The trigger time is the
// cron point itself (never wall-clock) so the same point can never fire
// twice — Node's core scheduling invariant.
func IsIntentDue(intent *db.IntentRow, now time.Time) DueResult {
	if intent.ScheduleType == "immediate" {
		return DueResult{Reason: "immediate schedule type"}
	}
	expr := strings.TrimSpace(intent.ScheduleCron.String)
	if expr == "" {
		return DueResult{Reason: "no cron expression"}
	}
	sched, err := parseCron(expr)
	if err != nil {
		return DueResult{Reason: "invalid cron: " + err.Error()}
	}
	// A cron expression fires on the wall clock of the intent's own zone when
	// it has one, the server's zone otherwise (that is what the pre-Go engine
	// did, so existing intents keep firing at the same local time). cron.Next
	// reads the calendar fields of the instant it is handed, so shifting the
	// reference instant into the zone is all that is needed; the returned time
	// is still an absolute instant.
	loc := time.Local
	if tz := strings.TrimSpace(intent.ScheduleTimezone.String); intent.ScheduleTimezone.Valid && tz != "" {
		l, lerr := time.LoadLocation(tz)
		if lerr != nil {
			return DueResult{Reason: "unknown schedule timezone: " + tz}
		}
		loc = l
	}

	lastEvalStr := strings.TrimSpace(intent.LastEvaluatedAt.String)
	if intent.LastEvaluatedAt.Valid && lastEvalStr != "" {
		lastEval, perr := db.ParseSQLiteTime(lastEvalStr)
		if perr != nil {
			// Unparseable legacy value — treat like the missing case so the
			// intent doesn't get stuck forever.
			return DueResult{IsDue: true, TriggerTime: &now, Legacy: true, Reason: "unparseable last_evaluated_at (legacy)"}
		}
		next := sched.Next(lastEval.In(loc))
		// Coalesce missed points. A cron finer than the 60s evaluation tick
		// advanced last_evaluated_at by a single point per tick and never
		// caught up, so the intent read as permanently due and ran back to
		// back forever. Only the most recent missed point fires.
		latest := next
		for i := 0; !latest.IsZero() && i < 1000; i++ {
			follow := sched.Next(latest.In(loc))
			if follow.IsZero() || follow.After(now) {
				break
			}
			latest = follow
		}
		if !latest.IsZero() && !latest.After(now) {
			return DueResult{IsDue: true, TriggerTime: &latest, Reason: "cron triggered at " + latest.UTC().Format(isoMillis)}
		}
		return DueResult{Reason: "not yet due"}
	}

	// Never evaluated (legacy/migration edge case) — treat as due.
	return DueResult{IsDue: true, TriggerTime: &now, Legacy: true, Reason: "missing last_evaluated_at (legacy)"}
}

// isoMillis is Node's Date.toISOString() layout.
const isoMillis = "2006-01-02T15:04:05.000Z"
