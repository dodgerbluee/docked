// Intent matching engine — port of Node's services/intents/matchingEngine.js.
// Matches DB-persisted containers (Portainer-era rows, kept for parity) plus
// live-fetched runner containers against the intent's inclusion/exclusion
// globs. Only containers with an available update are eligible when
// requireUpdate is set; inclusion criteria are AND-ed, exclusions filter out
// inclusion matches afterwards.
package intents

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"sync"

	"github.com/dockedapp/backend/internal/db"
	"github.com/dockedapp/backend/internal/runner"
)

// ExcludedMatch is an inclusion match that hit an exclusion criterion
// (previewIntent's excludedContainers).
type ExcludedMatch struct {
	Container db.ContainerRow
	Reason    string
}

// MatchOutcome is findMatchingContainers' result: with trackExcluded the
// excluded list is populated, otherwise it stays empty.
type MatchOutcome struct {
	Matched  []db.ContainerRow
	Excluded []ExcludedMatch
}

// FindMatchingContainers evaluates the intent against all candidate
// containers for the user.
func FindMatchingContainers(ctx context.Context, database *sql.DB, intent *db.IntentRow, userID int64, requireUpdate, trackExcluded bool) (*MatchOutcome, error) {
	// Fail closed before anything is matched. A stored value that is not a
	// JSON array decodes as "unset", which deactivates that dimension - so a
	// corrupt exclude list would silently stop excluding, and the intent would
	// upgrade containers the user had explicitly ruled out.
	if err := db.IntentFilterError(intent); err != nil {
		return nil, fmt.Errorf("intent %d: %w", intent.ID, err)
	}

	matchC := db.UnmarshalStringArr(intent.MatchContainers)
	matchI := db.UnmarshalStringArr(intent.MatchImages)
	matchS := db.UnmarshalStringArr(intent.MatchSources)
	matchSt := db.UnmarshalStringArr(intent.MatchStacks)
	matchR := db.UnmarshalStringArr(intent.MatchRegistries)
	exC := db.UnmarshalStringArr(intent.ExcludeContainers)
	exI := db.UnmarshalStringArr(intent.ExcludeImages)
	exSt := db.UnmarshalStringArr(intent.ExcludeStacks)
	exR := db.UnmarshalStringArr(intent.ExcludeRegistries)

	dbContainers, err := db.GetContainers(ctx, database, userID)
	if err != nil {
		return nil, err
	}
	sourceInstances, err := db.GetAllSourceInstances(ctx, database, userID)
	if err != nil {
		// Node logs and continues with an empty map.
		slog.Warn("intent matching: source instances lookup failed", "error", err)
		sourceInstances = nil
	}
	runners, err := db.GetAllRunners(ctx, database, userID)
	if err != nil {
		return nil, err
	}

	live, reached := fetchLiveRunnerContainers(ctx, database, userID, runners)

	// Runner-backed DB rows are superseded by the live fetch (they are
	// persisted during scans and would duplicate/stale-out the live data) -
	// but only for runners the fetch actually reached. Dropping every
	// runner-backed row meant a runner that was briefly unreachable vanished
	// from the policy entirely, so its containers were neither upgraded nor
	// reported. Stale beats missing, like the container-list merge does.
	all := make([]db.ContainerRow, 0, len(dbContainers)+len(live))
	for _, c := range dbContainers {
		if c.RunnerID.Valid && reached[c.RunnerID.Int64] {
			continue
		}
		all = append(all, c)
	}
	// The live row wholly replaces the persisted one, so carry each persisted
	// row's deploy-time digest onto its live counterpart when the live inspect
	// reported none. Without that, a container whose image carries no registry
	// digest stops matching a requireUpdate policy that was matching it, and
	// the intent quietly stops covering it.
	db.CarryDigestBaselines(dbContainers, live)
	all = append(all, live...)

	sourceURLs := make(map[int64]string, len(sourceInstances))
	for _, inst := range sourceInstances {
		sourceURLs[inst.ID] = inst.URL
	}
	enabledRunners := make(map[int64]bool, len(runners))
	for _, rr := range runners {
		// Only an enabled runner can carry out an upgrade. A container on a
		// disabled runner used to match, get counted in the execution, and
		// then fail for a reason the policy could have seen up front.
		if rr.Enabled {
			enabledRunners[rr.ID] = true
		}
	}

	out := &MatchOutcome{}
	for _, c := range all {
		// Source-backed (retired Portainer) rows survive only for history:
		// nothing can upgrade them any more, so matching one guaranteed a
		// failed container in every run.
		if c.SourceInstanceID.Valid {
			continue
		}
		if requireUpdate && !db.ContainerHasUpdate(c) {
			continue
		}
		if !db.IntentMatchesInclusion(c, matchC, matchI, matchS, matchSt, matchR) {
			continue
		}
		reason := db.IntentExclusionReason(c, exC, exI, exSt, exR)
		if reason != "" {
			if trackExcluded && enrichHasSource(c, sourceURLs, enabledRunners) {
				out.Excluded = append(out.Excluded, ExcludedMatch{Container: c, Reason: reason})
			}
			continue
		}
		if !enrichHasSource(c, sourceURLs, enabledRunners) {
			continue
		}
		out.Matched = append(out.Matched, c)
	}

	slog.Info("intent matching complete",
		"intentId", intent.ID, "intentName", intent.Name,
		"totalContainers", len(all), "matchedContainers", len(out.Matched),
		"excludedContainers", len(out.Excluded),
		"requireUpdate", requireUpdate, "trackExcluded", trackExcluded)
	return out, nil
}

