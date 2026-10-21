package handlers

import (
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"

	"github.com/dockedapp/backend/internal/db"
)

// Shared plumbing for the runner REST API (the dockhand agent protocol and
// the browser-facing runner routes migrated from Node's runnerController).
// Response shapes must match Node exactly: {"success":bool, ...} with an
// "error" string on failures — the client reads err.response.data.error.

func writeRunnerJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("runner API: JSON encode failed", "error", err.Error())
	}
}

func runnerOK(w http.ResponseWriter, status int, fields map[string]any) {
	fields["success"] = true
	writeRunnerJSON(w, status, fields)
}

func runnerFail(w http.ResponseWriter, status int, message string) {
	writeRunnerJSON(w, status, map[string]any{"success": false, "error": message})
}

// decodeRunnerBody decodes a JSON request body (capped at 1 MiB).
func decodeRunnerBody(w http.ResponseWriter, r *http.Request, v any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	if err := dec.Decode(v); err != nil {
		runnerFail(w, http.StatusBadRequest, "Invalid request body")
		return false
	}
	return true
}

// parseRunnerURL validates an http(s) runner URL and returns its canonical
// string form (parity with Node's `new URL(url).toString()` guard).
func parseRunnerURL(raw string) (string, bool) {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", false
	}
	return u.String(), true
}

// runnerRowJSON renders a runners table row in the exact snake_case shape the
// sqlite driver handed Node (NULLs become JSON null, booleans stay 0/1). The
// client's runner UI consumes these keys directly.
func runnerRowJSON(row db.RunnerRow) map[string]any {
	nullStr := func(s sql.NullString) any {
		if s.Valid {
			return s.String
		}
		return nil
	}
	out := map[string]any{
		"id":                  row.ID,
		"user_id":             row.UserID,
		"name":                row.Name,
		"url":                 row.URL,
		"api_key":             row.APIKey,
		"enabled":             boolInt(row.Enabled),
		"version":             nullStr(row.Version),
		"latest_version":      nullStr(row.LatestVersion),
		"version_checked_at":  nullStr(row.VersionCheckedAt),
		"last_seen":           nullStr(row.LastSeen),
		"docker_status":       nullStr(row.DockerStatus),
		"docker_status_since": nullStr(row.DockerStatusSince),
		"created_at":          row.CreatedAt,
		"updated_at":          row.UpdatedAt,
	}
	if row.DockerEnabled.Valid {
		out["docker_enabled"] = row.DockerEnabled.Int64
	} else {
		out["docker_enabled"] = nil
	}
	return out
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
