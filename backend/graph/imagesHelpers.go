package graph

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/dockedapp/backend/graph/model"
	"github.com/dockedapp/backend/internal/db"
	"github.com/dockedapp/backend/internal/portainer"
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

// createdToString normalizes a Docker Created field: Portainer formats it
// as an RFC3339 string, raw Docker returns unix seconds as a number.
func createdToString(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	var seconds int64
	if err := json.Unmarshal(raw, &seconds); err == nil {
		return time.Unix(seconds, 0).UTC().Format(time.RFC3339)
	}
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	return ""
}

func instanceDisplayName(inst db.SourceInstanceRow) string {
	if inst.Name != "" {
		return inst.Name
	}
	if u, err := url.Parse(inst.URL); err == nil {
		return u.Hostname()
	}
	return inst.URL
}

// unusedFromPortainer computes the unused-image set for one Portainer
// instance: first endpoint, images minus container-referenced image IDs,
// with inspect-based tag recovery for images the list API left untagged.
// Errors are logged and yield an empty slice, matching Node's per-source
// fault isolation.
func (r *queryResolver) unusedFromPortainer(ctx context.Context, inst db.SourceInstanceRow) []*model.DockerImage {
	client := portainer.New(inst)
	endpoints, err := client.GetEndpoints(ctx)
	if err != nil || len(endpoints) == 0 {
		slog.Error("unused images: no endpoints", "url", inst.URL, "error", err)
		return nil
	}
	endpointID := endpoints[0].ID

	images, err := client.GetImages(ctx, endpointID)
	if err != nil {
		slog.Error("unused images: image list failed", "url", inst.URL, "error", err)
		return nil
	}
	containers, err := client.GetContainers(ctx, endpointID)
	if err != nil {
		slog.Error("unused images: container list failed", "url", inst.URL, "error", err)
		return nil
	}

	used := make(map[string]bool)
	for _, c := range containers {
		if c.ImageID != "" {
			used[c.ImageID] = true
			used[normalizeImageID(c.ImageID)] = true
		}
	}

	displayName := instanceDisplayName(inst)
	var out []*model.DockerImage
	var needsInspection []portainer.Image

	for _, img := range images {
		if used[img.ID] || used[normalizeImageID(img.ID)] {
			continue
		}
		if hasValidRepoTags(img.RepoTags) {
			out = append(out, &model.DockerImage{
				ID:         img.ID,
				RepoTags:   img.RepoTags,
				Size:       int(img.Size),
				Created:    createdToString(img.Created),
				SourceURL:  inst.URL,
				EndpointID: &endpointID,
				SourceName: displayName,
			})
			continue
		}
		needsInspection = append(needsInspection, img)
	}

	// Batch-inspect untagged images in parallel — the list API often omits
	// tags even for tagged images; inspect always returns the real ones.
	type inspection struct {
		image    portainer.Image
		repoTags []string
	}
	inspections := make([]inspection, len(needsInspection))
	var wg sync.WaitGroup
	for i, img := range needsInspection {
		wg.Add(1)
		go func(i int, img portainer.Image) {
			defer wg.Done()
			fallback := []string(nil)
			if len(img.RepoDigests) > 0 {
				fallback = extractRepoTagsFromDigests(img.RepoDigests)
			}
			detail, err := client.InspectImage(ctx, endpointID, img.ID)
			if err != nil {
				inspections[i] = inspection{image: img, repoTags: fallback}
				return
			}
			switch {
			case hasValidRepoTags(detail.RepoTags):
				inspections[i] = inspection{image: img, repoTags: detail.RepoTags}
			case len(detail.RepoDigests) > 0:
				inspections[i] = inspection{image: img, repoTags: extractRepoTagsFromDigests(detail.RepoDigests)}
			default:
				inspections[i] = inspection{image: img, repoTags: fallback}
			}
		}(i, img)
	}
	wg.Wait()

	for _, ins := range inspections {
		tags := ins.repoTags
		if tags == nil {
			tags = []string{"<none>:<none>"}
		}
		out = append(out, &model.DockerImage{
			ID:         ins.image.ID,
			RepoTags:   tags,
			Size:       int(ins.image.Size),
			Created:    createdToString(ins.image.Created),
			SourceURL:  inst.URL,
			EndpointID: &endpointID,
			SourceName: displayName,
		})
	}
	return out
}

// boolPtr returns a pointer to b (SuccessResult-style nullable booleans).
func boolPtr(b bool) *bool { return &b }

// deleteOneImage resolves one DeleteImageInput against the user's runners
// or Portainer instances and returns the per-image outcome row. Runner
// images win over Portainer URLs, matching Node's controller precedence.
func (r *mutationResolver) deleteOneImage(
	ctx context.Context,
	img *model.DeleteImageInput,
	instanceMap map[string]db.SourceInstanceRow,
	runnerMap map[int64]db.RunnerRow,
) *model.DeleteImageResult {
	fail := func(msg string) *model.DeleteImageResult {
		return &model.DeleteImageResult{ID: img.ID, Error: strPtr(msg)}
	}

	if img.RunnerID != nil && *img.RunnerID != "" {
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
		return &model.DeleteImageResult{ID: img.ID, Success: boolPtr(true)}
	}

	resolvedURL := ""
	if img.PortainerURL != nil {
		resolvedURL = *img.PortainerURL
	}
	if resolvedURL == "" && img.SourceURL != nil {
		resolvedURL = *img.SourceURL
	}
	inst, ok := instanceMap[resolvedURL]
	if !ok {
		return fail("Portainer instance not found: " + resolvedURL)
	}
	if img.EndpointID == nil {
		return fail("endpointId is required for Portainer images")
	}
	client := portainer.New(inst)
	if err := client.DeleteImage(ctx, *img.EndpointID, img.ID, true); err != nil {
		slog.Error("image delete failed", "image", img.ID, "instance", inst.URL, "error", err)
		return fail(err.Error())
	}
	return &model.DeleteImageResult{ID: img.ID, Success: boolPtr(true)}
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
			Size:       int(img.Size),
			Created:    time.Unix(img.Created, 0).UTC().Format(time.RFC3339),
			SourceURL:  rr.URL,
			SourceName: displayName,
			RunnerID:   &runnerID,
		})
	}
	return out
}
