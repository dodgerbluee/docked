package handlers

import (
	"context"
	"log/slog"
	"net/http"

	apimiddleware "github.com/dockedapp/backend/internal/api/middleware"
	"github.com/dockedapp/backend/internal/domain"
	"github.com/dockedapp/backend/internal/respond"
)

// ContainerLister is the subset of containers.Service used by this handler.
type ContainerLister interface {
	List(ctx context.Context, userID int64) (domain.ListResponse, error)
}

// Containers handles GET /api/containers.
func Containers(service ContainerLister) http.HandlerFunc {
	return apimiddleware.WithUserID(func(w http.ResponseWriter, r *http.Request, userID int64) {
		result, err := service.List(r.Context(), userID)
		if err != nil {
			slog.Error("list containers", "userID", userID, "error", err)
			respond.Error(w, http.StatusInternalServerError, "internal server error")
			return
		}

		withUpdates, runnerContainers, portainerContainers := getUpdateTotals(result)

		slog.Debug("GET /api/containers",
			"userID", userID,
			"containers", len(result.Containers),
			"runnerContainers", runnerContainers,
			"portainerContainers", portainerContainers,
			"stacks", len(result.Stacks),
			"with_updates", withUpdates,
		)

		respond.JSON(w, http.StatusOK, result)
	})
}

func getUpdateTotals(result domain.ListResponse) (withUpdates, runnerContainers, portainerContainers int) {
	for _, container := range result.Containers {
		if container.HasUpdate {
			withUpdates++
		}
		if container.Source == "runner" {
			runnerContainers++
		} else {
			portainerContainers++
		}
	}
	return
}
