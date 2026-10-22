package handlers

// Debug endpoints (admin-only introspection), ported from Node's
// debugController + routes/debug.js. Same URL contract, same gating:
// the whole surface is off unless the debug_endpoints_enabled system setting
// is "true", and every handler additionally requires instance admin.
//
// The Go port reports Go-process state (uptime, memory, caches, the shared
// SQLite upgrade_locks table) where Node reported its own in-memory state —
// after the cutover Go is the process that owns that state.

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/dockedapp/backend/internal/auth"
	"github.com/dockedapp/backend/internal/config"
	"github.com/dockedapp/backend/internal/db"
	"github.com/dockedapp/backend/internal/imagesync"
	runnerpkg "github.com/dockedapp/backend/internal/runner"
)

// DebugRoutes mounts the /api/debug surface. Callers must already have run
// the strict auth middleware (Node mounts the router after authenticate).
// syncSvc may be nil; its digest cache is then omitted from cache reports.
func DebugRoutes(r chi.Router, database *sql.DB, cfg *config.Config, syncSvc *imagesync.Service) {
	// Arbitrary SQL runs on a dedicated READ-ONLY connection: the prefix
	// allowlist is bypassable (WITH x AS (...) INSERT/UPDATE, PRAGMA writes),
	// so enforcement must happen at the engine level, not in string checks.
	roDB, roErr := db.OpenReadOnly(cfg.DBPath)
	r.Use(debugGate(database))
	r.Get("/health", debugHealth(database))
	r.Get("/cache", debugCacheState(database, syncSvc))
	r.Get("/locks", debugLockState(database))
	r.Get("/logs", debugServerLogs(database, cfg))
	r.Get("/db/queries", debugQueryCatalog(database))
	r.Post("/db", debugRunQuery(database, roDB, roErr))
	r.Post("/cache/clear", debugClearCaches(database, syncSvc))
	r.Handle("/runner/{runnerId}/*", debugRunnerProxy(database))
}

// debugGate rejects everything unless debug_endpoints_enabled == "true"
// (Node's requireDebugEnabled, same 403/500 bodies).
func debugGate(database *sql.DB) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			value, err := db.GetSystemSetting(r.Context(), database, "debug_endpoints_enabled")
			if err != nil {
				runnerFail(w, http.StatusInternalServerError, "Failed to check debug setting: "+err.Error())
				return
			}
			if value == nil || *value != "true" {
				runnerFail(w, http.StatusForbidden, "Debug endpoints are disabled. Enable them in Admin → General Settings.")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// debugAdminUser resolves the authenticated user and enforces instance
// admin (Node's requireAdmin(req.user.instanceAdmin)).
func debugAdminUser(w http.ResponseWriter, r *http.Request, database *sql.DB) (int64, bool) {
	userID, ok := auth.UserID(r.Context())
	if !ok {
		runnerFail(w, http.StatusUnauthorized, "Authentication required")
		return 0, false
	}
	user, err := db.GetUserByID(r.Context(), database, userID)
	if err != nil || user == nil || user.InstanceAdmin != 1 {
		runnerFail(w, http.StatusForbidden, "Instance admin access required")
		return 0, false
	}
	return userID, true
}

// ── GET /api/debug/health ───────────────────────────────────────────────────

func debugHealth(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := debugAdminUser(w, r, database); !ok {
			return
		}
		var mem runtime.MemStats
		runtime.ReadMemStats(&mem)

		hostname, _ := os.Hostname()
		var load [3]float64
		if l, err := loadAvg(); err == nil {
			load = l
		}

		// Node's quick DB connectivity check: {tables: N} or {error: msg}.
		var tables int
		dbStats := map[string]any{}
		if err := database.QueryRowContext(r.Context(),
			"SELECT count(*) as tables FROM sqlite_master WHERE type='table'").Scan(&tables); err != nil {
			dbStats["error"] = err.Error()
		} else {
			dbStats["tables"] = tables
		}
		lockCount, _ := db.CountActiveUpgradeLocks(r.Context(), database)

		// nodeVersion keeps its name for tooling continuity; the value is
		// the Go runtime (runtime.Version()).
		runnerOK(w, http.StatusOK, map[string]any{
			"status":        "ok",
			"uptimeSeconds": int64(time.Since(processStart).Seconds()),
			"nodeVersion":   runtime.Version(),
			"platform":      runtime.GOOS,
			"arch":          runtime.GOARCH,
			"pid":           os.Getpid(),
			"hostname":      hostname,
			"loadAvg":       []float64{load[0], load[1], load[2]},
			"freeMemMB":     sysFreeMemMB(),
			"totalMemMB":    sysTotalMemMB(),
			"processMemMB": map[string]any{
				"rss":       procRSSMB(),
				"heapUsed":  int(mem.HeapAlloc / 1024 / 1024),
				"heapTotal": int(mem.HeapSys / 1024 / 1024),
			},
			"db":           dbStats,
			"upgradeLocks": lockCount,
		})
	}
}

