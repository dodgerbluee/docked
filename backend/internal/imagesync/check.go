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
	LatestVersion     *string
	LatestPublishDate *string
	ExistsInRegistry  bool
	Provider          string
	IsFallback        bool

	// InspectDigest is the digest the inspect document itself reports
	// (RepoDigests). It is the freshest observation of what is actually
	// running, ahead of both the list payload and the stored baseline.
	InspectDigest *string
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

// repoQualifiedDigest reports the "@sha256:" separator index of a repository
// digest reference ("nginx@sha256:aaa", "registry:5000/x@sha256:aaa"). A bare
// "sha256:<image ID>" has no repository in front of the separator and is NOT a
// digest reference: SplitRepoTag would turn it into the bogus repo "sha256".
func repoQualifiedDigest(value string) int {
	idx := strings.Index(value, "@sha256:")
	if idx <= 0 {
		return -1
	}
	return idx
}

// firstRepoDigest returns the image's first repository digest reference
// ("repo@sha256:...", inspect document first, then the list payload). Used to
// recover a usable repository/tag reference for containers whose Config.Image
// was pinned to a bare image ID by the upgrade pipeline.
func firstRepoDigest(details map[string]any, listDigests []string) string {
	if details != nil {
		if arr, ok := details["RepoDigests"].([]any); ok {
			for _, v := range arr {
				if s, ok := v.(string); ok && repoQualifiedDigest(s) >= 0 {
					return s
				}
			}
		}
	}
	for _, s := range listDigests {
		if repoQualifiedDigest(s) >= 0 {
			return s
		}
	}
	return ""
}

// originalImageReference digs the docked.original_image label out of the
// inspect document. The upgrade pipeline stamps it with the reference the
// container was built from, so it is the authoritative recovery source for a
// pinned dependent whose Config.Image and RepoDigests are both useless.
func originalImageReference(details map[string]any) string {
	ref := configLabel(details, "docked.original_image")
	if ref == "" {
		return ""
	}
	// A bare image ID in the label recovers nothing; only a repository
	// reference is usable.
	if strings.HasPrefix(ref, "sha256:") && repoQualifiedDigest(ref) < 0 {
		return ""
	}
	return ref
}

// digestFromReference extracts the "sha256:..." part of an image reference
// ("repo@sha256:abc" -> "sha256:abc"), or "" when the reference is tag-based.
func digestFromReference(reference string) string {
	idx := strings.Index(reference, "@sha256:")
	if idx < 0 {
		return ""
	}
	return "sha256:" + reference[idx+len("@sha256:"):]
}

// inspectDigest ports dockerRegistryService.getCurrentImageDigest's inspect
// half: the digest the inspect document reports for the image that is actually
// running. Repository-qualified entries win; a bare entry still identifies the
// running image's digest even though it cannot be re-parsed into a reference.
func inspectDigest(details map[string]any) *string {
	if details == nil {
		return nil
	}
	arr, ok := details["RepoDigests"].([]any)
	if !ok {
		return nil
	}
	var bare *string
	for _, v := range arr {
		s, ok := v.(string)
		if !ok {
			continue
		}
		if digest := digestFromReference(s); digest != "" {
			return &digest
		}
		if bare == nil && strings.HasPrefix(s, "sha256:") && len(s) > len("sha256:") {
			trimmed := strings.TrimSpace(s)
			bare = &trimmed
		}
	}
	return bare
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
		InspectDigest:     inspectDigest(details),
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
	info.LatestVersion = latest.Version
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
