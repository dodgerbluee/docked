package runner

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/dockedapp/backend/internal/db"
	"github.com/dockedapp/backend/internal/domain"
)

const requestTimeout = 10 * time.Second

// dockhandContainer mirrors the JSON shape returned by dockhand GET /containers.
type dockhandContainer struct {
	ID                string            `json:"id"`
	Name              string            `json:"name"`
	Image             string            `json:"image"`
	ImageID           string            `json:"imageId"`
	Status            string            `json:"status"`
	State             string            `json:"state"`
	Created           int64             `json:"created"`
	Labels            map[string]string `json:"labels,omitempty"`
	NetworkMode       string            `json:"networkMode,omitempty"`
	ComposeProject    string            `json:"composeProject,omitempty"`
	ComposeService    string            `json:"composeService,omitempty"`
	ComposeWorkingDir string            `json:"composeWorkingDir,omitempty"`
	ComposeConfigFile string            `json:"composeConfigFile,omitempty"`
	RepoDigests       []string          `json:"repoDigests,omitempty"`
	ImageCreated      int64             `json:"imageCreated,omitempty"`
}

// FetchContainers calls a single dockhand runner and returns its containers
// normalized to domain.Container. Registry data is not populated here.
func FetchContainers(ctx context.Context, runner db.RunnerRow) ([]domain.Container, error) {
	ctx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, runner.URL+"/containers", nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+runner.APIKey)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status %d", resp.StatusCode)
	}

	var payload struct {
		Containers []dockhandContainer `json:"containers"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	out := make([]domain.Container, 0, len(payload.Containers))
	for _, dockhandCtr := range payload.Containers {
		out = append(out, normalize(dockhandCtr, runner))
	}
	return out, nil
}

// normalize converts a dockhand container to the domain shape.
func normalize(dockhandCtr dockhandContainer, runnerRow db.RunnerRow) domain.Container {
	// Strip image prefix from repoDigests to get sha256-only format,
	// matching the Node.js normalizeRunnerContainer logic.
	cleanDigests := make([]string, 0, len(dockhandCtr.RepoDigests))
	for _, repoDigest := range dockhandCtr.RepoDigests {
		if index := strings.Index(repoDigest, "@sha256:"); index >= 0 {
			cleanDigests = append(cleanDigests, "sha256:"+repoDigest[index+len("@sha256:"):])
		} else {
			cleanDigests = append(cleanDigests, repoDigest)
		}
	}

	var currentDigest *string
	if len(cleanDigests) > 0 {
		currentDigest = &cleanDigests[0]
	}

	runnerName := runnerRow.Name
	runnerURL := runnerRow.URL

	container := domain.Container{
		ID:          dockhandCtr.ID,
		Name:        dockhandCtr.Name,
		Image:       dockhandCtr.Image,
		Status:      dockhandCtr.Status,
		State:       dockhandCtr.State,
		RepoDigests: cleanDigests,
		Source:      "runner",
		RunnerID:    &runnerRow.ID,
		RunnerName:  &runnerName,
		RunnerURL:   &runnerURL,

		CurrentDigest: currentDigest,

		UsesNetworkMode: dockhandCtr.NetworkMode != "" &&
			(strings.HasPrefix(dockhandCtr.NetworkMode, "service:") ||
				strings.HasPrefix(dockhandCtr.NetworkMode, "container:")),
	}

	if dockhandCtr.ComposeProject != "" {
		container.StackName = &dockhandCtr.ComposeProject
	}

	return container
}
