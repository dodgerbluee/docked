package handlers

// Browser-facing runner proxy routes (phase-4 commit B), ported from Node's
// runnerController + runnerService SSE plumbing: operations/apps listings,
// app history, and the three SSE streams (upgrade, operation run, app
// operation run). Node keeps the edge rate limiters and authenticate and
// streams these routes through utils/goRunnerProxy.js; response shapes must
// match Node exactly.

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/dockedapp/backend/internal/auth"
	"github.com/dockedapp/backend/internal/db"
	runnerpkg "github.com/dockedapp/backend/internal/runner"
)

// resolveRunnerUser mirrors the shared preamble of every Node handler: parse
// :runnerId, load the row scoped to the authed user, and reject missing (404)
// or disabled (400) runners with Node's exact envelopes.
func resolveRunnerUser(w http.ResponseWriter, r *http.Request, database *sql.DB) (*db.RunnerRow, bool) {
	userID := auth.UserIDFromContext(r.Context())
	if userID == 0 {
		runnerFail(w, http.StatusUnauthorized, "Authentication required")
		return nil, false
	}
	runnerID, err := strconv.ParseInt(chi.URLParam(r, "runnerId"), 10, 64)
	if err != nil {
		runnerFail(w, http.StatusNotFound, "Runner not found")
		return nil, false
	}
	rr, err := db.GetRunnerByID(r.Context(), database, runnerID, userID)
	if err != nil {
		slog.Error("runner API: lookup failed", "error", err.Error())
		runnerFail(w, http.StatusInternalServerError, "Internal server error")
		return nil, false
	}
	if rr == nil {
		runnerFail(w, http.StatusNotFound, "Runner not found")
		return nil, false
	}
	if !rr.Enabled {
		runnerFail(w, http.StatusBadRequest, "Runner is disabled")
		return nil, false
	}
	return rr, true
}

// runnerUpstreamFail mirrors Node's errorHandler axios branch: an upstream
// 401/403 is masked as 502 so the client's global logout interceptor never
// fires for a misconfigured runner API key.
func runnerUpstreamFail(w http.ResponseWriter, err error) {
	status := http.StatusBadGateway
	var he *runnerpkg.HTTPError
	if errors.As(err, &he) && he.Code != http.StatusUnauthorized && he.Code != http.StatusForbidden {
		status = he.Code
	}
	writeRunnerJSON(w, status, map[string]any{
		"success":   false,
		"error":     "Runner connection error: " + err.Error(),
		"errorCode": "RUNNER_CONNECTION_ERROR",
	})
}

// runnerList extracts a top-level array from a runner JSON payload; a missing
// or non-array value becomes an empty list (Node's `data.x ?? []`).
func runnerList(data map[string]any, key string) []any {
	list, _ := data[key].([]any)
	if list == nil {
		return []any{}
	}
	return list
}

// enrichWithVersions appends latestVersion to entries whose versionSource is
// a github+repo shape, mirroring Node's enrichOperationsWithVersions and
// enrichAppsWithVersions (raw tag_name, 1h-cached lookup, failures → null).
// Entries with type "command" or without a github versionSource pass through
// untouched — no latestVersion key at all.
func enrichWithVersions(ctx context.Context, items []any) []any {
	out := make([]any, 0, len(items))
	for _, item := range items {
		m, ok := item.(map[string]any)
		if !ok {
			out = append(out, item)
			continue
		}
		vs, _ := m["versionSource"].(map[string]any)
		if vs == nil || vs["type"] == "command" {
			out = append(out, m)
			continue
		}
		repo, _ := vs["repo"].(string)
		if vs["type"] != "github" || repo == "" {
			out = append(out, m)
			continue
		}
		tag, ok := runnerpkg.LatestReleaseTag(ctx, repo, false)
		if !ok {
			m["latestVersion"] = nil
		} else {
			m["latestVersion"] = tag
		}
		out = append(out, m)
	}
	return out
}

// RunnerOperations proxies GET {runner}/operations and enriches github-sourced
// entries with the latest release tag.
func RunnerOperations(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rr, ok := resolveRunnerUser(w, r, database)
		if !ok {
			return
		}
		data, err := runnerpkg.FetchJSON(r.Context(), *rr, "/operations", nil)
		if err != nil {
			runnerUpstreamFail(w, err)
			return
		}
		runnerOK(w, http.StatusOK, map[string]any{
			"operations": enrichWithVersions(r.Context(), runnerList(data, "operations")),
		})
	}
}

// RunnerApps proxies GET {runner}/apps with the same version enrichment.
func RunnerApps(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rr, ok := resolveRunnerUser(w, r, database)
		if !ok {
			return
		}
		data, err := runnerpkg.FetchJSON(r.Context(), *rr, "/apps", nil)
		if err != nil {
			runnerUpstreamFail(w, err)
			return
		}
		runnerOK(w, http.StatusOK, map[string]any{
			"apps": enrichWithVersions(r.Context(), runnerList(data, "apps")),
		})
	}
}

