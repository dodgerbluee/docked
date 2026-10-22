// Package registry ports the Node image-registry layer: provider selection,
// digest fetching (native go-containerregistry instead of the crane binary),
// digest caching, and the GitHub-Releases fallback chain.
package registry

import (
	"errors"
	"strings"
)

// ParsedImage mirrors the shape of Node's imageRepoParser.parseImageName.
type ParsedImage struct {
	ImageRepo  string // registry-qualified repo without tag, e.g. "ghcr.io/owner/repo" or "nginx"
	Registry   string // "docker.io", "ghcr.io", "gcr.io", "registry.gitlab.com", "quay.io"
	Namespace  string // empty when absent
	Repository string
	Tag        string
	ImageName  string // name without tag
}

// knownRegistries matches the order used by the Node parser.
var knownRegistries = []string{"ghcr.io", "gcr.io", "quay.io", "registry.gitlab.com", "docker.io"}

// cleanImageName removes incomplete @sha256 markers (no colon) from image names.
func cleanImageName(imageName string) string {
	if strings.Contains(imageName, "@sha256") && !strings.Contains(imageName, "@sha256:") {
		return strings.Replace(imageName, "@sha256", "", 1)
	}
	return imageName
}

// SplitRepoTag splits a Docker image reference into (repo, tag). The tag
// separator is the LAST ":" that appears after the last "/", so registry
// ports are never mistaken for tags: "localhost:5000/app" is an untagged
// repo, not repo "localhost" with tag "5000/app". Digest suffixes
// (@sha256:...) are stripped. Untagged references default to "latest".
// This is the single canonical splitter; every repo/tag correlation site
// must use it.
func SplitRepoTag(image string) (repo, tag string) {
	if idx := strings.Index(image, "@"); idx >= 0 {
		image = image[:idx]
	}
	if idx := strings.LastIndex(image, ":"); idx >= 0 && idx > strings.LastIndex(image, "/") {
		return image[:idx], image[idx+1:]
	}
	return image, "latest"
}

// ParseImageName parses a docker image reference into its components.
func ParseImageName(imageName string) (*ParsedImage, error) {
	if imageName == "" {
		return nil, errors.New("invalid image name provided")
	}

	cleaned := cleanImageName(imageName)

	// extractTag: the tag separator is the last ":" AFTER the last "/", so
	// registry ports (localhost:5000/app) are not mis-split into a bogus tag.
	tag := "latest"
	nameWithoutTag := cleaned
	if idx := strings.LastIndex(cleaned, ":"); idx >= 0 && idx > strings.LastIndex(cleaned, "/") {
		tag = cleaned[idx+1:]
		nameWithoutTag = cleaned[:idx]
	}

	// extractRegistry
	registryName := "docker.io"
	path := nameWithoutTag
	matched := false
	for _, known := range knownRegistries {
		if strings.HasPrefix(nameWithoutTag, known+"/") {
			registryName = known
			path = nameWithoutTag[len(known)+1:]
			matched = true
			break
		}
	}
	if !matched && strings.HasPrefix(nameWithoutTag, "docker.io/") {
		registryName = "docker.io"
		path = nameWithoutTag[len("docker.io/"):]
	}

	// extractNamespaceAndRepo
	var namespace, repository string
	pathParts := strings.Split(path, "/")
	if len(pathParts) > 1 {
		namespace = pathParts[0]
		repository = strings.Join(pathParts[1:], "/")
	} else if registryName == "docker.io" {
		namespace = ""
		repository = pathParts[0]
	} else {
		namespace = ""
		repository = path
	}

	// buildImageRepo
	var imageRepo string
	if registryName != "docker.io" {
		if namespace != "" {
			imageRepo = registryName + "/" + namespace + "/" + repository
		} else {
			imageRepo = registryName + "/" + repository
		}
	} else if namespace != "" {
		imageRepo = namespace + "/" + repository
	} else {
		imageRepo = repository
	}

	return &ParsedImage{
		ImageRepo:  imageRepo,
		Registry:   registryName,
		Namespace:  namespace,
		Repository: repository,
		Tag:        tag,
		ImageName:  nameWithoutTag,
	}, nil
}
