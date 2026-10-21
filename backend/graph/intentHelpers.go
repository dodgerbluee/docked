package graph

import (
	"context"
	"strconv"
	"time"

	"github.com/dockedapp/backend/graph/model"
	"github.com/dockedapp/backend/internal/db"
	"github.com/dockedapp/backend/internal/events"
	"github.com/dockedapp/backend/internal/imagesync"
	"github.com/dockedapp/backend/internal/intents"
)

// previewContainer maps a DB container row to the IntentPreviewContainer shape
// used by previewIntent. Kept out of schema.resolvers.go so gqlgen regen does
// not move it into the graveyard block.
func previewContainer(c *db.ContainerRow, hasUpdate bool, exclusionReason, status *string) *model.IntentPreviewContainer {
	pc := &model.IntentPreviewContainer{
		ContainerID:     c.ContainerID,
		ContainerName:   c.ContainerName,
		HasUpdate:       hasUpdate,
		ExclusionReason: exclusionReason,
		Status:          status,
	}
	if c.ImageName.Valid {
		pc.ImageName = &c.ImageName.String
	}
	if c.StackName.Valid {
		pc.StackName = &c.StackName.String
	}
	if c.SourceInstanceID.Valid {
		pc.SourceInstanceID = strPtr(strconv.FormatInt(c.SourceInstanceID.Int64, 10))
	}
	if c.RunnerID.Valid {
		pc.RunnerID = strPtr(strconv.FormatInt(c.RunnerID.Int64, 10))
	}
	return pc
}

// newIntentExecutor builds the intents engine executor bound to this
// resolver: upgrades run through the runner upgrade pipeline (with upgrade
// history), execution updates ride the event hub, completions send the
// Discord embed. api.NewServer wires the shared instance into the evaluator.
func (r *Resolver) newIntentExecutor() *intents.Executor {
	return &intents.Executor{
		DB:      r.DB,
		Upgrade: r.IntentUpgrade,
		Publish: func(ctx context.Context, userID, execID int64) {
			(&mutationResolver{r}).publishIntentExecution(ctx, userID, execID)
		},
		Notify: r.notifyIntentExecution,
	}
}

// intentsExecutor returns the shared evaluator executor when wired,
// falling back to a locally built one (test resolvers without an evaluator).
func (r *Resolver) intentsExecutor() *intents.Executor {
	if r.Intents != nil && r.Intents.Exec != nil {
		return r.Intents.Exec
	}
	return r.newIntentExecutor()
}

// BuildIntentExecutor exposes the resolver-bound executor so api.NewServer
// can wire the shared scheduled/immediate evaluator.
func (r *Resolver) BuildIntentExecutor() *intents.Executor {
	return r.newIntentExecutor()
}

// IntentUpgrade performs the actual upgrade and records upgrade history.
// Lock acquisition/heartbeat is the intent executor's responsibility.
func (r *Resolver) IntentUpgrade(ctx context.Context, userID int64, c *db.ContainerRow, rr *db.RunnerRow, imageName string) error {
	start := time.Now()
	err := (&mutationResolver{r}).runnerUpgradePipeline(ctx, userID, c, rr, imageName, nil)
	duration := time.Since(start).Milliseconds()
	status, errMsg := "success", ""
	if err != nil {
		status, errMsg = "failed", err.Error()
	}
	r.recordUpgradeHistory(ctx, userID, c, rr, imageName, status, errMsg, duration)
	return err
}

// notifyIntentExecution ports the post-execution side effects: a
// containers-updated broadcast (upgrades only) and the Discord embed.
func (r *Resolver) notifyIntentExecution(ctx context.Context, userID int64, s intents.Summary) {
	if s.ContainersUpgraded > 0 && r.Hub != nil {
		r.Hub.PublishContainersUpdated(events.BroadcastUserID, model.ContainersUpdatedEvent{
			SourceIds: []string{}, ContainerCount: 0,
		})
	}
	data := imagesync.IntentExecutionNotify{
		IntentName:         s.IntentName,
		Status:             s.Status,
		TriggerType:        s.TriggerType,
		DurationMs:         s.DurationMs,
		ContainersMatched:  s.ContainersMatched,
		ContainersUpgraded: s.ContainersUpgraded,
		ContainersFailed:   s.ContainersFailed,
		ContainersSkipped:  s.ContainersSkipped,
	}
	for _, c := range s.Containers {
		data.ContainerResults = append(data.ContainerResults, imagesync.IntentNotifyContainer{
			ContainerName: c.ContainerName,
			Status:        c.Status,
			ImageName:     c.ImageName,
			OldImage:      c.OldImage,
			NewImage:      c.NewImage,
			ErrorMessage:  c.ErrorMessage,
		})
	}
	imagesync.SendIntentExecutionNotification(ctx, r.DB, userID, data)
}