// RunnerAppsHistory proxies GET {runner}/apps/history?limit=N and attaches
// runnerId/runnerName to each record for the client to group and label.
func RunnerAppsHistory(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rr, ok := resolveRunnerUser(w, r, database)
		if !ok {
			return
		}
		// Node: parseInt(req.query.limit, 10) || 100 — unparseable and 0
		// both fall back to 100; negatives pass through.
		limit := 100
		if raw := r.URL.Query().Get("limit"); raw != "" {
			if n, err := strconv.Atoi(raw); err == nil && n != 0 {
				limit = n
			}
		}
		data, err := runnerpkg.FetchJSON(r.Context(), *rr, "/apps/history",
			url.Values{"limit": []string{strconv.Itoa(limit)}})
		if err != nil {
			runnerUpstreamFail(w, err)
			return
		}
		history := runnerList(data, "history")
		for _, item := range history {
			if m, ok := item.(map[string]any); ok {
				m["runnerId"] = rr.ID
				m["runnerName"] = rr.Name
			}
		}
		runnerOK(w, http.StatusOK, map[string]any{"history": history})
	}
}

// streamRunnerSSE mirrors Node's proxy*Stream plumbing: SSE headers are
// flushed before the upstream connection is attempted, so connect failures
// arrive as an SSE error event on a 200 response, never an HTTP status. The
// upstream inherits r.Context(), so a client disconnect (the Node bridge
// tearing down proxyReq, or qbit-proxy dropping Go directly) cancels the
// runner stream.
func streamRunnerSSE(w http.ResponseWriter, r *http.Request, rr *db.RunnerRow, method, path string) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	rc := http.NewResponseController(w)
	rc.Flush()

	resp, err := runnerpkg.OpenSSEStream(r.Context(), *rr, method, path)
	if err != nil {
		slog.Error("runner SSE connect failed", "runnerId", rr.ID, "path", path, "error", err.Error())
		writeSSEErrorEvent(w, rc, err.Error())
		return
	}
	defer resp.Body.Close()

	buf := make([]byte, 32*1024)
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, err := w.Write(buf[:n]); err != nil {
				return // browser gone; context cancellation ends the upstream
			}
			rc.Flush()
		}
		if readErr != nil {
			if readErr != io.EOF {
				slog.Error("runner SSE stream error", "runnerId", rr.ID, "path", path, "error", readErr.Error())
				writeSSEErrorEvent(w, rc, readErr.Error())
			}
			return
		}
	}
}

func writeSSEErrorEvent(w http.ResponseWriter, rc *http.ResponseController, message string) {
	payload, _ := json.Marshal(map[string]string{"message": message})
	w.Write(append([]byte("event: error\ndata: "), append(payload, '\n', '\n')...))
	rc.Flush()
}

// lockOwnerLabel strips the ":<uuid>" suffix Node's lock manager appends to
// the owner column so the 409 message names the holding subsystem
// ("intent:42", "runner-sse") the way Node's in-memory map does.
func lockOwnerLabel(token string) string {
	if i := strings.LastIndex(token, ":"); i > 0 {
		return token[:i]
	}
	return token
}

// RunnerUpgradeStream proxies the runner's upgrade SSE stream while holding
// the shared cross-process upgrade lock (key runner:<runnerId>:<containerId>,
// owner token runner-sse:<uuid>) so it cannot race intent-driven, batch, or
// GraphQL-pipeline upgrades.
func RunnerUpgradeStream(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rr, ok := resolveRunnerUser(w, r, database)
		if !ok {
			return
		}
		containerID := chi.URLParam(r, "containerId")
		targetKey := "runner:" + strconv.FormatInt(rr.ID, 10) + ":" + containerID
		lockToken := "runner-sse:" + uuid.NewString()

		locked, err := db.AcquireUpgradeLock(r.Context(), database, targetKey, lockToken)
		if err != nil {
			slog.Error("runner upgrade: lock acquire failed", "error", err.Error())
			runnerFail(w, http.StatusInternalServerError, "Internal server error")
			return
		}
		if !locked {
			owner := "unknown"
			if held, found, err := db.GetActiveUpgradeLockOwner(r.Context(), database, targetKey); err == nil && found {
				owner = lockOwnerLabel(held)
			}
			runnerFail(w, http.StatusConflict, "Upgrade already in progress (locked by "+owner+")")
			return
		}
		defer db.ReleaseUpgradeLock(context.Background(), database, targetKey, lockToken)

		// Node's lock manager heartbeats every 60s; mirror it so long-running
		// upgrades keep the ten-minute lease alive.
		stop := make(chan struct{})
		defer close(stop)
		go func() {
			ticker := time.NewTicker(time.Minute)
			defer ticker.Stop()
			for {
				select {
				case <-ticker.C:
					if err := db.RefreshUpgradeLock(context.Background(), database, targetKey, lockToken); err != nil {
						slog.Warn("runner upgrade: lock refresh failed", "error", err.Error())
					}
				case <-stop:
					return
				}
			}
		}()

		streamRunnerSSE(w, r, rr, http.MethodPost,
			"/containers/"+url.PathEscape(containerID)+"/upgrade")
	}
}

// RunRunnerOperation proxies a live named-operation run stream.
func RunRunnerOperation(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rr, ok := resolveRunnerUser(w, r, database)
		if !ok {
			return
		}
		streamRunnerSSE(w, r, rr, http.MethodPost,
			"/operations/"+url.PathEscape(chi.URLParam(r, "name"))+"/run")
	}
}

// RunRunnerAppOperation proxies a live app-operation run stream.
func RunRunnerAppOperation(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rr, ok := resolveRunnerUser(w, r, database)
		if !ok {
			return
		}
		streamRunnerSSE(w, r, rr, http.MethodPost,
			"/apps/"+url.PathEscape(chi.URLParam(r, "appName"))+
				"/operations/"+url.PathEscape(chi.URLParam(r, "opName"))+"/run")
	}
}