// loadAvg returns the 1/5/15-minute load averages (Node's os.loadavg()).
func loadAvg() ([3]float64, error) { return sysLoadAvg() }

// ── POST /api/debug/db ──────────────────────────────────────────────────────

// dbQueryCatalog ports DB_QUERY_CATALOG verbatim; dbQueryOrder preserves
// Node's Object.keys insertion order for the catalog listing.
var dbQueryOrder = []string{
	"list-tables", "schema", "containers", "containers-count", "runners",
	"upgrade-history", "upgrade-history-failed", "settings", "system-settings",
	"registry-image-versions", "batch-runs", "deployed-images",
}

var dbQueryCatalog = map[string]string{
	"list-tables":            "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY name",
	"schema":                 "SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','view') ORDER BY name",
	"containers":             "SELECT id, user_id, container_id, runner_id, source_instance_id, endpoint_id, image_name, container_name, created_at FROM containers ORDER BY created_at DESC LIMIT 100",
	"containers-count":       "SELECT COUNT(*) AS count FROM containers",
	"runners":                "SELECT id, user_id, name, url, enabled, docker_enabled, version, latest_version, last_seen, docker_status, created_at FROM runners ORDER BY created_at ASC",
	"upgrade-history":        "SELECT id, user_id, container_id, runner_id, runner_name, old_image, new_image, status, created_at FROM upgrade_history ORDER BY created_at DESC LIMIT 100",
	"upgrade-history-failed": "SELECT id, user_id, container_id, runner_id, runner_name, old_image, new_image, status, error_message, created_at FROM upgrade_history WHERE status = 'failed' ORDER BY created_at DESC LIMIT 50",
	"settings":               "SELECT key, user_id, SUBSTR(value, 1, 200) AS value_preview, created_at FROM settings ORDER BY user_id, key",
	// System settings live in settings with user_id = 0 (see db.GetSystemSetting);
	// the old system_settings table was folded into settings by a Node-era migration.
	"system-settings":         "SELECT key, value, created_at FROM settings WHERE user_id = 0 ORDER BY key",
	"registry-image-versions": "SELECT id, user_id, registry, namespace, repository, tag, latest_digest, updated_at FROM registry_image_versions ORDER BY updated_at DESC LIMIT 100",
	"batch-runs":              "SELECT id, user_id, job_type, status, containers_checked, containers_updated, started_at, completed_at FROM batch_runs ORDER BY started_at DESC LIMIT 20",
	"deployed-images":         "SELECT id, user_id, image_repo, image_tag, image_digest, registry, namespace, repository, last_seen FROM deployed_images ORDER BY last_seen DESC LIMIT 50",
}

// allowedSQLPrefixes ports ALLOWED_SQL_PREFIXES.
var allowedSQLPrefixes = []string{"select", "explain", "pragma", "with"}

func isReadOnlySQL(sqlText string) bool {
	fields := strings.Fields(strings.ToLower(strings.TrimSpace(sqlText)))
	if len(fields) == 0 {
		return false
	}
	for _, p := range allowedSQLPrefixes {
		if fields[0] == p {
			return true
		}
	}
	return false
}

func debugQueryCatalog(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := debugAdminUser(w, r, database); !ok {
			return
		}
		names := make([]string, 0, len(dbQueryOrder))
		names = append(names, dbQueryOrder...)
		runnerOK(w, http.StatusOK, map[string]any{"queries": names})
	}
}