// enrichHasSource mirrors enrichContainerWithSource's skip semantics: a
// container whose source instance or runner is unknown (or that has neither)
// is dropped from matching. The URL itself is already carried on the row.
func enrichHasSource(c db.ContainerRow, sourceURLs map[int64]string, knownRunners map[int64]bool) bool {
	if c.SourceInstanceID.Valid {
		if _, ok := sourceURLs[c.SourceInstanceID.Int64]; !ok {
			slog.Warn("intent matching: skipping container with unknown source instance",
				"containerId", c.ContainerID, "containerName", c.ContainerName,
				"sourceInstanceId", c.SourceInstanceID.Int64)
			return false
		}
		return true
	}
	if c.RunnerID.Valid {
		if !knownRunners[c.RunnerID.Int64] {
			slog.Warn("intent matching: skipping container with unknown runner",
				"containerId", c.ContainerID, "containerName", c.ContainerName,
				"runnerId", c.RunnerID.Int64)
			return false
		}
		return true
	}
	slog.Warn("intent matching: skipping container with no source instance or runner",
		"containerId", c.ContainerID, "containerName", c.ContainerName)
	return false
}

// fetchLiveRunnerContainers mirrors getContainersFromRunners: only enabled
// runners are fetched, individual failures are non-fatal, and each container
// is converted to the DB-row shape with registry data joined. It also reports
// which runners were reached, so the caller can tell "no such container" from
// "could not look".
func fetchLiveRunnerContainers(ctx context.Context, database *sql.DB, userID int64, runners []db.RunnerRow) ([]db.ContainerRow, map[int64]bool) {
	var mu sync.Mutex
	var out []db.ContainerRow
	reached := make(map[int64]bool)
	var wg sync.WaitGroup
	for _, rr := range runners {
		if !rr.Enabled {
			continue
		}
		wg.Add(1)
		go func(rr db.RunnerRow) {
			defer wg.Done()
			ctrs, err := runner.FetchContainers(ctx, rr)
			if err != nil {
				slog.Warn("intent matching: runner container fetch failed",
					"runnerId", rr.ID, "runnerName", rr.Name, "error", err)
				return
			}
			fetched, ferr := runner.FetchContainerRows(ctx, database, userID, rr, ctrs)
			if ferr != nil {
				// Not marked as reached, so this runner's persisted rows are
				// kept: unenriched live rows would drop the update state the
				// scan confirmed and make a requireUpdate intent stop matching
				// containers it was upgrading.
				slog.Warn("intent matching: runner registry enrichment failed",
					"runnerId", rr.ID, "runnerName", rr.Name, "error", ferr)
				return
			}
			mu.Lock()
			reached[rr.ID] = true
			out = append(out, fetched...)
			mu.Unlock()
		}(rr)
	}
	wg.Wait()
	return out, reached
}
