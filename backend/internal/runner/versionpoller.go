// Runner version poller: hourly background job that fetches the latest
// dockhand release once, pings every enabled runner, and persists version +
// docker status so the UI update badge works without a manual health check.
// Faithful port of Node's services/runnerVersionPoller.js, including the
// per-runner consecutive-failure backoff (after 3 failures, ping only every
// 3rd poll) and the every-6th-poll event pruning.
package runner

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/dockedapp/backend/internal/db"
)

const (
	versionPollInterval      = time.Hour
	maxConsecutiveFailures   = 3
	versionBackoffMultiplier = 3
	versionEventPruneEvery   = 6
	versionEventsKeep        = 200
)

// VersionPoller holds the in-memory backoff state (per-runner consecutive
// failure counts) that the heartbeat handler can reset when a runner's URL
// changes — the same trick Node's resetRunnerBackoff hook used via the bridge.
type VersionPoller struct {
	database *sql.DB
	client   *Client

	mu        sync.Mutex
	failures  map[int64]int
	pollCount int
}

func NewVersionPoller(database *sql.DB) *VersionPoller {
	return &VersionPoller{database: database, client: New(), failures: map[int64]int{}}
}

// ResetBackoff clears the failure count for a runner so the next poll
// attempts it immediately. Safe on a nil receiver (poller disabled).
func (p *VersionPoller) ResetBackoff(runnerID int64) {
	if p == nil {
		return
	}
	p.mu.Lock()
	delete(p.failures, runnerID)
	p.mu.Unlock()
}

// Start runs one poll immediately, then on a fixed hourly interval until ctx
// ends. Mirrors Node's startVersionPoller.
func (p *VersionPoller) Start(ctx context.Context) {
	p.poll(ctx)
	ticker := time.NewTicker(versionPollInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			p.poll(ctx)
		}
	}
}

func (p *VersionPoller) poll(ctx context.Context) {
	p.mu.Lock()
	p.pollCount++
	round := p.pollCount
	p.mu.Unlock()

	runners, err := db.GetAllEnabledRunners(ctx, p.database)
	if err != nil {
		slog.Warn("runnerVersionPoller: could not load runners", "error", err)
		return
	}
	if len(runners) == 0 {
		return
	}

	// Fetch latest GitHub release once for all runners.
	var latestVersion string
	latestFetched := false
	if tag, ok := LatestReleaseTag(ctx, DockhandRepo, false); ok {
		latestVersion, latestFetched = tag, true
	}

	var wg sync.WaitGroup
	for _, rn := range runners {
		wg.Add(1)
		go func(rn db.RunnerRow) {
			defer wg.Done()
			p.pollRunner(ctx, rn, latestVersion, latestFetched)
		}(rn)
	}
	wg.Wait()

	slog.Debug("runnerVersionPoller: version check complete",
		"runners", len(runners), "latestVersion", latestVersion)

	// Periodically prune old events (every 6th poll = ~6 hours).
	if round%versionEventPruneEvery == 0 {
		if _, err := db.PruneRunnerEvents(ctx, p.database, versionEventsKeep); err != nil {
			slog.Warn("runnerVersionPoller: event pruning failed", "error", err)
		}
	}
}

func (p *VersionPoller) pollRunner(ctx context.Context, rn db.RunnerRow, latestVersion string, latestFetched bool) {
	keepLatest := rn.LatestVersion.String
	keepVersion := rn.Version.String

	// Backoff: after MAX_CONSECUTIVE_FAILURES, only attempt every
	// BACKOFF_MULTIPLIER polls — but still refresh latest_version from GitHub.
	p.mu.Lock()
	failures := p.failures[rn.ID]
	p.mu.Unlock()
	if failures >= maxConsecutiveFailures && p.currentRound()%versionBackoffMultiplier != 0 {
		latest := keepLatest
		if latestFetched {
			latest = latestVersion
		}
		if err := db.UpdateRunnerVersion(ctx, p.database, rn.ID, rn.UserID,
			nullStr(keepVersion), nullStr(latest), nil); err != nil {
			slog.Warn("runnerVersionPoller: DB update failed", "runnerID", rn.ID, "error", err)
		}
		return
	}

	runningVersion := keepVersion // offline keeps the stored value (Node parity)
	var dockerEnabled *bool       // nil = offline / unknown, keep existing DB value

	health, err := p.client.Ping(ctx, rn.URL, rn.APIKey)
	if err == nil {
		if health.Version != nil {
			runningVersion = *health.Version
		}
		// dockerOk present on dockhand >= the Docker-management release; older
		// runners omit it — treat missing the same as true (parity with the
		// JS `health.dockerOk !== false`).
		enabled := health.DockerOK == nil || *health.DockerOK
		dockerEnabled = &enabled

		if err := db.UpdateRunnerLastSeen(ctx, p.database, rn.ID); err != nil {
			slog.Warn("runnerVersionPoller: last_seen update failed", "runnerID", rn.ID, "error", err)
		}

		dockerStatus := "ok"
		if health.DockerOK != nil && !*health.DockerOK {
			dockerStatus = "unavailable"
		}
		changed, derr := db.UpdateRunnerDockerStatus(ctx, p.database, rn.ID, dockerStatus)
		if derr == nil && changed {
			from := "unknown"
			if rn.DockerStatus.Valid {
				from = rn.DockerStatus.String
			}
			details, _ := json.Marshal(map[string]any{"from": from, "to": dockerStatus})
			_ = db.InsertRunnerEvent(ctx, p.database, rn.ID, db.EventDockerChange,
				`Docker status changed to "`+dockerStatus+`" (via poller)`, string(details))
		}

		if runningVersion != "" && keepVersion != "" && runningVersion != keepVersion {
			details, _ := json.Marshal(map[string]any{"from": keepVersion, "to": runningVersion})
			_ = db.InsertRunnerEvent(ctx, p.database, rn.ID, db.EventVersionChange,
				"Version changed: "+keepVersion+" → "+runningVersion, string(details))
		}

		p.mu.Lock()
		p.failures[rn.ID] = 0
		p.mu.Unlock()
	} else {
		// Runner offline — increment failure count.
		p.mu.Lock()
		p.failures[rn.ID] = failures + 1
		newFailures := failures + 1
		p.mu.Unlock()

		// Log health check error on first failure or when entering backoff.
		if failures == 0 || newFailures == maxConsecutiveFailures {
			msg := "Runner unreachable (poller)"
			if newFailures == maxConsecutiveFailures {
				msg = "Runner unreachable — entering backoff after 3 consecutive failures"
			}
			details, _ := json.Marshal(map[string]any{"consecutiveFailures": newFailures})
			_ = db.InsertRunnerEvent(ctx, p.database, rn.ID, db.EventHealthCheckError, msg, string(details))
		}
	}

	latest := keepLatest
	if latestFetched {
		latest = latestVersion
	}
	if err := db.UpdateRunnerVersion(ctx, p.database, rn.ID, rn.UserID,
		nullStr(runningVersion), nullStr(latest), dockerEnabled); err != nil {
		slog.Warn("runnerVersionPoller: DB update failed", "runnerID", rn.ID, "error", err)
	}
}

func (p *VersionPoller) currentRound() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.pollCount
}

func nullStr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
