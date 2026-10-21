package runner

// Browser-facing runner API access (operations/apps listings and the SSE
// streams), ported from Node's runnerService. JSON calls use the same 10s
// budget as Node's runnerAxiosConfig; SSE streams run unbounded and inherit
// the caller's context so a browser disconnect cancels the upstream.

import (
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

const userAPITimeout = 10 * time.Second

// FetchJSON performs an authenticated GET against the runner and decodes the
// JSON object response. Non-2xx is reported as *HTTPError.
func FetchJSON(ctx context.Context, rr db.RunnerRow, path string, query url.Values) (map[string]any, error) {
	resp, err := doRunner(ctx, rr, http.MethodGet, path, query, nil, userAPITimeout)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var out map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("decode runner response: %w", err)
	}
	return out, nil
}

// OpenSSEStream opens an authenticated streaming request (POST for the
// upgrade and operation-run streams) with Accept: text/event-stream. There
// is no timeout: the stream lives as long as ctx does. Non-2xx is reported
// as *HTTPError, matching axios's validateStatus rejection.
func OpenSSEStream(ctx context.Context, rr db.RunnerRow, method, path string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, rr.URL+path, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+rr.APIKey)
	req.Header.Set("Accept", "text/event-stream")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("runner request failed: %w", err)
	}
	if resp.StatusCode >= 400 {
		defer resp.Body.Close()
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, &HTTPError{Code: resp.StatusCode, Body: strings.TrimSpace(string(snippet))}
	}
	return resp, nil
}
