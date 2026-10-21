package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/dockedapp/backend/internal/db"
	runnerpkg "github.com/dockedapp/backend/internal/runner"
)

// Agent-facing endpoints (unauthenticated, called by dockhand and the
// generated install script). Ported from Node's runnerController:
// serveInstallScript / registerRunner / heartbeatRunner / reEnrollRunner.

// ServeInstallScript handles GET /api/runners/install/{token}: renders the
// single-use systemd installer with the enrollment token baked in.
func ServeInstallScript(dockedURLOverride string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := chi.URLParam(r, "token")
		if len(token) < 32 {
			w.Header().Set("Content-Type", "text/plain")
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte("Invalid token"))
			return
		}

		dockedURL := runnerpkg.DockedURL(r, dockedURLOverride)

		// Bypass the cache so installs always download the newest binary.
		// Node quirk kept: when the GitHub lookup fails the version falls back
		// to "latest", which GenerateInstallScript then rejects (semver-only)
		// and the endpoint surfaces a 500 instead of baking "latest" in.
		dockhandVersion := runnerpkg.LatestDockhandVersion(r.Context(), true)

		script, err := runnerpkg.GenerateInstallScript(runnerpkg.InstallScriptParams{
			Token:           token,
			DockedURL:       dockedURL,
			DockhandVersion: dockhandVersion,
			Port:            7777,
		})
		if err != nil {
			slog.Warn("install script generation failed", "error", err.Error())
			runnerFail(w, http.StatusInternalServerError, err.Error())
			return
		}

		w.Header().Set("Content-Type", "text/x-shellscript")
		w.Header().Set("Content-Disposition", "inline")
		w.Write([]byte(script))
	}
}

// RegisterRunner handles POST /api/runners/register: dockhand's first-boot
// registration, authenticated by a single-use enrollment token.
func RegisterRunner(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Token  string `json:"token"`
			Name   string `json:"name"`
			URL    string `json:"url"`
			APIKey string `json:"apiKey"`
		}
		if !decodeRunnerBody(w, r, &body) {
			return
		}
		if body.Token == "" || body.Name == "" || body.URL == "" || body.APIKey == "" {
			runnerFail(w, http.StatusBadRequest, "token, name, url, and apiKey are required")
			return
		}

		canonicalURL, ok := parseRunnerURL(body.URL)
		if !ok {
			runnerFail(w, http.StatusBadRequest, "URL must use http:// or https://")
			return
		}

		userID, ok := db.ConsumeEnrollmentToken(r.Context(), database, body.Token)
		if !ok {
			runnerFail(w, http.StatusUnauthorized, "Invalid, expired, or already used enrollment token")
			return
		}

		storedURL := strings.TrimSuffix(canonicalURL, "/")
		runnerID, err := db.CreateRunner(r.Context(), database, userID, strings.TrimSpace(body.Name), storedURL, body.APIKey)
		if err != nil {
			slog.Error("runner enrollment token consumed but runner creation failed",
				"userID", userID, "name", body.Name, "error", err.Error())
			runnerFail(w, http.StatusInternalServerError,
				"Runner enrollment token was consumed but runner creation failed. Please generate a new enrollment token and try again.")
			return
		}

		// Lets the browser's enrollment-status polling resolve this token.
		setEnrollmentResult(body.Token, runnerID)

		slog.Info("runner registered via enrollment", "runnerID", runnerID, "name", body.Name)

		details, _ := json.Marshal(map[string]any{"name": body.Name, "url": storedURL})
		_ = db.InsertRunnerEvent(r.Context(), database, runnerID, db.EventEnrolled,
			`Runner "`+body.Name+`" enrolled from `+storedURL, string(details))

		runnerOK(w, http.StatusCreated, map[string]any{
			"runnerId": runnerID,
			"message":  "Runner registered successfully",
		})
	}
}

