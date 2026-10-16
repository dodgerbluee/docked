package runner

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/dockedapp/backend/internal/db"
)

// Image operations can be slower than control-plane calls (large image
// inventories), so they get a longer budget than the 10s control timeout.
const imageRequestTimeout = 30 * time.Second

// Image mirrors the dockhand GET /images entry shape (camelCase).
type Image struct {
	ID          string   `json:"id"`
	RepoTags    []string `json:"repoTags"`
	RepoDigests []string `json:"repoDigests"`
	Size        int64    `json:"size"`
	Created     int64    `json:"created"`
}

// GetImages lists all images on the runner's Docker host.
func GetImages(ctx context.Context, runner db.RunnerRow) ([]Image, error) {
	ctx, cancel := context.WithTimeout(ctx, imageRequestTimeout)
	defer cancel()

	var payload struct {
		Images []Image `json:"images"`
	}
	if err := getJSON(ctx, runner, "/images", &payload); err != nil {
		return nil, err
	}
	return payload.Images, nil
}

// FetchContainerImageIDs returns the Docker image IDs referenced by the
// runner's containers (running and stopped). Used to mark images as used
// when computing the unused-image set.
func FetchContainerImageIDs(ctx context.Context, runner db.RunnerRow) ([]string, error) {
	ctx, cancel := context.WithTimeout(ctx, imageRequestTimeout)
	defer cancel()

	var payload struct {
		Containers []struct {
			ImageID string `json:"imageId"`
		} `json:"containers"`
	}
	if err := getJSON(ctx, runner, "/containers", &payload); err != nil {
		return nil, err
	}
	ids := make([]string, 0, len(payload.Containers))
	for _, container := range payload.Containers {
		if container.ImageID != "" {
			ids = append(ids, container.ImageID)
		}
	}
	return ids, nil
}

// DeleteImage removes an image from the runner's Docker host.
func DeleteImage(ctx context.Context, runner db.RunnerRow, imageID string, force bool) error {
	ctx, cancel := context.WithTimeout(ctx, imageRequestTimeout)
	defer cancel()

	path := "/images/" + url.PathEscape(imageID) + fmt.Sprintf("?force=%v", force)
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, runner.URL+path, nil)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+runner.APIKey)
	return doRequest(req, nil)
}

func getJSON(ctx context.Context, runner db.RunnerRow, path string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, runner.URL+path, nil)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+runner.APIKey)
	return doRequest(req, out)
}

// doRequest executes a prepared runner request and optionally decodes the
// JSON response into out.
func doRequest(req *http.Request, out any) error {
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("request %s %s: %w", req.Method, req.URL.Path, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("runner %s %s: HTTP %d: %s", req.Method, req.URL.Path, resp.StatusCode, string(msg))
	}
	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			return fmt.Errorf("decode response: %w", err)
		}
	}
	return nil
}
