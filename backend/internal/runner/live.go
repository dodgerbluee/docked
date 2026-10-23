// Live runner-container conversion shared between the GraphQL container-list
// merge (graph/containerLiveHelpers.go) and the intents matching engine.
// Converts a live runner container into the DB-row shape consumed by
// containerRowToModel/imageInfoFromRow, joining registry data from
// registry_image_versions the same way the SQL containersQuery does.
package runner

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/dockedapp/backend/internal/db"
	"github.com/dockedapp/backend/internal/domain"
	reg "github.com/dockedapp/backend/internal/registry"
)

// ContainerToRow converts a live runner container into a db.ContainerRow.
func ContainerToRow(ctx context.Context, database *sql.DB, uid int64, rr db.RunnerRow, c domain.Container) db.ContainerRow {
	row := containerRowBase(rr, c)
	repo, tag := splitImageRepoTag(resolveImageReference(c))
	registryData, err := db.GetRegistryData(ctx, database, uid, repo, tag)
	if err != nil {
		slog.Debug("live runner registry lookup failed", "image", c.Image, "error", err)
		return row
	}
	applyRegistryData(&row, registryData)
	return row
}

// FetchContainerRows converts a batch of live runner containers for one
// runner, loading the user's registry_image_versions rows once instead of
// one GetRegistryData per container — the per-container lookup was an N+1
// on every live container listing and intent match.
//
// A failed registry load is returned as an error rather than answered with an
// unenriched batch: callers replace the persisted rows with the live ones for
// any runner this returns rows for, so rows without their registry columns
// would strip updates the scan had already confirmed. Reporting it lets the
// caller keep the persisted rows instead (stale beats missing).
func FetchContainerRows(ctx context.Context, database *sql.DB, uid int64, rr db.RunnerRow, ctrs []domain.Container) ([]db.ContainerRow, error) {
	registry, err := db.GetRegistryDataMap(ctx, database, uid)
	if err != nil {
		return nil, fmt.Errorf("load registry data for runner %s: %w", rr.Name, err)
	}
	out := make([]db.ContainerRow, 0, len(ctrs))
	for _, c := range ctrs {
		row := containerRowBase(rr, c)
		if d := registry.Get(splitImageRepoTag(resolveImageReference(c))); d != nil {
			applyRegistryData(&row, d)
		}
		out = append(out, row)
	}
	return out, nil
}

// applyRegistryData copies the joined registry columns onto a converted row.
func applyRegistryData(row *db.ContainerRow, d *db.RegistryData) {
	row.LatestDigest = d.LatestDigest
	row.LatestVersion = d.LatestVersion
	row.LatestTag = d.LatestTag
	row.LatestPublishDate = d.LatestPublishDate
	row.Provider = d.Provider
	row.LastChecked = d.LastChecked
	// Registry stays the image-prefix HOST value: registry_data.provider is a
	// different vocabulary (dockerhub/ghcr/...), and intent registry filters
	// glob against host vocabulary (docker.io/ghcr.io/...) like persisted rows.
}

// resolveImageReference recovers the user-visible image reference for a
// container whose Config.Image Docker reports as a bare image ID. The upgrade
// pipeline recreates a dependent from the resolved image ID, so its
// Config.Image becomes "sha256:<id>" and SplitRepoTag parses that as a bogus
// "sha256" repo: the registry lookup misses, and because a live row replaces
// the inventory row for a reachable runner, the container silently stops
// showing updates that were already confirmed for it.
//
// Same preference order as the scan path (imagesync.runner): the
// docked.original_image label the pipeline stamped, then any
// repository-qualified digest reference. A bare image ID never qualifies.
func resolveImageReference(c domain.Container) string {
	if !strings.HasPrefix(c.Image, "sha256:") {
		return c.Image
	}
	if ref := c.Labels[domain.OriginalImageLabel]; ref != "" && domain.RepoQualifiedDigest(ref) >= 0 {
		return ref
	}
	if ref := c.Labels[domain.OriginalImageLabel]; ref != "" && !strings.HasPrefix(ref, "sha256:") {
		return ref
	}
	for _, repoDigest := range c.RepoDigests {
		if domain.RepoQualifiedDigest(repoDigest) >= 0 {
			return repoDigest
		}
	}
	return c.Image
}

// containerRowBase builds the registry-free part of the DB-row shape.
func containerRowBase(rr db.RunnerRow, c domain.Container) db.ContainerRow {
	image := resolveImageReference(c)
	repo, tag := splitImageRepoTag(image)

	row := db.ContainerRow{
		ContainerID:   c.ID,
		ContainerName: c.Name,
		ImageName:     sqlNullStr(image),
		ImageRepo:     sqlNullStr(repo),
		ImageTag:      sqlNullStr(tag),
		Status:        sqlNullStr(c.Status),
		State:         sqlNullStr(c.State),
		StackName:     sqlNullStrPtr(c.StackName),
		// Registry drives intent registry include/exclude matching; live
		// containers have no deployed_images row, so derive the registry HOST
		// from the image prefix — same vocabulary deployed_images.registry
		// stores (docker.io, ghcr.io, ...).
		Registry:        sqlNullStr(domain.RegistryFromImageRepo(repo)),
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
	if c.ImageCreated > 0 {
		row.ImageCreatedDate = sql.NullString{
			String: time.Unix(c.ImageCreated, 0).UTC().Format("2006-01-02 15:04:05"),
			Valid:  true,
		}
	}
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	row.LastSeen = sql.NullString{String: now, Valid: true}
	row.CreatedAt = row.LastSeen
	return row
}

// splitImageRepoTag delegates to the one canonical splitter so registry
// ports (localhost:5000/app) are never mistaken for tags.
func splitImageRepoTag(image string) (repo, tag string) {
	return reg.SplitRepoTag(image)
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
