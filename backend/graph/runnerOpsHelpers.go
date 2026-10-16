package graph

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"github.com/dockedapp/backend/graph/model"
	"github.com/dockedapp/backend/internal/db"
)

// Helpers for the runner action domain (health / restart / update /
// uninstall / events / logs). Kept out of schema.resolvers.go so gqlgen
// regen does not move them into the graveyard block.

// runnerForAction resolves the caller's runner row, scoping to the user.
func (r *Resolver) runnerForAction(ctx context.Context, runnerID string) (*db.RunnerRow, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	rid, _ := strconv.ParseInt(runnerID, 10, 64)
	runner, err := db.GetRunnerByID(ctx, r.DB, rid, uid)
	if err != nil || runner == nil {
		return nil, fmt.Errorf("runner not found")
	}
	return runner, nil
}

// publishRunnerStatus fans a Docker-status transition out to
// runnerStatusChanged subscribers (parity with Node's publishRunnerStatusEvent).
func (r *Resolver) publishRunnerStatus(runner *db.RunnerRow, dockerStatus string) {
	status := model.RunnerStatusDegraded
	switch dockerStatus {
	case "ok":
		status = model.RunnerStatusOnline
	case "unavailable":
		status = model.RunnerStatusOffline
	}
	now := time.Now().UTC()
	r.Hub.PublishRunnerStatus(runner.UserID, model.RunnerStatusEvent{
		RunnerID:      strconv.FormatInt(runner.ID, 10),
		RunnerName:    runner.Name,
		Status:        status,
		LastHeartbeat: &now,
	})
}
