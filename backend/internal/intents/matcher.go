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

	live := fetchLiveRunnerContainers(ctx, database, userID, runners)

	// Runner-backed DB rows are superseded by the live fetch (they are
	// persisted during scans and would duplicate/stale-out the live data).
	all := make([]db.ContainerRow, 0, len(dbContainers)+len(live))
	for _, c := range dbContainers {
		if c.RunnerID.Valid {
			continue
		}
		all = append(all, c)
	}
	all = append(all, live...)

	sourceURLs := make(map[int64]string, len(sourceInstances))
	for _, inst := range sourceInstances {
		sourceURLs[inst.ID] = inst.URL
	}
	knownRunners := make(map[int64]bool, len(runners))
	for _, rr := range runners {
		knownRunners[rr.ID] = true
	}

	out := &MatchOutcome{}
	for _, c := range all {
		if requireUpdate && !db.ContainerHasUpdate(c) {
			continue
		}
		if !db.IntentMatchesInclusion(c, matchC, matchI, matchS, matchSt, matchR) {
			continue
		}
		reason := db.IntentExclusionReason(c, exC, exI, exSt, exR)
		if reason != "" {
			if trackExcluded && enrichHasSource(c, sourceURLs, knownRunners) {
				out.Excluded = append(out.Excluded, ExcludedMatch{Container: c, Reason: reason})
			}
			continue
		}
		if !enrichHasSource(c, sourceURLs, knownRunners) {
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
// is converted to the DB-row shape with registry data joined.
func fetchLiveRunnerContainers(ctx context.Context, database *sql.DB, userID int64, runners []db.RunnerRow) []db.ContainerRow {
	var mu sync.Mutex
	var out []db.ContainerRow
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
			fetched := runner.FetchContainerRows(ctx, database, userID, rr, ctrs)
			mu.Lock()
			out = append(out, fetched...)
			mu.Unlock()
		}(rr)
	}
	wg.Wait()
	return out
}
