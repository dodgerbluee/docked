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

// ParseImageName parses a docker image reference into its components.
func ParseImageName(imageName string) (*ParsedImage, error) {
	if imageName == "" {
		return nil, errors.New("invalid image name provided")
	}

	cleaned := cleanImageName(imageName)

	// extractTag: last ":" segment is the tag; a name with no ":" defaults to latest.
	parts := strings.Split(cleaned, ":")
	tag := "latest"
	nameWithoutTag := cleaned
	if len(parts) > 1 {
		tag = parts[len(parts)-1]
		nameWithoutTag = strings.Join(parts[:len(parts)-1], ":")
		if nameWithoutTag == "" {
			nameWithoutTag = parts[0]
		}
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
