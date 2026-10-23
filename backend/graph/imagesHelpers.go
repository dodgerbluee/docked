package graph

import (
	"context"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/dockedapp/backend/graph/model"
	"github.com/dockedapp/backend/internal/db"
	"github.com/dockedapp/backend/internal/runner"
)

// normalizeImageID strips the sha256: prefix and truncates to 12 chars,
// matching Node's normalizeImageId used for used-image matching.
func normalizeImageID(imageID string) string {
	clean := strings.TrimPrefix(imageID, "sha256:")
	if len(clean) >= 12 {
		return clean[:12]
	}
	return clean
}

// hasValidRepoTags mirrors Node's check for usable tags in a list response.
func hasValidRepoTags(tags []string) bool {
	return len(tags) > 0 && !(len(tags) == 1 && tags[0] == "<none>:<none>")
}

// extractRepoTagsFromDigests recovers display tags from RepoDigests entries.
func extractRepoTagsFromDigests(digests []string) []string {
	tags := make([]string, 0, len(digests))
	for _, digest := range digests {
		repoPart, _, found := strings.Cut(digest, "@sha256:")
		if found && repoPart != "" {
			tags = append(tags, repoPart+":<none>")
		} else {
			tags = append(tags, "<none>:<none>")
		}
	}
	return tags
}

// boolPtr returns a pointer to b (SuccessResult-style nullable booleans).
func boolPtr(b bool) *bool { return &b }

// deleteOneImage resolves one DeleteImageInput against the user's runners
// and returns the per-image outcome row.
func (r *mutationResolver) deleteOneImage(
	ctx context.Context,
	img *model.DeleteImageInput,
	runnerMap map[int64]db.RunnerRow,
) *model.DeleteImageResult {
	// Every outcome row echoes the caller's runnerId so a client matching a
	// failure back to its own rows can qualify it by host instead of by image
	// id alone, which is not unique across runners.
	fail := func(msg string) *model.DeleteImageResult {
		return &model.DeleteImageResult{ID: img.ID, RunnerID: img.RunnerID, Error: strPtr(msg)}
	}

	if img.RunnerID == nil || *img.RunnerID == "" {
		return fail("runnerId is required for image deletion")
	}
	rid, err := strconv.ParseInt(*img.RunnerID, 10, 64)
	if err != nil {
		return fail("Runner not found: " + *img.RunnerID)
	}
	rr, ok := runnerMap[rid]
	if !ok {
		return fail("Runner not found: " + *img.RunnerID)
	}
	if err := runner.DeleteImage(ctx, rr, img.ID, true); err != nil {
		slog.Error("image delete failed", "image", img.ID, "runner", rr.URL, "error", err)
		return fail(err.Error())
	}
	return &model.DeleteImageResult{ID: img.ID, RunnerID: img.RunnerID, Success: boolPtr(true)}
}

// unusedFromRunner computes the unused-image set for one dockhand runner
// host, matching Node's runner branch of getUnusedImages.
func (r *queryResolver) unusedFromRunner(ctx context.Context, rr db.RunnerRow) []*model.DockerImage {
	images, err := runner.GetImages(ctx, rr)
	if err != nil {
		slog.Error("unused images: runner image list failed", "runner", rr.URL, "error", err)
		return nil
	}
	imageIDs, err := runner.FetchContainerImageIDs(ctx, rr)
	if err != nil {
		slog.Error("unused images: runner container list failed", "runner", rr.URL, "error", err)
		return nil
	}

	used := make(map[string]bool)
	for _, id := range imageIDs {
		used[id] = true
		used[normalizeImageID(id)] = true
	}

	displayName := rr.Name
	if displayName == "" {
		displayName = rr.URL
	}
	runnerID := strconv.FormatInt(rr.ID, 10)

	var out []*model.DockerImage
	for _, img := range images {
		if img.ID == "" {
			continue
		}
		if used[img.ID] || used[normalizeImageID(img.ID)] {
			continue
		}
		var tags []string
		switch {
		case hasValidRepoTags(img.RepoTags):
			tags = img.RepoTags
		case len(img.RepoDigests) > 0:
			tags = extractRepoTagsFromDigests(img.RepoDigests)
		default:
			tags = []string{"<none>:<none>"}
		}
		out = append(out, &model.DockerImage{
			ID:         img.ID,
			RepoTags:   tags,
			Size:       model.BigInt(img.Size),
			Created:    time.Unix(img.Created, 0).UTC().Format(time.RFC3339),
			SourceURL:  rr.URL,
			SourceName: displayName,
			RunnerID:   &runnerID,
		})
	}
	return out
}
