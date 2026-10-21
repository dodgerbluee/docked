package handlers

import (
	"encoding/json"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/dockedapp/backend/internal/config"
)

// processStart backs the debug health endpoint's uptime counter.
var processStart = time.Now()

// Health serves GET /api/health. Node's handler returned {status:"ok"} and
// responseFormatter wrapped it; the client-visible body is exactly this.
func Health() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		runnerOK(w, http.StatusOK, map[string]any{"status": "ok"})
	}
}

// versionFile is the subset of package.json the version endpoint reads.
type versionFile struct {
	Version string `json:"version"`
}

// Version serves GET /api/version, a faithful port of Node's
// versionController.getVersion: multi-location package.json lookup, the
// isDevBuild tri-state rules, and graceful null-version degradation.
func Version(cfg *config.Config) http.HandlerFunc {
	// Node tries root package.json first, then server/package.json; the Go
	// binary's cwd varies (Docker: /app, dev: backend/), so probe the same
	// relative candidates.
	candidates := []string{"package.json", "../package.json"}
	if cfg.Edge.PackageJSON != "" {
		candidates = []string{cfg.Edge.PackageJSON}
	}
	env := cfg.Edge.NodeEnv
	if env == "" {
		env = "development"
	}

	return func(w http.ResponseWriter, r *http.Request) {
		var pkg versionFile
		found := false
		for _, p := range candidates {
			data, err := os.ReadFile(p)
			if err != nil {
				continue
			}
			if err := json.Unmarshal(data, &pkg); err != nil {
				continue
			}
			found = true
			break
		}
		if !found {
			// Node's fallback omits isDevBuild entirely.
			runnerOK(w, http.StatusOK, map[string]any{
				"version":     nil,
				"environment": env,
			})
			return
		}
		version := pkg.Version
		if version == "" {
			version = ""
		}
		isDevelopment := env != "production"
		isDevBuild := false
		switch {
		case version == "1.0.0":
			// Unversioned local development.
			isDevBuild = true
		case version != "" && !strings.Contains(version, "-dev") && isDevelopment:
			// Versioned local development (running a master build locally).
			isDevBuild = true
		}
		out := map[string]any{
			"environment": env,
			"isDevBuild":  isDevBuild,
		}
		if version == "" {
			out["version"] = nil
		} else {
			out["version"] = version
		}
		runnerOK(w, http.StatusOK, out)
	}
}
