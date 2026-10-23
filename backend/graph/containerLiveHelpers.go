// Live runner-container helpers. Mirrors Node's appendRunnerContainers
// middleware: containers-table rows sourced from runners are treated as
// stale and replaced with fresh data fetched from each enabled runner,
// enriched with registry_image_versions rows from the shared DB. Runner
// fetch failures are non-fatal — the remaining containers are still served.
package graph

import (
	"context"
	"database/sql"
	"log"
	"sort"
	"strconv"
	"strings"
	"sync"

	"github.com/dockedapp/backend/internal/db"
	"github.com/dockedapp/backend/internal/domain"
	"github.com/dockedapp/backend/internal/registry"
	"github.com/dockedapp/backend/internal/runner"
)

// mergeLiveRunnerContainers returns rows with runner-sourced entries replaced
// by live-fetched synthetic rows (RunnerID set, registry data joined from the
// DB) for every runner we reached successfully. Rows belonging to runners whose
// live fetch failed are kept as-is (stale beats missing). Portainer-backed
// rows pass through untouched.
func (r *Resolver) mergeLiveRunnerContainers(ctx context.Context, uid int64, rows []db.ContainerRow) []db.ContainerRow {
	runners, err := db.GetEnabledRunners(ctx, r.DB, uid)
	if err != nil {
		log.Printf("live runner merge: enabled runners: %v", err)
		return rows
	}
	if len(runners) == 0 {
		return rows
	}

	var mu sync.Mutex
	live := make([]db.ContainerRow, 0)
	reached := make(map[int64]bool)
	var wg sync.WaitGroup
	for _, rr := range runners {
		wg.Add(1)
		go func(rr db.RunnerRow) {
			defer wg.Done()
			ctrs, err := runner.FetchContainers(ctx, rr)
			if err != nil {
				log.Printf("live runner fetch failed (runner %s): %v", rr.Name, err)
				return
			}
			fetched, ferr := runner.FetchContainerRows(ctx, r.DB, uid, rr, ctrs)
			if ferr != nil {
				// Not marked as reached, so this runner's persisted rows are
				// kept rather than replaced by rows with no registry data.
				log.Printf("live runner merge failed (runner %s): %v", rr.Name, ferr)
				return
			}
			mu.Lock()
			reached[rr.ID] = true
			live = append(live, fetched...)
			mu.Unlock()
		}(rr)
	}
	wg.Wait()

	base := make([]db.ContainerRow, 0, len(rows))
	for _, row := range rows {
		if row.RunnerID.Valid && reached[row.RunnerID.Int64] {
			continue // replaced by live data
		}
		base = append(base, row)
	}
	// The live row wholly replaces the persisted one, so a container whose
	// inspect reports no current digest (image pulled without a registry
	// digest, runner that reports no repo digests) loses the deploy-time
	// baseline the scan had stored - and with it the only value the update
	// check had to compare against, hiding an update that was already known.
	db.CarryDigestBaselines(rows, live)
	// Live rows arrive in goroutine-completion order; sort deterministically
	// so paginated requests see a stable sequence (offsets mean the same
	// thing across pages).
	sort.Slice(live, func(i, j int) bool {
		a, b := live[i], live[j]
		if a.RunnerID.Int64 != b.RunnerID.Int64 {
			return a.RunnerID.Int64 < b.RunnerID.Int64
		}
		if a.ContainerName != b.ContainerName {
			return a.ContainerName < b.ContainerName
		}
		return a.ContainerID < b.ContainerID
	})
	return append(base, live...)
}

// liveRunnerContainerByDockerID resolves a synthetic "live-<dockerID>" model
// id (runner containers that never got a DB row) by searching the user's
// enabled runners. Docker ids are not globally unique across runners; the
// first enabled runner holding the container wins, mirroring how the ids
// were minted in containerRowToModel.
func (r *Resolver) liveRunnerContainerByDockerID(ctx context.Context, uid int64, dockerID string) *db.ContainerRow {
	runners, err := db.GetEnabledRunners(ctx, r.DB, uid)
	if err != nil {
		log.Printf("live container lookup: enabled runners: %v", err)
		return nil
	}
	for _, rr := range runners {
		if row := r.liveRunnerContainer(ctx, uid, rr.ID, dockerID); row != nil {
			return row
		}
	}
	return nil
}

