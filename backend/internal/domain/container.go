package domain

// Container is the API representation of a Docker container with update info.
type Container struct {
	ID    string `json:"id"`    // Docker container ID
	Name  string `json:"name"`
	Image string `json:"image"` // Full image name, e.g. "postgres:15"

	ImageRepo string  `json:"imageRepo"`
	Status    string  `json:"status"`
	State     string  `json:"state"`
	StackName *string `json:"stackName"`

	// Digest & update info
	CurrentDigest     *string  `json:"currentDigest"`
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
	UsesNetworkMode bool `json:"usesNetworkMode"`
	ProvidesNetwork bool `json:"providesNetwork"`

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