func debugRunQuery(database *sql.DB, roDB *sql.DB, roErr error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := debugAdminUser(w, r, database); !ok {
			return
		}
		var body struct {
			Query  string `json:"query"`
			SQL    string `json:"sql"`
			Params []any  `json:"params"`
		}
		if !decodeRunnerBody(w, r, &body) {
			return
		}

		available := func() []string {
			names := make([]string, 0, len(dbQueryOrder))
			names = append(names, dbQueryOrder...)
			return names
		}

		var sqlText, label string
		switch {
		case body.SQL != "":
			// Raw SQL path (MCP client): read-only statements only.
			if !isReadOnlySQL(body.SQL) {
				runnerFail(w, http.StatusBadRequest, "Only SELECT, EXPLAIN, PRAGMA, and WITH queries are allowed")
				return
			}
			sqlText, label = body.SQL, "raw"
		case body.Query != "":
			named, known := dbQueryCatalog[body.Query]
			if !known {
				writeRunnerJSON(w, http.StatusBadRequest, map[string]any{
					"success":   false,
					"error":     `Unknown query "` + body.Query + `"`,
					"available": available(),
				})
				return
			}
			sqlText, label = named, body.Query
		default:
			writeRunnerJSON(w, http.StatusBadRequest, map[string]any{
				"success":   false,
				"error":     "Either sql or query is required",
				"available": available(),
			})
			return
		}

		// JSON numbers arrive as float64; integers must reach SQLite as int64
		// so integer comparisons behave.
		params := make([]any, 0, len(body.Params))
		for _, p := range body.Params {
			if f, isFloat := p.(float64); isFloat && f == float64(int64(f)) {
				params = append(params, int64(f))
			} else {
				params = append(params, p)
			}
		}

		if roErr != nil {
			slog.Error("debug: read-only db handle unavailable", "error", roErr.Error())
			runnerFail(w, http.StatusServiceUnavailable, "debug database unavailable")
			return
		}

		rows, err := queryRowsJSON(r.Context(), roDB, sqlText, params...)
		if err != nil {
			slog.Error("debug: runDbQuery error", "error", err.Error())
			runnerFail(w, http.StatusInternalServerError, err.Error())
			return
		}
		runnerOK(w, http.StatusOK, map[string]any{
			"rows":  rows,
			"count": len(rows),
			"query": label,
		})
	}
}

// queryRowsJSON runs a query and renders rows the way Node's sqlite driver
// handed them to res.json: BLOBs as strings, NULL as null, numbers as numbers.
func queryRowsJSON(ctx context.Context, database *sql.DB, sqlText string, params ...any) ([]map[string]any, error) {
	rows, err := database.QueryContext(ctx, sqlText, params...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	out := []map[string]any{}
	for rows.Next() {
		raw := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range raw {
			ptrs[i] = &raw[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		row := make(map[string]any, len(cols))
		for i, c := range cols {
			switch v := raw[i].(type) {
			case []byte:
				row[c] = string(v)
			case time.Time:
				row[c] = v.Format(time.RFC3339Nano)
			default:
				row[c] = v
			}
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// ── GET /api/debug/cache + POST /api/debug/cache/clear ─────────────────────

// goCaches reports the live in-process caches (Node reported its
// containerCacheService memory cache here; Go's equivalents are the release
// and digest caches that drive update detection).
func goCaches(syncSvc *imagesync.Service) map[string]any {
	caches := map[string]any{
		"imagesyncReleaseCache": map[string]any{"size": imagesync.ReleaseCacheSize()},
		"runnerReleaseCache":    map[string]any{"size": runnerpkg.ReleaseCacheSize()},
	}
	if syncSvc != nil {
		caches["digestCache"] = map[string]any{"size": syncSvc.Registry.DigestCacheSize()}
	}
	return caches
}

func debugCacheState(database *sql.DB, syncSvc *imagesync.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := debugAdminUser(w, r, database); !ok {
			return
		}
		runnerOK(w, http.StatusOK, map[string]any{
			"caches":    goCaches(syncSvc),
			"timestamp": isoNow(),
		})
	}
}

func debugClearCaches(database *sql.DB, syncSvc *imagesync.Service) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := debugAdminUser(w, r, database); !ok {
			return
		}
		imagesync.ClearReleaseCache()
		runnerpkg.ClearReleaseCache()
		if syncSvc != nil {
			syncSvc.Registry.ClearDigestCache()
		}
		runnerOK(w, http.StatusOK, map[string]any{"message": "All caches cleared"})
	}
}

// ── GET /api/debug/locks ────────────────────────────────────────────────────

func debugLockState(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := debugAdminUser(w, r, database); !ok {
			return
		}
		locks, err := db.ListActiveUpgradeLocks(r.Context(), database)
		if err != nil {
			slog.Error("debug: getLockState error", "error", err.Error())
			runnerFail(w, http.StatusInternalServerError, err.Error())
			return
		}
		out := []map[string]any{}
		for _, l := range locks {
			ageMs := int64(0)
			if t, err := db.ParseSQLiteTime(l.CreatedAt); err == nil {
				ageMs = time.Since(t).Milliseconds()
			}
			out = append(out, map[string]any{
				"key":        l.Key,
				"owner":      l.Owner,
				"acquiredAt": l.CreatedAt,
				"ageMs":      ageMs,
			})
		}
		runnerOK(w, http.StatusOK, map[string]any{"locks": out, "count": len(out)})
	}
}

// ── GET /api/debug/logs ─────────────────────────────────────────────────────

// allowedLogFiles ports ALLOWED_LOG_FILES (strict allowlist).
var allowedLogFiles = []string{"combined.log", "error.log"}

func debugServerLogs(database *sql.DB, cfg *config.Config) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := debugAdminUser(w, r, database); !ok {
			return
		}
		lines := 100
		if v, err := strconv.Atoi(r.URL.Query().Get("lines")); err == nil && v > 0 {
			lines = v
		}
		if lines > 2000 {
			lines = 2000
		}
		logFile := r.URL.Query().Get("file")
		if logFile == "" {
			logFile = "combined.log"
		}
		allowed := false
		for _, f := range allowedLogFiles {
			if f == logFile {
				allowed = true
				break
			}
		}
		if !allowed {
			runnerFail(w, http.StatusBadRequest, "Invalid log file. Allowed: "+strings.Join(allowedLogFiles, ", "))
			return
		}
		base, err := filepath.Abs(cfg.Edge.LogsDir)
		if err != nil {
			runnerFail(w, http.StatusInternalServerError, err.Error())
			return
		}
		data, err := os.ReadFile(filepath.Join(base, logFile))
		if err != nil {
			runnerOK(w, http.StatusOK, map[string]any{
				"lines": []string{}, "count": 0, "note": "Log file not found",
			})
			return
		}
		all := strings.Split(string(data), "\n")
		start := len(all) - lines
		if start < 0 {
			start = 0
		}
		recent := []string{}
		for _, l := range all[start:] {
			if strings.TrimSpace(l) != "" {
				recent = append(recent, l)
			}
		}
		runnerOK(w, http.StatusOK, map[string]any{
			"lines": recent, "count": len(recent), "totalLines": len(all),
		})
	}
}

