package graph

import (
	"context"
	"database/sql"
	"strings"

	"github.com/dockedapp/backend/internal/db"
)

// This file ports the legacy REST GET /api/containers/data debug viewer
// (developer mode only): image-grouped container entries plus the raw table
// records correlated by image. The payload shapes are deliberately untyped
// JSON because the viewer renders them as opaque records.

// buildContainerDataEntries returns the formatted entries: every DB container
// grouped under its "imageRepo:currentTag" key with the joined registry data.
func buildContainerDataEntries(ctx context.Context, database *sql.DB, userID int64) ([]map[string]any, error) {
	rows, err := db.GetContainers(ctx, database, userID)
	if err != nil {
		return nil, err
	}

	type imageGroup struct {
		data      map[string]any
		entries   []map[string]any
		names     []string
		anyUpdate bool
	}

	order := []string{}
	groups := map[string]*imageGroup{}

	for i := range rows {
		c := formatContainerDataRow(&rows[i])
		repo, _ := c["imageRepo"].(string)
		if repo == "" {
			continue
		}
		tag, _ := c["currentTag"].(string)
		key := repo + ":" + tag

		group, ok := groups[key]
		if !ok {
			group = &imageGroup{
				data: map[string]any{
					"imageRepo":         c["imageRepo"],
					"imageTag":          tag,
					"currentDigest":     c["currentDigest"],
					"currentVersion":    c["currentVersion"],
					"latestDigest":      c["latestDigest"],
					"latestVersion":     c["latestVersion"],
					"latestTag":         c["latestTag"],
					"latestPublishDate": c["latestPublishDate"],
					"hasUpdate":         false,
					"existsInRegistry":  true,
				},
			}
			groups[key] = group
			order = append(order, key)
		}
		group.entries = append(group.entries, c)
		name, _ := c["name"].(string)
		if name == "" {
			name, _ = c["id"].(string)
		}
		if name == "" {
			name = "Unknown"
		}
		group.names = append(group.names, name)
		if up, _ := c["hasUpdate"].(bool); up {
			group.anyUpdate = true
		}
	}

	entries := make([]map[string]any, 0, len(order))
	for _, key := range order {
		group := groups[key]
		group.data["hasUpdate"] = group.anyUpdate
		group.data["containers"] = group.entries

		updatedAt := any(nil)
		if len(group.entries) > 0 {
			updatedAt = group.entries[0]["updatedAt"]
		}
		entries = append(entries, map[string]any{
			"key":            "image-" + key,
			"imageRepo":      groups[key].data["imageRepo"],
			"imageTag":       groups[key].data["imageTag"],
			"containerCount": len(group.entries),
			"containerNames": group.names,
			"data":           group.data,
			"createdAt":      nil,
			"updatedAt":      updatedAt,
		})
	}
	return entries, nil
}

// formatContainerDataRow maps one joined container row onto the legacy
// formatted-container record. hasUpdate comes from db.ContainerHasUpdate, the
// single source of truth shared with the GraphQL container resolvers.
func formatContainerDataRow(c *db.ContainerRow) map[string]any {
	imageName := jsonString(c.ImageName)

	// Legacy tag rule: the joined image_tag, else the segment after the FIRST
	// colon of image_name, else "latest".
	tag := "latest"
	if c.ImageTag.Valid && c.ImageTag.String != "" {
		tag = c.ImageTag.String
	} else if s, ok := imageName.(string); ok {
		if i := strings.Index(s, ":"); i != -1 {
			tag = s[i+1:]
		}
	}

	return map[string]any{
		"id":                  c.ContainerID,
		"name":                c.ContainerName,
		"image":               imageName,
		"imageRepo":           jsonString(c.ImageRepo),
		"status":              jsonString(c.Status),
		"state":               jsonString(c.State),
		"sourceInstanceId":    jsonInt64(c.SourceInstanceID),
		"endpointId":          jsonInt64(c.EndpointID),
		"stackName":           jsonString(c.StackName),
		"currentDigest":       jsonString(c.CurrentDigest),
		"currentTag":          tag,
		"currentVersion":      tag,
		"currentImageCreated": jsonString(c.ImageCreatedDate),
		"usesNetworkMode":     c.UsesNetworkMode,
		"providesNetwork":     c.ProvidesNetwork,
		"latestDigest":        jsonString(c.LatestDigest),
		"latestVersion":       jsonString(c.LatestVersion),
		"latestTag":           jsonString(c.LatestTag),
		"latestPublishDate":   jsonString(c.LatestPublishDate),
		"existsInDockerHub":   false, // Deprecated - use existsInRegistry
		"existsInRegistry":    true,
		"deployedImageId":     jsonInt64(c.DeployedImageID),
		"lastSeen":            jsonString(c.LastSeen),
		"updatedAt":           jsonString(c.UpdatedAt),
		// Required for multi-arch hasUpdate (latest digest already in the array
		// means no update).
		"repoDigests": jsonString(c.RepoDigests),
		"hasUpdate":   db.ContainerHasUpdate(*c),
	}
}

