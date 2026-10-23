package domain

import "strings"

// OriginalImageLabel is stamped by the upgrade pipeline on every container it
// recreates, holding the user-visible reference (repo:tag or repo@digest) the
// container was built from. It is the authoritative way to recover image
// identity for a container Docker now reports as a bare image ID. It lives
// here because graph, imagesync and runner all need it and none of them may
// import another.
const OriginalImageLabel = "docked.original_image"

// RepoQualifiedDigest returns the index of the "@sha256:" separator in an image
// reference ("repo@sha256:abc"), or -1 when the value is not repository
// qualified. A bare "sha256:..." image ID never qualifies: it identifies an
// image but carries no repository to look updates up with.
func RepoQualifiedDigest(value string) int {
	if idx := strings.Index(value, "@sha256:"); idx > 0 {
		return idx
	}
	return -1
}

// ProviderFromImageRepo maps an image repository (no tag) to the registry
// provider vocabulary (dockerhub/ghcr/gitlab/gcr) used by
// registry_image_versions.provider and the imageInfo.provider field. Lives
// here because both the runner and imagesync packages need it and imagesync
// imports runner.
func ProviderFromImageRepo(repo string) string {
	switch {
	case strings.HasPrefix(repo, "ghcr.io/"):
		return "ghcr"
	case strings.HasPrefix(repo, "registry.gitlab.com/"):
		return "gitlab"
	case strings.HasPrefix(repo, "gcr.io/"):
		return "gcr"
	default:
		return "dockerhub"
	}
}

// RegistryFromImageRepo maps an image repository (no tag) to the registry
// HOST vocabulary stored in deployed_images.registry and matched against by
// intent registry filters. Mirrors registry.ParseImageName's extractRegistry
// exactly (same known-host list, unknown hosts fall back to docker.io) so
// live rows and persisted rows speak one vocabulary.
func RegistryFromImageRepo(repo string) string {
	for _, host := range []string{"ghcr.io", "gcr.io", "quay.io", "registry.gitlab.com", "docker.io"} {
		if strings.HasPrefix(repo, host+"/") {
			return host
		}
	}
	return "docker.io"
}

// Container is the API representation of a Docker container with update info.
type Container struct {
	ID    string `json:"id"` // Docker container ID
	Name  string `json:"name"`
	Image string `json:"image"` // Full image name, e.g. "postgres:15"

	ImageRepo string  `json:"imageRepo"`
	Status    string  `json:"status"`
	State     string  `json:"state"`
	StackName *string `json:"stackName"`

	// Labels are the container's own labels. Only docked.original_image is
	// read today: it is how a container the upgrade pipeline recreated from a
	// bare image ID gets its real image reference back.
	Labels map[string]string `json:"labels,omitempty"`

	// Digest & update info
	CurrentDigest     *string  `json:"currentDigest"`
	ImageCreated      int64    `json:"imageCreated,omitempty"`
	RepoDigests       []string `json:"repoDigests"`
	LatestDigest      *string  `json:"latestDigest"`
	LatestVersion     *string  `json:"latestVersion"`
	LatestTag         *string  `json:"latestTag"`
	LatestPublishDate *string  `json:"latestPublishDate"`
	HasUpdate         bool     `json:"hasUpdate"`
	NoDigest          bool     `json:"noDigest"`
	LastChecked       *string  `json:"lastChecked"`
	Provider          *string  `json:"provider"`

	// Source: "portainer" or "runner"
	Source     string  `json:"source"`
	EndpointID *int64  `json:"endpointId"`
	SourceURL  *string `json:"sourceUrl"`
	SourceName *string `json:"sourceName"`
	RunnerID   *int64  `json:"runnerId"`
	RunnerName *string `json:"runnerName"`
	RunnerURL  *string `json:"runnerUrl"`

	// Network mode flags
	UsesNetworkMode bool   `json:"usesNetworkMode"`
	ProvidesNetwork bool   `json:"providesNetwork"`
	NetworkMode     string `json:"networkMode,omitempty"`

	// Timestamps
	LastSeen  string `json:"lastSeen"`
	CreatedAt string `json:"createdAt"`
}

// Stack is a group of containers sharing the same Docker Compose project name.
// Containers not belonging to any stack are grouped under the "Unstacked" name.
type Stack struct {
	Name          string      `json:"name"`
	Containers    []Container `json:"containers"`
	UpdateCount   int         `json:"updateCount"`
	UptodateCount int         `json:"uptodateCount"`
	TotalCount    int         `json:"totalCount"`
}

// ListResponse is the JSON body returned by GET /api/containers.
type ListResponse struct {
	Grouped           bool        `json:"grouped"`
	Stacks            []Stack     `json:"stacks"`
	Containers        []Container `json:"containers"`
	UnusedImagesCount int         `json:"unusedImagesCount"`
}
