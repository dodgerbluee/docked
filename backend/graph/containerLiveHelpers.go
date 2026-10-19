// Live runner-container helpers. Mirrors Node's appendRunnerContainers
// middleware: containers-table rows sourced from runners are treated as
// stale and replaced with fresh data fetched from each enabled runner,
// enriched with registry_image_versions rows from the shared DB. Runner
// fetch failures are non-fatal — the remaining containers are still served.
package graph

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"strings"
	"sync"
	"time"

	"github.com/dockedapp/backend/internal/db"
	"github.com/dockedapp/backend/internal/domain"
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
			fetched := make([]db.ContainerRow, 0, len(ctrs))
			for _, c := range ctrs {
				fetched = append(fetched, r.runnerContainerToRow(ctx, uid, rr, c))
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
	return append(base, live...)
}

// runnerContainerToRow converts a live runner container into the DB-row shape
// consumed by containerRowToModel/imageInfoFromRow, joining registry data from
// registry_image_versions the same way the SQL containersQuery does.
func (r *Resolver) runnerContainerToRow(ctx context.Context, uid int64, rr db.RunnerRow, c domain.Container) db.ContainerRow {
	repo, tag := splitImageRepoTag(c.Image)

	row := db.ContainerRow{
		ContainerID:     c.ID,
		ContainerName:   c.Name,
		ImageName:       sqlNullStr(c.Image),
		ImageRepo:       sqlNullStr(repo),
		ImageTag:        sqlNullStr(tag),
		Status:          sqlNullStr(c.Status),
		State:           sqlNullStr(c.State),
		StackName:       sqlNullStrPtr(c.StackName),
		RunnerID:        sql.NullInt64{Int64: rr.ID, Valid: true},
		RunnerName:      sqlNullStr(rr.Name),
		RunnerURL:       sqlNullStr(rr.URL),
		UsesNetworkMode: c.UsesNetworkMode,
		ProvidesNetwork: c.ProvidesNetwork,
		CurrentDigest:   sqlNullStrPtr(c.CurrentDigest),
		NoDigest:        c.NoDigest,
	}
	if len(c.RepoDigests) > 0 {
		if encoded, err := json.Marshal(c.RepoDigests); err == nil {
			row.RepoDigests = sql.NullString{String: string(encoded), Valid: true}
		}
	}
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	row.LastSeen = sql.NullString{String: now, Valid: true}
	row.CreatedAt = row.LastSeen

	registryData, err := db.GetRegistryData(ctx, r.DB, uid, repo, tag)
	if err != nil {
		log.Printf("live runner registry lookup failed (image %s): %v", c.Image, err)
		return row
	}
	row.LatestDigest = registryData.LatestDigest
	row.LatestVersion = registryData.LatestVersion
	row.LatestTag = registryData.LatestTag
	row.LatestPublishDate = registryData.LatestPublishDate
	row.Provider = registryData.Provider
	row.LastChecked = registryData.LastChecked
	return row
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
			row := r.runnerContainerToRow(ctx, uid, *rr, c)
			return &row
		}
	}
	return nil
}

// dockerIDMatches accepts an exact id or a 12-char short-id match in either
// direction, mirroring the lenient matching Node's container routes use.
func dockerIDMatches(liveID, requestedID string) bool {
	if liveID == requestedID {
		return true
	}
	if len(liveID) >= 12 && strings.HasPrefix(liveID, requestedID) {
		return true
	}
	if len(requestedID) >= 12 && strings.HasPrefix(requestedID, liveID) {
		return true
	}
	return false
}

// splitImageRepoTag splits "repo/image:tag" into (repo, tag); an untagged
// image defaults to "latest". Digest suffixes (@sha256:...) are stripped.
func splitImageRepoTag(image string) (repo, tag string) {
	if idx := strings.Index(image, "@"); idx >= 0 {
		image = image[:idx]
	}
	if idx := strings.LastIndex(image, ":"); idx >= 0 {
		return image[:idx], image[idx+1:]
	}
	return image, "latest"
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
