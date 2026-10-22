package imagesync

import (
	"context"
	"database/sql"
	"log/slog"
	"strings"

	"github.com/dockedapp/backend/internal/db"
	"github.com/dockedapp/backend/internal/domain"
	"github.com/dockedapp/backend/internal/registry"
)

// UpdateInfo ports the result shape of imageUpdateService.checkImageUpdates
// for the runner path (portainerUrl is always null there).
type UpdateInfo struct {
	CurrentTag        string
	CurrentDigestFull *string
	HasUpdate         bool
	LatestTag         string
	LatestDigestFull  *string
	LatestPublishDate *string
	ExistsInRegistry  bool
	Provider          string
	IsFallback        bool
}

// extractImageInfo splits an image reference into (repo, tag) using the one
// canonical splitter, so registry-qualified references (localhost:5000/app)
// keep their port in the repo instead of producing a bogus tag.
func extractImageInfo(imageName string) (repo, tag string) {
	return registry.SplitRepoTag(imageName)
}

// detectProvider ports detectProvider/detectRegistry: ghcr/gitlab/gcr map
// directly, lscr.io and bare names map to dockerhub, anything else (quay...)
// has no provider.
func detectProvider(repo string) string {
	return domain.ProviderFromImageRepo(repo)
}

// configImage digs Config.Image out of a Docker inspect document.
func configImage(details map[string]any) string {
	if details == nil {
		return ""
	}
	cfg, ok := details["Config"].(map[string]any)
	if !ok {
		return ""
	}
	img, _ := cfg["Image"].(string)
	return img
}

// firstRepoDigest returns the image's first "repo@sha256:..." digest
// reference (inspect document first, then the list payload). Used to recover
// a usable repository/tag reference for containers whose Config.Image was
// pinned to a bare image ID by the upgrade pipeline.
func firstRepoDigest(details map[string]any, listDigests []string) string {
	if details != nil {
		if arr, ok := details["RepoDigests"].([]any); ok {
			for _, v := range arr {
				if s, ok := v.(string); ok && s != "" {
					return s
				}
			}
		}
	}
	for _, s := range listDigests {
		if s != "" {
			return s
		}
	}
	return ""
}

// configLabel digs one label out of Config.Labels.
func configLabel(details map[string]any, key string) string {
	if details == nil {
		return ""
	}
	cfg, ok := details["Config"].(map[string]any)
	if !ok {
		return ""
	}
	labels, ok := cfg["Labels"].(map[string]any)
	if !ok {
		return ""
	}
	v, _ := labels[key].(string)
	return v
}

// getCurrentDigest ports dockerRegistryService.getCurrentImageDigest for the
// runner path: Config.Image "@sha256:" wins, else the stored digest, else nil.
// (Inspect documents carry no RepoDigests; those live on the list shape.)
func getCurrentDigest(details map[string]any, stored *db.DockerHubImageVersion) *string {
	if img := configImage(details); img != "" && strings.Contains(img, "@sha256:") {
		digest := "sha256:" + img[strings.Index(img, "@sha256:")+len("@sha256:"):]
		return &digest
	}
	if stored != nil && stored.CurrentDigest.Valid && stored.CurrentDigest.String != "" {
		d := stored.CurrentDigest.String
		return &d
	}
	return nil
}

// ensureProvider ports ensureProvider: stamp a detected provider onto the
// latest-image-info when the registry call left it blank.
func ensureProvider(info *registry.DigestResult, repo, currentTag string) *registry.DigestResult {
	if info != nil && info.Provider != "" {
		return info
	}
	detected := detectProvider(repo)
	if detected == "" {
		return info
	}
	if info == nil {
		return &registry.DigestResult{Provider: detected, Tag: currentTag}
	}
	info.Provider = detected
	return info
}

// determineUpdateWithStoredInfo ports determineUpdateWithStoredInfo.
// Returns nil when no override applies.
func determineUpdateWithStoredInfo(mgr *registry.Manager, stored *db.DockerHubImageVersion,
	currentTag string, latest *registry.DigestResult, currentDigest *string) *bool {

	latestDigest := latestDigestOf(latest)
	if stored != nil && !stored.HasUpdate && latestDigest != nil &&
		currentDigest == nil && stored.CurrentDigest.Valid {
		v := mgr.HasUpdate(&stored.CurrentDigest.String, currentTag, latest, nil)
		return &v
	}
	if currentDigest == nil && latestDigest != nil {
		f := false
		return &f
	}
	return nil
}

func latestDigestOf(latest *registry.DigestResult) *string {
	if latest == nil {
		return nil
	}
	return latest.Digest
}

// CheckImageUpdates ports imageUpdateService.checkImageUpdates for the runner
// path. repoDigests are not available on inspect documents, so the raw
// comparison runs without them; callers recompute hasUpdate from the list
// RepoDigests afterwards (as Node's scanRunnerContainers does).
func CheckImageUpdates(ctx context.Context, mgr *registry.Manager, database *sql.DB,
	imageName string, details map[string]any, userID int64) (*UpdateInfo, error) {

	repo, currentTag := extractImageInfo(imageName)

	var stored *db.DockerHubImageVersion
	if userID != 0 {
		var err error
		stored, err = db.GetDockerHubImageVersion(ctx, database, userID, repo, currentTag)
		if err != nil {
			slog.Debug("could not get stored version info", "repo", repo, "tag", currentTag, "error", err)
			stored = nil
		}
	}

	currentDigest := getCurrentDigest(details, stored)

	latest, err := mgr.GetLatestDigest(ctx, repo, currentTag, registry.Options{UserID: userID})
	if err != nil {
		if registry.IsRateLimitError(err) {
			return nil, err
		}
		slog.Debug("registry lookup failed", "repo", repo, "tag", currentTag, "error", err)
		latest = nil
	}
	latest = ensureProvider(latest, repo, currentTag)

	info := &UpdateInfo{
		CurrentTag:        currentTag,
		CurrentDigestFull: currentDigest,
		ExistsInRegistry:  true,
	}

	if latest == nil {
		// handleNoLatestImageInfo: keep the stored verdict when present.
		info.ExistsInRegistry = false
		info.LatestTag = currentTag
		if stored != nil {
			info.HasUpdate = stored.HasUpdate
			if stored.LatestDigest.Valid && stored.LatestDigest.String != "" {
				d := stored.LatestDigest.String
				info.LatestDigestFull = &d
			}
		}
		return info, nil
	}

	info.LatestDigestFull = latest.Digest
	info.LatestTag = latest.Tag
	if info.LatestTag == "" && latest.Version != nil {
		info.LatestTag = *latest.Version
	}
	if info.LatestTag == "" {
		info.LatestTag = currentTag
	}
	info.Provider = latest.Provider
	info.IsFallback = latest.IsFallback

	hasUpdate := mgr.HasUpdate(currentDigest, currentTag, latest, nil)
	if override := determineUpdateWithStoredInfo(mgr, stored, currentTag, latest, currentDigest); override != nil {
		hasUpdate = *override
	}
	info.HasUpdate = hasUpdate

	if info.LatestTag != "" && hasUpdate {
		date, derr := mgr.GetTagPublishDate(ctx, repo, info.LatestTag, registry.Options{UserID: userID})
		if derr != nil {
			slog.Debug("publish date lookup failed", "repo", repo, "tag", info.LatestTag, "error", derr)
		} else {
			info.LatestPublishDate = date
		}
	}

	return info, nil
}