// runnerContainersForRunner returns one runner's containers: the live fetch
// replaces persisted rows when the runner is reachable (same stale-beats-
// missing rule as the global merge), with a deterministic order so
// pagination cursors stay meaningful.
func (r *Resolver) runnerContainersForRunner(ctx context.Context, uid, rid int64) ([]db.ContainerRow, error) {
	rows, err := db.GetContainersByRunner(ctx, r.DB, uid, rid)
	if err != nil {
		return nil, err
	}
	rr, err := db.GetRunnerByID(ctx, r.DB, rid, uid)
	if err != nil || rr == nil || !rr.Enabled {
		return rows, nil
	}
	ctrs, err := runner.FetchContainers(ctx, *rr)
	if err != nil {
		log.Printf("live runner fetch failed (runner %s): %v", rr.Name, err)
		return rows, nil
	}
	live, ferr := runner.FetchContainerRows(ctx, r.DB, uid, *rr, ctrs)
	if ferr != nil {
		// Keep the persisted rows: replacing them with unenriched live rows
		// would drop the update state the scan had already confirmed.
		log.Printf("live runner fetch failed (runner %s): %v", rr.Name, ferr)
		return rows, nil
	}
	db.CarryDigestBaselines(rows, live)
	sort.Slice(live, func(i, j int) bool {
		if live[i].ContainerName != live[j].ContainerName {
			return live[i].ContainerName < live[j].ContainerName
		}
		return live[i].ContainerID < live[j].ContainerID
	})
	return live, nil
}

// runnerContainerToRow converts a live runner container into the DB-row shape
// consumed by containerRowToModel/imageInfoFromRow. The conversion itself
// lives in internal/runner (shared with the intents matching engine).
func (r *Resolver) runnerContainerToRow(ctx context.Context, uid int64, rr db.RunnerRow, c domain.Container) db.ContainerRow {
	return runner.ContainerToRow(ctx, r.DB, uid, rr, c)
}

// liveRunnerContainer resolves a container directly from a runner when the
// containers table has no row for it (runner containers are only persisted on
// upgrade, so never-upgraded containers exist solely on the runner). Returns
// nil when the runner is unreachable or the container is not on it.
func (r *Resolver) liveRunnerContainer(ctx context.Context, uid int64, runnerID int64, dockerContainerID string) *db.ContainerRow {
	rr, err := db.GetRunnerByID(ctx, r.DB, runnerID, uid)
	if err != nil || rr == nil {
		return nil
	}
	ctrs, err := runner.FetchContainers(ctx, *rr)
	if err != nil {
		log.Printf("live runner lookup failed (runner %s): %v", rr.Name, err)
		return nil
	}
	for _, c := range ctrs {
		if dockerIDMatches(c.ID, dockerContainerID) {
			rows := []db.ContainerRow{r.runnerContainerToRow(ctx, uid, *rr, c)}
			// Same baseline rule as the list merge: callers use this row in
			// place of the persisted one, so a live inspect that reports no
			// digest must not discard the deploy-time value the scan stored.
			if persisted, perr := db.GetContainersByRunner(ctx, r.DB, uid, runnerID); perr == nil {
				db.CarryDigestBaselines(persisted, rows)
			} else {
				log.Printf("live container lookup: persisted rows for runner %d: %v", runnerID, perr)
			}
			return &rows[0]
		}
	}
	return nil
}

// dockerIDMatches accepts an exact id or a short-id match in either
// direction, mirroring the lenient matching Node's container routes use.
// The shorter side must be at least 12 chars: a bare "0" or other trivial
// prefix must never resolve to an arbitrary container.
func dockerIDMatches(liveID, requestedID string) bool {
	if liveID == requestedID {
		return true
	}
	if len(requestedID) >= 12 && len(liveID) >= len(requestedID) && strings.HasPrefix(liveID, requestedID) {
		return true
	}
	if len(liveID) >= 12 && len(requestedID) >= len(liveID) && strings.HasPrefix(requestedID, liveID) {
		return true
	}
	return false
}

// splitImageRepoTag delegates to the one canonical splitter so registry
// ports (localhost:5000/app) are never mistaken for tags.
func splitImageRepoTag(image string) (repo, tag string) {
	return registry.SplitRepoTag(image)
}

func sqlNullStr(s string) sql.NullString {
	return sql.NullString{String: s, Valid: s != ""}
}

func sqlNullStrPtr(s *string) sql.NullString {
	if s == nil {
		return sql.NullString{}
	}
	return sql.NullString{String: *s, Valid: *s != ""}
}

// containerIdentityKey keys a container row by what it IS, not by its
// (possibly synthetic) row ID: live-merged runner rows all carry ID 0, so
// an ID-keyed dedup would collapse them into one entry.
func containerIdentityKey(row *db.ContainerRow) string {
	return strconv.FormatInt(row.RunnerID.Int64, 10) + "|" + strconv.FormatInt(row.EndpointID.Int64, 10) + "|" + row.ContainerID
}

// dedupeContainerRows collapses join duplicates (a container matching more
// than one registry_image_versions row) to one row per container, keeping a
// flagged row over an unflagged one so update counts and lists agree: if ANY
// join row for a container says an update is available, the container is
// shown and counted as updatable.
func dedupeContainerRows(rows []db.ContainerRow) []db.ContainerRow {
	out := make([]db.ContainerRow, 0, len(rows))
	index := make(map[string]int, len(rows))
	for i := range rows {
		key := containerIdentityKey(&rows[i])
		if at, ok := index[key]; ok {
			if db.ContainerHasUpdate(rows[i]) && !db.ContainerHasUpdate(out[at]) {
				out[at] = rows[i]
			}
			continue
		}
		index[key] = len(out)
		out = append(out, rows[i])
	}
	return out
}
