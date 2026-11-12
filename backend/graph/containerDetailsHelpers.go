package graph

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/dockedapp/backend/graph/model"
	"github.com/dockedapp/backend/internal/db"
)

func (r *Resolver) containerDetails(ctx context.Context, containerID, runnerID string) (model.JSON, error) {
	uid, err := requireUser(ctx)
	if err != nil {
		return nil, err
	}
	rid, err := strconv.ParseInt(runnerID, 10, 64)
	if err != nil || rid <= 0 || containerID == "" {
		return nil, fmt.Errorf("valid container and runner IDs are required")
	}
	runner, err := db.GetRunnerByID(ctx, r.DB, rid, uid)
	if err != nil || runner == nil {
		return nil, err
	}
	persisted, err := db.GetContainerByDockerID(ctx, r.DB, uid, containerID, &rid)
	if err != nil {
		return nil, err
	}
	row := persisted
	if runner.Enabled {
		if live := r.liveRunnerContainer(ctx, uid, rid, containerID); live != nil {
			row = live
			if persisted != nil {
				row.ID = persisted.ID
				row.DeployedImageID = persisted.DeployedImageID
			}
		}
	}
	if row == nil {
		return nil, nil
	}
	records, err := db.GetContainerDetailRecords(ctx, r.DB, uid, row)
	if err != nil {
		return nil, err
	}
	container := formatContainerDataRow(row)
	container["runner_name"] = runner.Name
	container["container_name"] = row.ContainerName
	container["runner_id"] = rid
	container["source"] = "runner"
	records["container"] = container
	var repoDigests []string
	if row.RepoDigests.Valid {
		if err := json.Unmarshal([]byte(row.RepoDigests.String), &repoDigests); err != nil {
			return nil, fmt.Errorf("invalid stored container digests")
		}
	}
	records["repoDigests"] = repoDigests
	records["currentDigest"] = jsonString(row.CurrentDigest)
	records["latestDigest"] = jsonString(row.LatestDigest)
	records["hasUpdate"] = db.ContainerHasUpdate(*row)
	records["registryImageVersion"] = map[string]any{
		"provider": jsonString(row.Provider), "latest_digest": jsonString(row.LatestDigest),
		"latest_version": jsonString(row.LatestVersion), "tag": jsonString(row.LatestTag),
		"last_checked": jsonString(row.LastChecked), "latest_publish_date": jsonString(row.LatestPublishDate),
	}
	records["metadata"] = map[string]any{"queried_at": time.Now().UTC().Format(time.RFC3339), "relatedRecordLimit": 100, "historyLimit": 20}
	return model.JSON(records), nil
}