// ── ALL /api/debug/runner/:runnerId/* ───────────────────────────────────────

var multiSlash = regexp.MustCompile(`/+`)

func debugRunnerProxy(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID, ok := debugAdminUser(w, r, database)
		if !ok {
			return
		}
		id, err := strconv.ParseInt(chi.URLParam(r, "runnerId"), 10, 64)
		if err != nil {
			runnerFail(w, http.StatusNotFound, "Runner not found")
			return
		}
		rr, err := db.GetRunnerByID(r.Context(), database, id, userID)
		if err != nil || rr == nil {
			runnerFail(w, http.StatusNotFound, "Runner not found")
			return
		}
		if rr.APIKey == "" {
			runnerFail(w, http.StatusBadRequest, "Runner has no API key configured")
			return
		}

		remainder := chi.URLParam(r, "*")
		runnerPath := multiSlash.ReplaceAllString("/debug/"+remainder, "/")

		// Node re-sent the express-parsed body ({} when empty) for every
		// method axios allowed a payload on.
		var body any
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			var m map[string]any
			dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
			if err := dec.Decode(&m); err != nil {
				runnerFail(w, http.StatusBadRequest, "Invalid request body")
				return
			}
			if m == nil {
				m = map[string]any{}
			}
			body = m
		}

		status, data, err := runnerpkg.DebugProxyRequest(r.Context(), *rr, r.Method, runnerPath, r.URL.Query(), body)
		if err != nil {
			slog.Error("debug: proxyToRunner error", "error", err.Error())
			runnerFail(w, http.StatusBadGateway, "Runner proxy error: "+err.Error())
			return
		}
		// Node piped the runner payload through responseFormatter: objects
		// already carrying a success field pass through untouched, 2xx bodies
		// gain success:true, 4xx/5xx bodies collapse to the standard error
		// envelope (error → message → "An error occurred", plus details /
		// missingFields when present).
		if m, isMap := data.(map[string]any); isMap {
			if _, has := m["success"]; has {
				writeRunnerJSON(w, status, m)
				return
			}
			if status >= 200 && status < 300 {
				m["success"] = true
				writeRunnerJSON(w, status, m)
			} else {
				out := map[string]any{"success": false}
				msg, _ := m["error"].(string)
				if msg == "" {
					msg, _ = m["message"].(string)
				}
				if msg == "" {
					msg = "An error occurred"
				}
				out["error"] = msg
				if d, ok := m["details"]; ok {
					out["details"] = d
				}
				if d, ok := m["missingFields"]; ok {
					out["missingFields"] = d
				}
				writeRunnerJSON(w, status, out)
			}
			return
		}
		// Non-object payload (runner answered with text or an array): Node's
		// formatter spreads it, which is degenerate either way; keep the
		// envelope shape.
		if status >= 200 && status < 300 {
			writeRunnerJSON(w, status, map[string]any{"success": true, "data": data})
		} else {
			writeRunnerJSON(w, status, map[string]any{"success": false, "error": "An error occurred"})
		}
	}
}
