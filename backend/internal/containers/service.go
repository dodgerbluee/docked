package containers

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"strings"

	"github.com/dockedapp/backend/internal/db"
	"github.com/dockedapp/backend/internal/domain"
	"github.com/dockedapp/backend/internal/runner"
)

// Service provides container listing operations.
type Service struct {
	database *sql.DB
}

// NewService creates a Service backed by the given database connection.
func NewService(database *sql.DB) *Service {
	return &Service{database: database}
}

// ListOptions controls what sources are included in the response.
type ListOptions struct {
	// PortainerOnly skips live runner fetching. Used when the frontend is
	// refreshing Portainer data only and will merge runner containers itself.
	PortainerOnly bool
}

// List fetches all containers for the user — DB-backed Portainer containers
// plus live containers from each enabled dockhand runner — and returns them
// grouped by stack.
func (s *Service) List(ctx context.Context, userID int64, opts ListOptions) (domain.ListResponse, error) {
	// Fetch DB containers (Portainer-backed).
	rows, err := db.GetContainers(ctx, s.database, userID)
	if err != nil {
		return domain.ListResponse{}, fmt.Errorf("get containers: %w", err)
	}

	containers := make([]domain.Container, 0, len(rows))
	for _, row := range rows {
		containers = append(containers, toContainer(row))
	}

	if opts.PortainerOnly {
		return domain.ListResponse{
			Grouped:           true,
			Stacks:            groupByStack(containers),
			Containers:        containers,
			UnusedImagesCount: 0,
		}, nil
	}

	// Fetch enabled runners and pull their containers live.
	runners, err := db.GetEnabledRunners(ctx, s.database, userID)
	if err != nil {
		// Non-fatal: log and continue with portainer-only results.
		slog.Warn("failed to fetch runners", "userID", userID, "error", err)
	}

	for _, runnerRow := range runners {
		runnerContainers, err := runner.FetchContainers(ctx, runnerRow)
		if err != nil {
			slog.Warn("failed to fetch runner containers", "runner", runnerRow.Name, "url", runnerRow.URL, "error", err)
			continue
		}

		// Enrich each runner container with registry data from the DB.
		for i := range runnerContainers {
			enrichRunnerContainer(ctx, s.database, userID, &runnerContainers[i])
		}

		containers = append(containers, runnerContainers...)
	}

	return domain.ListResponse{
		Grouped:           true,
		Stacks:            groupByStack(containers),
		Containers:        containers,
		UnusedImagesCount: 0,
	}, nil
}

// enrichRunnerContainer looks up registry_image_versions for a runner container
// and populates its update fields in-place.
func enrichRunnerContainer(ctx context.Context, database *sql.DB, userID int64, container *domain.Container) {
	imageRepo, imageTag := splitImageRef(container.Image)

	registryData, err := db.GetRegistryData(ctx, database, userID, imageRepo, imageTag)
	if err != nil {
		slog.Warn("registry lookup failed", "image", container.Image, "error", err)
		return
	}

	if registryData.LatestDigest.Valid && registryData.LatestDigest.String != "" {
		container.LatestDigest = &registryData.LatestDigest.String
	}
	if registryData.LatestVersion.Valid && registryData.LatestVersion.String != "" {
		container.LatestVersion = &registryData.LatestVersion.String
	}
	if registryData.LatestTag.Valid && registryData.LatestTag.String != "" {
		container.LatestTag = &registryData.LatestTag.String
	}
	if registryData.LatestPublishDate.Valid && registryData.LatestPublishDate.String != "" {
		container.LatestPublishDate = &registryData.LatestPublishDate.String
	}
	if registryData.Provider.Valid && registryData.Provider.String != "" {
		container.Provider = &registryData.Provider.String
	}
	if registryData.LastChecked.Valid && registryData.LastChecked.String != "" {
		container.LastChecked = &registryData.LastChecked.String
	}

	container.HasUpdate = hasUpdate(container.RepoDigests, container.LatestDigest)
}

// splitImageRef splits "repo/image:tag" into (imageRepo, imageTag).
// If no tag is present, tag defaults to "latest".
func splitImageRef(image string) (repo, tag string) {
	// Strip digest suffix (e.g. @sha256:...)
	if idx := strings.Index(image, "@"); idx >= 0 {
		image = image[:idx]
	}

	if idx := strings.LastIndex(image, ":"); idx >= 0 {
		return image[:idx], image[idx+1:]
	}
	return image, "latest"
}
