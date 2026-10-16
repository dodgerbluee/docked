package graph

import (
	"strconv"

	"github.com/dockedapp/backend/graph/model"
	"github.com/dockedapp/backend/internal/db"
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
