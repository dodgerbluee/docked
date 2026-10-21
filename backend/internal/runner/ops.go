package runner

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/dockedapp/backend/internal/db"
)

// Timeouts mirror Node's runnerDockerService: long for mutating ops (pull can
// take minutes), short for inspect-style reads.
const (
	opTimeout      = 120 * time.Second
	inspectTimeout = 10 * time.Second
)

// HTTPError carries the runner's status code so callers can branch on it
// (e.g. a 404 from inspect counts as "container stopped" in readiness polls).
type HTTPError struct {
	Code int
	Body string
}

func (e *HTTPError) Error() string {
	if e.Body != "" {
		return fmt.Sprintf("runner returned %d: %s", e.Code, e.Body)
	}
	return fmt.Sprintf("runner returned %d", e.Code)
}

func doRunner(ctx context.Context, rr db.RunnerRow, method, path string, query url.Values, body any, timeout time.Duration) (*http.Response, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)

	var rdr io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			cancel()
			return nil, fmt.Errorf("encode request body: %w", err)
		}
		rdr = bytes.NewReader(encoded)
	}
	u := rr.URL + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, u, rdr)
	if err != nil {
		cancel()
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+rr.APIKey)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		cancel()
		return nil, fmt.Errorf("runner request failed: %w", err)
	}
	if resp.StatusCode >= 400 {
		defer cancel()
		defer resp.Body.Close()
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, &HTTPError{Code: resp.StatusCode, Body: strings.TrimSpace(string(snippet))}
	}
	// The timeout must cover the body read, not just the headers: a
	// defer cancel() here would fire the moment doRunner returns and abort
	// any response body still in flight (large/slow runner payloads failed
	// with "context canceled"). Context ownership transfers to Body.Close().
	resp.Body = &cancelOnClose{ReadCloser: resp.Body, cancel: cancel}
	return resp, nil
}

// cancelOnClose ties a request's timeout context to its response body: the
// context stays alive while the caller streams the body and is released when
// the body is closed.
type cancelOnClose struct {
	io.ReadCloser
	cancel context.CancelFunc
}

func (c *cancelOnClose) Close() error {
	err := c.ReadCloser.Close()
	c.cancel()
	return err
}

// DebugProxyRequest forwards an arbitrary request to the runner (used by the
// admin debug proxy). Unlike doRunner it never converts non-2xx statuses to
// errors: the status and parsed JSON body are returned verbatim, mirroring
// Node's debugController.proxyToRunner (axios validateStatus: () => true).
func DebugProxyRequest(ctx context.Context, rr db.RunnerRow, method, path string, query url.Values, body any) (int, any, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	var rdr io.Reader
	if body != nil && method != http.MethodGet && method != http.MethodHead {
		encoded, err := json.Marshal(body)
		if err != nil {
			return 0, nil, fmt.Errorf("encode request body: %w", err)
		}
		rdr = bytes.NewReader(encoded)
	}
	u := rr.URL + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, u, rdr)
	if err != nil {
		return 0, nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+rr.APIKey)
	if rdr != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("runner request failed: %w", err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return 0, nil, fmt.Errorf("read runner response: %w", err)
	}
	// axios hands back parsed JSON when the content is JSON, raw text otherwise.
	var parsed any
	if err := json.Unmarshal(data, &parsed); err != nil {
		parsed = string(data)
	}
	return resp.StatusCode, parsed, nil
}

// InspectContainer returns the full Docker Engine inspect document
// (GET /containers/{id}/json), mirroring Node's runnerDockerService.
func InspectContainer(ctx context.Context, rr db.RunnerRow, containerID string) (map[string]any, error) {
	resp, err := doRunner(ctx, rr, http.MethodGet, "/containers/"+url.PathEscape(containerID)+"/json", nil, nil, inspectTimeout)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var details map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&details); err != nil {
		return nil, fmt.Errorf("decode inspect: %w", err)
	}
	return details, nil
}

func StopContainer(ctx context.Context, rr db.RunnerRow, containerID string) error {
	resp, err := doRunner(ctx, rr, http.MethodPost, "/containers/"+url.PathEscape(containerID)+"/stop", nil, map[string]any{}, opTimeout)
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

func StartContainer(ctx context.Context, rr db.RunnerRow, containerID string) error {
	resp, err := doRunner(ctx, rr, http.MethodPost, "/containers/"+url.PathEscape(containerID)+"/start", nil, map[string]any{}, opTimeout)
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

// PullImage pulls imageName on the runner (POST /images/pull). The tag is the
// segment after the LAST colon so registry host ports (host:5000/img) are not
// mistaken for tags; an untagged image sends an empty tag (docker default).
func PullImage(ctx context.Context, rr db.RunnerRow, imageName string) error {
	fromImage, tag := imageName, ""
	if idx := strings.LastIndex(imageName, ":"); idx > 0 && !strings.Contains(imageName[idx:], "/") {
		fromImage, tag = imageName[:idx], imageName[idx+1:]
	}
	resp, err := doRunner(ctx, rr, http.MethodPost, "/images/pull", nil,
		map[string]any{"fromImage": fromImage, "tag": tag}, opTimeout)
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

func RemoveContainer(ctx context.Context, rr db.RunnerRow, containerID string, force bool) error {
	q := url.Values{"force": {fmt.Sprintf("%t", force)}}
	resp, err := doRunner(ctx, rr, http.MethodDelete, "/containers/"+url.PathEscape(containerID), q, nil, opTimeout)
	if err != nil {
		return err
	}
	resp.Body.Close()
	return nil
}

// CreateContainer creates a container from a Docker Engine create config
// (POST /containers/create?name=...). The name keeps its leading slash,
// matching Node's pass-through of the inspect Name field.
func CreateContainer(ctx context.Context, rr db.RunnerRow, config map[string]any, name string) (string, error) {
	q := url.Values{"name": {name}}
	resp, err := doRunner(ctx, rr, http.MethodPost, "/containers/create", q, config, opTimeout)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var data struct {
		ID  string `json:"id"`
		ID2 string `json:"Id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", fmt.Errorf("decode create response: %w", err)
	}
	if data.ID2 != "" {
		return data.ID2, nil
	}
	return data.ID, nil
}

// GetContainerLogs returns plain log text for a container. The runner log
// endpoint is SSE-framed; the data: lines are unwrapped, mirroring Node's
// runnerDockerService.getContainerLogs.
func GetContainerLogs(ctx context.Context, rr db.RunnerRow, containerID string, tail int) (string, error) {
	q := url.Values{"tail": {fmt.Sprintf("%d", tail)}, "follow": {"false"}}
	resp, err := doRunner(ctx, rr, http.MethodGet, "/containers/"+url.PathEscape(containerID)+"/logs", q, nil, inspectTimeout)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil {
		return "", err
	}
	var lines []string
	for _, line := range strings.Split(string(raw), "\n") {
		if strings.HasPrefix(line, "data:") {
			lines = append(lines, strings.TrimPrefix(strings.TrimPrefix(line, "data:"), " "))
		}
	}
	return strings.Join(lines, "\n"), nil
}
