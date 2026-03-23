package containers

import (
	"encoding/json"
	"log/slog"

	"github.com/dockedapp/backend/internal/db"
	"github.com/dockedapp/backend/internal/domain"
)

// toContainer maps a raw database row to the API domain type.
// It handles null coercion, source detection, RepoDigests JSON parsing,
// and hasUpdate computation.
func toContainer(row db.ContainerRow) domain.Container {
	container := domain.Container{
		ID:              row.ContainerID,
		Name:            row.ContainerName,
		Image:           row.ImageName.String,
		ImageRepo:       row.ImageRepo.String,
		Status:          row.Status.String,
		State:           row.State.String,
		UsesNetworkMode: row.UsesNetworkMode,
		ProvidesNetwork: row.ProvidesNetwork,
		NoDigest:        row.NoDigest,
		LastSeen:        row.LastSeen.String,
		CreatedAt:       row.CreatedAt.String,
	}

	if row.StackName.Valid && row.StackName.String != "" {
		container.StackName = &row.StackName.String
	}

	if row.CurrentDigest.Valid && row.CurrentDigest.String != "" {
		container.CurrentDigest = &row.CurrentDigest.String
	}

	if row.LatestDigest.Valid && row.LatestDigest.String != "" {
		container.LatestDigest = &row.LatestDigest.String
	}

	if row.LatestVersion.Valid && row.LatestVersion.String != "" {
		container.LatestVersion = &row.LatestVersion.String
	}

	if row.LatestTag.Valid && row.LatestTag.String != "" {
		container.LatestTag = &row.LatestTag.String
	}

	if row.LatestPublishDate.Valid && row.LatestPublishDate.String != "" {
		container.LatestPublishDate = &row.LatestPublishDate.String
	}

	if row.Provider.Valid && row.Provider.String != "" {
		container.Provider = &row.Provider.String
	}

	if row.LastChecked.Valid && row.LastChecked.String != "" {
		container.LastChecked = &row.LastChecked.String
	}

	// Source resolution: runner_id present → runner, otherwise portainer.
	if row.RunnerID.Valid {
		container.Source = "runner"
		container.RunnerID = &row.RunnerID.Int64
		if row.RunnerName.Valid && row.RunnerName.String != "" {
			container.RunnerName = &row.RunnerName.String
		}
	} else {
		container.Source = "portainer"
		if row.EndpointID.Valid {
			container.EndpointID = &row.EndpointID.Int64
		}
		if row.SourceName.Valid && row.SourceName.String != "" {
			container.SourceName = &row.SourceName.String
		}
		if row.SourceURL.Valid && row.SourceURL.String != "" {
			container.SourceURL = &row.SourceURL.String
		}
	}

	// Parse the JSON array of manifest-list digests stored as TEXT.
	container.RepoDigests = parseRepoDigests(row.RepoDigests.String)

	// Compute update status from parsed RepoDigests and the latest registry digest.
	container.HasUpdate = hasUpdate(container.RepoDigests, container.LatestDigest)

	return container
}

// parseRepoDigests unmarshals a JSON TEXT column into a string slice.
// Returns an empty (non-nil) slice on any error so callers never need a nil check.
func parseRepoDigests(raw string) []string {
	if raw == "" {
		return []string{}
	}

	var digests []string
	if err := json.Unmarshal([]byte(raw), &digests); err != nil {
		slog.Warn("failed to parse repo_digests JSON", "value", raw, "error", err)
		return []string{}
	}

	return digests
}
