// Package portainer is a minimal HTTP client for Portainer CE instances.
// It covers the image-inventory surface the graph layer needs: endpoint
// discovery, container/image listings, image inspection, and image
// deletion. Mirrors the subset of Node's services/portainerService used
// by the unused-images and image-delete flows; the IP-fallback resilience
// layer from Node is intentionally not replicated here.
package portainer

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/dockedapp/backend/internal/db"
)

const requestTimeout = 15 * time.Second

// Client talks to a single Portainer instance.
type Client struct {
	inst  db.SourceInstanceRow
	httpc *http.Client
	token string // JWT from the username/password auth flow
}

func New(inst db.SourceInstanceRow) *Client {
	return &Client{inst: inst, httpc: &http.Client{Timeout: requestTimeout}}
}

func (c *Client) authType() string {
	if c.inst.AuthType == "" {
		return "apikey"
	}
	return c.inst.AuthType
}

// authenticate exchanges username/password for a JWT. The apikey flow has
// no separate auth step — the key rides on every request.
func (c *Client) authenticate(ctx context.Context) error {
	if c.authType() == "apikey" {
		if c.inst.APIKey.String == "" {
			return fmt.Errorf("portainer instance %q has no api key", c.inst.URL)
		}
		return nil
	}
	payload := map[string]string{
		"Username": c.inst.Username.String,
		"Password": c.inst.Password.String,
	}
	var out struct {
		JWT string `json:"jwt"`
	}
	if err := c.raw(ctx, http.MethodPost, "/api/auth", payload, &out, true); err != nil {
		return fmt.Errorf("portainer auth: %w", err)
	}
	if out.JWT == "" {
		return fmt.Errorf("portainer auth: empty jwt in response")
	}
	c.token = out.JWT
	return nil
}

func (c *Client) setAuth(req *http.Request, skipAuth bool) {
	if skipAuth {
		return
	}
	if c.authType() == "apikey" {
		req.Header.Set("X-API-Key", c.inst.APIKey.String)
		return
	}
	if c.token != "" {
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
}

// raw performs one request without the 401-retry loop (used by authenticate).
func (c *Client) raw(ctx context.Context, method, path string, body any, out any, skipAuth bool) error {
	ctx, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()

	var bodyReader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("marshal body: %w", err)
		}
		bodyReader = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.inst.URL+path, bodyReader)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	c.setAuth(req, skipAuth)

	resp, err := c.httpc.Do(req)
	if err != nil {
		return fmt.Errorf("request %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("portainer %s %s: HTTP %d: %s", method, path, resp.StatusCode, string(msg))
	}
	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			return fmt.Errorf("decode response: %w", err)
		}
	}
	return nil
}

// do performs a request, re-authenticating and retrying once on 401
// (Portainer JWTs expire after ~5 minutes). Password-flow requests
// authenticate lazily on first use.
func (c *Client) do(ctx context.Context, method, path string, out any) error {
	if c.authType() != "apikey" && c.token == "" {
		if err := c.authenticate(ctx); err != nil {
			return err
		}
	}
	err := c.raw(ctx, method, path, nil, out, false)
	if err == nil {
		return nil
	}
	if c.authType() != "apikey" && c.token != "" {
		if authErr := c.authenticate(ctx); authErr == nil {
			return c.raw(ctx, method, path, nil, out, false)
		}
	}
	return err
}

// Endpoint is a Portainer environment (Docker host).
type Endpoint struct {
	ID   int    `json:"Id"`
	Name string `json:"Name"`
}

// GetEndpoints lists the environments managed by this instance.
func (c *Client) GetEndpoints(ctx context.Context) ([]Endpoint, error) {
	if err := c.authenticate(ctx); err != nil {
		return nil, err
	}
	var out []Endpoint
	if err := c.do(ctx, http.MethodGet, "/api/endpoints", &out); err != nil {
		return nil, err
	}
	return out, nil
}

// ContainerSummary is the Docker list response for containers.
type ContainerSummary struct {
	ID      string `json:"Id"`
	ImageID string `json:"ImageID"`
}

// GetContainers lists all containers (running and stopped) on an endpoint.
func (c *Client) GetContainers(ctx context.Context, endpointID int) ([]ContainerSummary, error) {
	var out []ContainerSummary
	path := fmt.Sprintf("/api/endpoints/%d/docker/containers/json?all=true", endpointID)
	if err := c.do(ctx, http.MethodGet, path, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// Image is the Docker list response for images. Portainer formats Created
// as an RFC3339 string, but raw Docker returns unix seconds — keep it raw.
type Image struct {
	ID          string          `json:"Id"`
	RepoTags    []string        `json:"RepoTags"`
	RepoDigests []string        `json:"RepoDigests"`
	Size        int64           `json:"Size"`
	Created     json.RawMessage `json:"Created"`
}

// GetImages lists all images on an endpoint.
func (c *Client) GetImages(ctx context.Context, endpointID int) ([]Image, error) {
	var out []Image
	path := fmt.Sprintf("/api/endpoints/%d/docker/images/json", endpointID)
	if err := c.do(ctx, http.MethodGet, path, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// ImageDetail is the subset of the image inspect response used for
// tag/digest recovery when the list response omits them.
type ImageDetail struct {
	RepoTags    []string `json:"RepoTags"`
	RepoDigests []string `json:"RepoDigests"`
}

// InspectImage fetches full metadata for one image.
func (c *Client) InspectImage(ctx context.Context, endpointID int, imageID string) (*ImageDetail, error) {
	var out ImageDetail
	path := fmt.Sprintf("/api/endpoints/%d/docker/images/%s/json", endpointID, imageID)
	if err := c.do(ctx, http.MethodGet, path, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// DeleteImage removes an image from an endpoint.
func (c *Client) DeleteImage(ctx context.Context, endpointID int, imageID string, force bool) error {
	path := fmt.Sprintf("/api/endpoints/%d/docker/images/%s?force=%v", endpointID, imageID, force)
	return c.do(ctx, http.MethodDelete, path, nil)
}