// HeartbeatRunner handles POST /api/runners/heartbeat: periodic dockhand
// liveness report, authenticated by the runner's API key in the body. Keeps
// last_seen, docker status, and (when the box moved) the stored URL fresh.
// A URL change also clears the version poller's backoff for that runner —
// the old URL may have been causing ping failures (Node's resetRunnerBackoff
// bridge hook, now in-process).
func HeartbeatRunner(database *sql.DB, poller *runnerpkg.VersionPoller) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			APIKey   string `json:"apiKey"`
			URL      string `json:"url"`
			Version  string `json:"version"`
			Name     string `json:"name"`
			DockerOk *bool  `json:"dockerOk"`
		}
		if !decodeRunnerBody(w, r, &body) {
			return
		}
		if body.APIKey == "" || body.URL == "" {
			runnerFail(w, http.StatusBadRequest, "apiKey and url are required")
			return
		}

		rn, err := db.GetRunnerByAPIKey(r.Context(), database, body.APIKey)
		if err != nil {
			runnerFail(w, http.StatusInternalServerError, "heartbeat lookup failed")
			return
		}
		if rn == nil {
			runnerFail(w, http.StatusUnauthorized, "unknown")
			return
		}

		canonicalURL := strings.TrimRight(body.URL, "/")
		urlChanged := rn.URL != canonicalURL

		_ = db.UpdateRunnerLastSeen(r.Context(), database, rn.ID)

		if body.DockerOk != nil {
			dockerStatus := "unavailable"
			if *body.DockerOk {
				dockerStatus = "ok"
			}
			changed, err := db.UpdateRunnerDockerStatus(r.Context(), database, rn.ID, dockerStatus)
			if err == nil && changed {
				from := "unknown"
				if rn.DockerStatus.Valid {
					from = rn.DockerStatus.String
				}
				details, _ := json.Marshal(map[string]any{"from": from, "to": dockerStatus})
				_ = db.InsertRunnerEvent(r.Context(), database, rn.ID, db.EventDockerChange,
					`Docker status changed to "`+dockerStatus+`" (via heartbeat)`, string(details))
			}
		}

		if urlChanged {
			slog.Info("runner URL changed via heartbeat",
				"runnerID", rn.ID, "name", rn.Name, "from", rn.URL, "to", canonicalURL)
			poller.ResetBackoff(rn.ID)
			if err := db.UpdateRunnerURL(r.Context(), database, rn.ID, canonicalURL); err == nil {
				details, _ := json.Marshal(map[string]any{"from": rn.URL, "to": canonicalURL})
				_ = db.InsertRunnerEvent(r.Context(), database, rn.ID, db.EventURLChange,
					"URL changed: "+rn.URL+" → "+canonicalURL, string(details))
			}
		}

		if body.Version != "" {
			if rn.Version.Valid && body.Version != rn.Version.String {
				details, _ := json.Marshal(map[string]any{"from": rn.Version.String, "to": body.Version})
				_ = db.InsertRunnerEvent(r.Context(), database, rn.ID, db.EventVersionChange,
					"Version changed: "+rn.Version.String+" → "+body.Version, string(details))
			}

			// Fire-and-forget: persist reported version plus the latest known
			// dockhand release (cached lookup, mirrors Node's then-chain).
			go func() {
				latest, ok := runnerpkg.LatestReleaseTag(context.Background(), runnerpkg.DockhandRepo, false)
				var latestPtr *string
				if ok {
					latestPtr = &latest
				}
				version := body.Version
				if err := db.UpdateRunnerVersion(context.Background(), database, rn.ID, rn.UserID, &version, latestPtr, body.DockerOk); err != nil {
					slog.Warn("heartbeat version persist failed", "error", err.Error())
				}
			}()
		}

		runnerOK(w, http.StatusOK, map[string]any{
			"runnerId":   rn.ID,
			"urlUpdated": urlChanged,
		})
	}
}

// ReEnrollRunner handles POST /api/runners/re-enroll: lets a dockhand whose
// stored API key went stale (e.g. after a DB rebuild) replace its key and URL.
// Only existing runners can be touched; when a key is on file it must be
// presented via the Authorization header.
func ReEnrollRunner(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Name   string `json:"name"`
			URL    string `json:"url"`
			APIKey string `json:"apiKey"`
		}
		if !decodeRunnerBody(w, r, &body) {
			return
		}
		if body.Name == "" || body.URL == "" || body.APIKey == "" {
			runnerFail(w, http.StatusBadRequest, "name, url, and apiKey are required")
			return
		}

		canonicalURL, ok := parseRunnerURL(body.URL)
		if !ok {
			runnerFail(w, http.StatusBadRequest, "URL must use http:// or https://")
			return
		}
		canonicalURL = strings.TrimRight(canonicalURL, "/")

		rn, err := db.GetRunnerByName(r.Context(), database, body.Name)
		if err != nil {
			runnerFail(w, http.StatusInternalServerError, "runner lookup failed")
			return
		}
		if rn == nil {
			runnerFail(w, http.StatusNotFound,
				"No runner with that name exists. Use the enrollment flow to register a new runner.")
			return
		}

		// If a key is on file, the runner must prove ownership of it. Re-
		// enrollment without verification is only allowed when the stored key
		// is empty (DB rebuild scenario).
		if rn.APIKey != "" {
			bearerKey := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			if bearerKey == "" || !db.APIKeysEqual(bearerKey, rn.APIKey) {
				slog.Warn("re-enrollment rejected — API key mismatch", "name", body.Name)
				runnerFail(w, http.StatusUnauthorized,
					"Current API key verification failed. The runner must present its existing API key.")
				return
			}
		}

		if err := db.UpdateRunnerAPIKey(r.Context(), database, rn.ID, body.APIKey, canonicalURL); err != nil {
			runnerFail(w, http.StatusInternalServerError, "runner update failed")
			return
		}

		slog.Info("runner re-enrolled with new API key", "runnerID", rn.ID, "name", body.Name)

		details, _ := json.Marshal(map[string]any{"name": body.Name, "url": canonicalURL, "previousUrl": rn.URL})
		_ = db.InsertRunnerEvent(r.Context(), database, rn.ID, db.EventReEnrolled,
			`Runner "`+body.Name+`" re-enrolled from `+canonicalURL, string(details))

		runnerOK(w, http.StatusOK, map[string]any{"runnerId": rn.ID})
	}
}
