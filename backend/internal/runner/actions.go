// covering the operations the UI triggers from the server: health pings,
// restart, self-update, self-uninstall, and service log fetches.
// Mirrors Node's services/runnerService.js outbound calls.
package runner

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// Client talks to a single runner endpoint set.
type Client struct {
	httpc *http.Client
}

func New() *Client {
	return &Client{httpc: &http.Client{Timeout: requestTimeout}}
}

// Health is the decoded payload of the runner /health endpoint.
type Health struct {
	Version       *string `json:"version"`
	DockerOK      *bool   `json:"dockerOk"`
	UptimeSeconds *int64  `json:"uptimeSeconds"`
}

func (c *Client) do(ctx context.Context, method, baseURL, apiKey, path string, body any, out any) error {
	var bodyReader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("encode request: %w", err)
		}
		bodyReader = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(baseURL, "/")+path, bodyReader)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.httpc.Do(req)
	if err != nil {
		return fmt.Errorf("runner unreachable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("runner returned HTTP %d", resp.StatusCode)
	}
	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
			return fmt.Errorf("decode runner response: %w", err)
		}
	}
	return nil
}

// Ping fetches the runner health payload.
func (c *Client) Ping(ctx context.Context, baseURL, apiKey string) (*Health, error) {
	var h Health
	if err := c.do(ctx, http.MethodGet, baseURL, apiKey, "/health", nil, &h); err != nil {
		return nil, err
	}
	return &h, nil
}

// Restart triggers a restart of the dockhand service on the runner.
func (c *Client) Restart(ctx context.Context, baseURL, apiKey string) error {
	return c.do(ctx, http.MethodPost, baseURL, apiKey, "/restart", map[string]any{}, nil)
}

// Update triggers a self-update of the runner binary to the given version.
func (c *Client) Update(ctx context.Context, baseURL, apiKey, version string) error {
	return c.do(ctx, http.MethodPost, baseURL, apiKey, "/update", map[string]string{"version": version}, nil)
}

// Uninstall tells the runner to uninstall itself.
func (c *Client) Uninstall(ctx context.Context, baseURL, apiKey string) error {
	return c.do(ctx, http.MethodPost, baseURL, apiKey, "/uninstall", map[string]any{}, nil)
}

// LogsResult is the runner /logs payload.
type LogsResult struct {
	Lines []string `json:"lines"`
	Count int      `json:"count"`
}

// Logs fetches the runner's own service log lines.
func (c *Client) Logs(ctx context.Context, baseURL, apiKey string, lines int) (*LogsResult, error) {
	var res LogsResult
	path := fmt.Sprintf("/logs?lines=%d", lines)
	if err := c.do(ctx, http.MethodGet, baseURL, apiKey, path, nil, &res); err != nil {
		return nil, err
	}
	return &res, nil
}
