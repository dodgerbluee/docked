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
	"log/slog"
	"strings"
	"time"

	"github.com/dockedapp/backend/internal/db"
	"github.com/dockedapp/backend/internal/domain"
)

// ContainerToRow converts a live runner container into a db.ContainerRow.
func ContainerToRow(ctx context.Context, database *sql.DB, uid int64, rr db.RunnerRow, c domain.Container) db.ContainerRow {
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
	if c.ImageCreated > 0 {
		row.ImageCreatedDate = sql.NullString{
			String: time.Unix(c.ImageCreated, 0).UTC().Format("2006-01-02 15:04:05"),
			Valid:  true,
		}
	}
	now := time.Now().UTC().Format("2006-01-02 15:04:05")
	row.LastSeen = sql.NullString{String: now, Valid: true}
	row.CreatedAt = row.LastSeen

	registryData, err := db.GetRegistryData(ctx, database, uid, repo, tag)
	if err != nil {
		slog.Debug("live runner registry lookup failed", "image", c.Image, "error", err)
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