// correlateRecordsByImage groups the raw table records by "repo:tag" so the
// viewer can show containers, deployed images and registry versions that
// belong to the same image. Port of the legacy controller helper.
func correlateRecordsByImage(raw map[string]any) map[string]any {
	type correlation struct {
		imageRepo    string
		imageTag     string
		containers   []map[string]any
		deployed     []map[string]any
		registry     []map[string]any
		deployedIDs  []int64
		deployedSeen map[int64]bool
	}

	order := []string{}
	byImage := map[string]*correlation{}

	ensure := func(key, repo, tag string) *correlation {
		group, ok := byImage[key]
		if !ok {
			group = &correlation{
				imageRepo:    repo,
				imageTag:     tag,
				deployedSeen: map[int64]bool{},
			}
			byImage[key] = group
			order = append(order, key)
		}
		return group
	}

	// First pass: containers define the image keys.
	for _, container := range rawRows(raw["containers"]) {
		repo, tag := extractImageInfo(container["image_name"], container["image_repo"], nil)
		group := ensure(repo+":"+tag, repo, tag)
		group.containers = append(group.containers, container)

		if id, ok := asInt64(container["deployed_image_id"]); ok && id != 0 && !group.deployedSeen[id] {
			group.deployedSeen[id] = true
			group.deployedIDs = append(group.deployedIDs, id)
		}
	}

	// Second pass: deployed_images by repo:tag, plus an id map for the third pass.
	deployedImageMap := map[int64]map[string]any{}
	for _, deployedImage := range rawRows(raw["deployed_images"]) {
		if id, ok := asInt64(deployedImage["id"]); ok {
			deployedImageMap[id] = deployedImage
		}
		repo, tag := extractImageInfo(nil, deployedImage["image_repo"], deployedImage["image_tag"])
		group := ensure(repo+":"+tag, repo, tag)
		group.deployed = append(group.deployed, deployedImage)
	}

	// Third pass: attach deployed_images referenced by container.deployed_image_id.
	for _, key := range order {
		group := byImage[key]
		for _, id := range group.deployedIDs {
			deployedImage, ok := deployedImageMap[id]
			if !ok {
				continue
			}
			already := false
			for _, existing := range group.deployed {
				if existingID, ok := asInt64(existing["id"]); ok && existingID == id {
					already = true
					break
				}
			}
			if !already {
				group.deployed = append(group.deployed, deployedImage)
			}
		}
	}

	// Fourth pass: registry_image_versions by exact repo:tag, else any tag of
	// the same repo, else a repo-only entry.
	for _, version := range rawRows(raw["registry_image_versions"]) {
		repo, _ := version["image_repo"].(string)
		tag := "latest"
		for _, key := range []string{"current_tag", "latest_tag", "image_tag"} {
			if s, ok := version[key].(string); ok && s != "" {
				tag = s
				break
			}
		}

		if group, ok := byImage[repo+":"+tag]; ok {
			group.registry = append(group.registry, version)
			continue
		}

		matched := false
		for _, key := range order {
			if strings.HasPrefix(key, repo+":") {
				byImage[key].registry = append(byImage[key].registry, version)
				matched = true
			}
		}
		if !matched {
			group := ensure(repo+":*", repo, "*")
			group.registry = append(group.registry, version)
		}
	}

	correlated := make(map[string]any, len(order))
	for _, key := range order {
		group := byImage[key]

		correlated[key] = map[string]any{
			"imageRepo":        group.imageRepo,
			"imageTag":         group.imageTag,
			"containers":       group.containers,
			"deployedImages":   group.deployed,
			"registryVersions": group.registry,
			"summary": map[string]any{
				"containerCount":       len(group.containers),
				"deployedImageCount":   len(group.deployed),
				"registryVersionCount": len(group.registry),
			},
		}
	}
	return correlated
}

// extractImageInfo derives the repo/tag pair used as the correlation key.
func extractImageInfo(imageName, imageRepo, imageTag any) (string, string) {
	repo, _ := imageRepo.(string)
	tag, _ := imageTag.(string)
	if tag == "" {
		tag = "latest"
	}

	if name, ok := imageName.(string); ok && name != "" && repo == "" {
		if strings.Contains(name, ":") {
			parts := strings.Split(name, ":")
			repo = strings.Join(parts[:len(parts)-1], ":")
			tag = parts[len(parts)-1]
		} else {
			repo = name
		}
	}

	if i := strings.Index(tag, "@"); i != -1 {
		tag = tag[:i]
	}
	return repo, tag
}

func rawRows(v any) []map[string]any {
	if rows, ok := v.([]map[string]any); ok {
		return rows
	}
	return nil
}

func asInt64(v any) (int64, bool) {
	switch value := v.(type) {
	case int64:
		return value, true
	case int:
		return int64(value), true
	case float64:
		return int64(value), true
	default:
		return 0, false
	}
}

// jsonString / jsonInt64 turn nullable columns into JSON values (null when the
// column is NULL), matching the legacy REST records which carried SQL nulls.
func jsonString(s sql.NullString) any {
	if !s.Valid {
		return nil
	}
	return s.String
}

func jsonInt64(s sql.NullInt64) any {
	if !s.Valid {
		return nil
	}
	return s.Int64
}
