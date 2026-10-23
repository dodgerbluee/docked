package imagesync

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// dockerTagsInfo mirrors the object returned by getLatestVersionFromDockerHubTags.
type dockerTagsInfo struct {
	latestTag         string
	latestDigest      string // normalized to always carry the sha256: prefix
	latestVersion     string
	latestPublishDate string // "" means null
	// tagDigests indexes every tag the Hub returned by normalized tag name.
	// The check pipeline needs the digest of the tag that is actually
	// deployed, not only of the newest one, to seed current_digest.
	tagDigests map[string]string
}

// hubTagResult is one entry of the Docker Hub tags API response.
type hubTagResult struct {
	Name          string `json:"name"`
	Digest        string `json:"digest"`
	TagLastPushed string `json:"tag_last_pushed"`
	LastUpdated   string `json:"last_updated"`
	Images        []struct {
		Digest string `json:"digest"`
	} `json:"images"`
}

// rateLimitSleep spaces out Docker Hub calls (Node's rateLimitDelay(1000)).
var dockerRateLimitDelay = time.Second

func rateLimitSleep(ctx context.Context, d time.Duration) {
	select {
	case <-ctx.Done():
	case <-time.After(d):
	}
}

// getLatestVersionFromDockerHubTags ports getLatestVersionFromDockerHubTags:
// public tags endpoint, first result is the newest, version tag is resolved
// by digest match when the newest tag is "latest". Returns ErrRateLimited on
// 429; other failures return nil.
func getLatestVersionFromDockerHubTags(ctx context.Context, imageRepo string) (*dockerTagsInfo, error) {
	rateLimitSleep(ctx, dockerRateLimitDelay)

	namespace := "library"
	repository := imageRepo
	if strings.Contains(imageRepo, "/") {
		parts := strings.SplitN(imageRepo, "/", 2)
		namespace = parts[0]
		repository = parts[1]
	}

	hubURL := fmt.Sprintf("%s/v2/repositories/%s/%s/tags/", dockerHubTagsBase, namespace, repository)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, hubURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Docked/1.0")

	client := trackedHTTPClient
	resp, err := client.Do(req)
	if err != nil {
		slog.Error("error fetching tags from Docker Hub API", "repo", imageRepo, "error", err)
		return nil, nil
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusTooManyRequests {
		return nil, ErrRateLimited
	}
	if resp.StatusCode != http.StatusOK {
		slog.Warn("no tags found for repo from Docker Hub API", "repo", imageRepo, "status", resp.StatusCode)
		return nil, nil
	}

	var payload struct {
		Results []hubTagResult `json:"results"`
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err := json.Unmarshal(body, &payload); err != nil || len(payload.Results) == 0 {
		slog.Warn("no tags found for repo from Docker Hub API", "repo", imageRepo)
		return nil, nil
	}

	latestTagInfo := payload.Results[0]
	latestTag := latestTagInfo.Name

	latestDigest := latestTagInfo.Digest
	if latestDigest == "" && len(latestTagInfo.Images) > 0 {
		latestDigest = latestTagInfo.Images[0].Digest
	}
	if latestDigest == "" {
		slog.Warn("no digest found for latest tag", "tag", latestTag, "repo", imageRepo)
		return nil, nil
	}

	latestPublishDate := latestTagInfo.TagLastPushed
	if latestPublishDate == "" {
		latestPublishDate = latestTagInfo.LastUpdated
	}

	normalizedLatest := normalizeDigestForComparison(latestDigest)

	latestVersion := ""
	latestVersionPublishDate := ""

	if latestTag != "" && latestTag != "latest" {
		latestVersion = latestTag
		latestVersionPublishDate = latestPublishDate
	} else {
		for _, tagInfo := range payload.Results {
			if normalizeDigestForComparison(tagInfo.Digest) == normalizedLatest {
				if tagInfo.Name != "" && tagInfo.Name != "latest" && strings.TrimSpace(tagInfo.Name) != "" {
					latestVersion = strings.TrimSpace(tagInfo.Name)
					latestVersionPublishDate = tagInfo.TagLastPushed
					if latestVersionPublishDate == "" {
						latestVersionPublishDate = tagInfo.LastUpdated
					}
					if latestVersionPublishDate == "" {
						latestVersionPublishDate = latestPublishDate
					}
					break
				}
			}

			for _, image := range tagInfo.Images {
				if normalizeDigestForComparison(image.Digest) != normalizedLatest {
					continue
				}
				if tagInfo.Name == "" || tagInfo.Name == "latest" || strings.TrimSpace(tagInfo.Name) == "" {
					continue
				}
				latestVersion = strings.TrimSpace(tagInfo.Name)
				latestVersionPublishDate = tagInfo.TagLastPushed
				if latestVersionPublishDate == "" {
					latestVersionPublishDate = tagInfo.LastUpdated
				}
				if latestVersionPublishDate == "" {
					latestVersionPublishDate = latestPublishDate
				}
				break
			}
			if latestVersion != "" {
				break
			}
		}
	}

	normalizedDigest := latestDigest
	if !strings.HasPrefix(normalizedDigest, "sha256:") {
		normalizedDigest = "sha256:" + normalizedDigest
	}

	// Index every tag by normalized name so a tracked app whose
	// current_version is an older tag can be seeded with that tag's digest.
	tagDigests := make(map[string]string, len(payload.Results))
	for _, tagInfo := range payload.Results {
		name := strings.TrimSpace(tagInfo.Name)
		if name == "" || name == "latest" {
			continue
		}
		d := normalizeDigestForComparison(tagInfo.Digest)
		if d == "" && len(tagInfo.Images) > 0 {
			d = normalizeDigestForComparison(tagInfo.Images[0].Digest)
		}
		if d == "" {
			continue
		}
		if !strings.HasPrefix(d, "sha256:") {
			d = "sha256:" + d
		}
		key := normalizeVersion(name)
		if _, exists := tagDigests[key]; !exists {
			tagDigests[key] = d
		}
	}

	version := latestVersion
	if version == "" {
		version = latestTag
	}
	publishDate := latestVersionPublishDate
	if publishDate == "" {
		publishDate = latestPublishDate
	}

	return &dockerTagsInfo{
		latestTag:         latestTag,
		latestDigest:      normalizedDigest,
		latestVersion:     version,
		latestPublishDate: publishDate,
		tagDigests:        tagDigests,
	}, nil
}
