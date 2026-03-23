package containers

import "strings"

// hasUpdate returns true when the registry has a newer image than what the
// container is running. It mirrors the Node.js computeHasUpdate logic exactly.
//
// Rules (in order):
//  1. If latestDigest is empty, we have no data — assume no update.
//  2. If repoDigests is non-empty, check whether latestDigest appears in the
//     array. If it does, the container already has the latest image. If it
//     doesn't, an update is available.
//  3. If repoDigests is empty, we cannot reliably determine the answer for
//     multi-arch images (the running digest may be platform-specific while
//     latestDigest is the manifest-list digest). Return false to avoid false
//     positives.
func hasUpdate(repoDigests []string, latestDigest *string) bool {
	if latestDigest == nil || *latestDigest == "" {
		return false
	}

	if len(repoDigests) == 0 {
		return false
	}

	normalLatest := normalizeDigest(*latestDigest)
	for _, repoDigest := range repoDigests {
		if normalizeDigest(repoDigest) == normalLatest {
			return false // container already has this digest
		}
	}

	return true // latestDigest not found in repoDigests — update available
}

// normalizeDigest strips the "sha256:" prefix and lowercases the value for
// consistent comparison regardless of how the digest was stored.
func normalizeDigest(digest string) string {
	return strings.ToLower(strings.TrimPrefix(digest, "sha256:"))
}
