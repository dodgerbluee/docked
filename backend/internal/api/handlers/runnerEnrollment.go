package handlers

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/dockedapp/backend/internal/auth"
	"github.com/dockedapp/backend/internal/db"
	runnerpkg "github.com/dockedapp/backend/internal/runner"
)

// Browser-facing enrollment endpoints: POST /api/runners/enrollment mints a
// single-use token plus ready-to-paste install commands; GET
// /api/runners/enrollment-status lets the modal poll until the runner lands.

// enrollmentResults maps an enrollment token to the runner that registered
// with it. Ephemeral by design (lost on restart) — the polling window is
// short. FIFO-evicted at 1000 entries and swept after 30 idle minutes,
// mirroring Node's Map semantics.
type enrollmentEntry struct {
	runnerID int64
	ts       int64
}

const enrollmentResultsMax = 1000

var (
	enrollmentMu     sync.Mutex
	enrollmentResult = map[string]enrollmentEntry{}
	enrollmentOrder  []string
)

func setEnrollmentResult(token string, runnerID int64) {
	enrollmentMu.Lock()
	defer enrollmentMu.Unlock()

	if _, exists := enrollmentResult[token]; !exists {
		if len(enrollmentOrder) >= enrollmentResultsMax {
			oldest := enrollmentOrder[0]
			enrollmentOrder = enrollmentOrder[1:]
			delete(enrollmentResult, oldest)
		}
		enrollmentOrder = append(enrollmentOrder, token)
	}
	enrollmentResult[token] = enrollmentEntry{runnerID: runnerID, ts: time.Now().UnixMilli()}
}

func getEnrollmentResult(token string) (int64, bool) {
	enrollmentMu.Lock()
	defer enrollmentMu.Unlock()
	entry, ok := enrollmentResult[token]
	if !ok {
		return 0, false
	}
	return entry.runnerID, true
}

// SweepEnrollmentResults drops in-memory entries older than 30 minutes.
func SweepEnrollmentResults() {
	enrollmentMu.Lock()
	defer enrollmentMu.Unlock()

	cutoff := time.Now().Add(-30 * time.Minute).UnixMilli()
	for token, entry := range enrollmentResult {
		if entry.ts < cutoff {
			delete(enrollmentResult, token)
		}
	}
	// Rebuild the FIFO order from the survivors (order within the map is
	// preserved by the insertion slice).
	kept := make([]string, 0, len(enrollmentResult))
	for _, token := range enrollmentOrder {
		if _, ok := enrollmentResult[token]; ok {
			kept = append(kept, token)
		}
	}
	enrollmentOrder = kept
}

// StartEnrollmentMaintenance mirrors Node's runnerController housekeeping:
// clean expired/used enrollment tokens from the DB on startup, then sweep
// both the DB table and the in-memory result map every 30 minutes.
func StartEnrollmentMaintenance(ctx context.Context, database *sql.DB) {
	if n, err := db.CleanupExpiredEnrollmentTokens(ctx, database); err != nil {
		slog.Warn("failed to clean up expired enrollment tokens on startup", "error", err.Error())
	} else if n > 0 {
		slog.Info("cleaned up expired enrollment tokens", "count", n)
	}

	ticker := time.NewTicker(30 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			SweepEnrollmentResults()
			if _, err := db.CleanupExpiredEnrollmentTokens(ctx, database); err != nil {
				slog.Warn("failed to clean up expired enrollment tokens", "error", err.Error())
			}
		}
	}
}

// CreateEnrollment handles POST /api/runners/enrollment.
func CreateEnrollment(database *sql.DB, dockedURLOverride string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := auth.UserIDFromContext(r.Context())
		if userID == 0 {
			runnerFail(w, http.StatusUnauthorized, "Authentication required")
			return
		}

		// Bypass the cache so new installs always target the newest release.
		dockhandVersion := runnerpkg.LatestDockhandVersion(r.Context(), true)

		token, expiresAt, err := db.CreateEnrollmentToken(r.Context(), database, userID)
		if err != nil {
			runnerFail(w, http.StatusInternalServerError, "failed to create enrollment token")
			return
		}

		dockedURL := runnerpkg.DockedURL(r, dockedURLOverride)
		installUrl := dockedURL + "/api/runners/install/" + token

		dockerRunCmd := strings.Join([]string{
			"docker run -d",
			"  --name dockhand",
			"  --restart unless-stopped",
			"  --network host",
			"  -v /var/run/docker.sock:/var/run/docker.sock",
			"  -v dockhand_data:/var/lib/dockhand",
			"  -e DOCKHAND_ENROLLMENT_TOKEN='" + token + "'",
			"  -e DOCKHAND_DOCKED_URL='" + dockedURL + "'",
			"  ghcr.io/dockedapp/dockhand:" + dockhandVersion,
		}, " \\\n")

		dockerComposeSnippet := strings.Join([]string{
			"services:",
			"  dockhand:",
			"    image: ghcr.io/dockedapp/dockhand:" + dockhandVersion,
			"    container_name: dockhand",
			"    restart: unless-stopped",
			"    network_mode: host",
			"    volumes:",
			"      - /var/run/docker.sock:/var/run/docker.sock",
			"      - dockhand_data:/var/lib/dockhand",
			"    environment:",
			"      - DOCKHAND_ENROLLMENT_TOKEN=" + token,
			"      - DOCKHAND_DOCKED_URL=" + dockedURL,
			"",
			"volumes:",
			"  dockhand_data:",
		}, "\n")

		runnerOK(w, http.StatusCreated, map[string]any{
			"token":           token,
			"expiresAt":       expiresAt,
			"dockhandVersion": dockhandVersion,
			"installCommands": map[string]string{
				"linux":   "curl -fsSL '" + installUrl + "' | sudo bash",
				"docker":  dockerRunCmd,
				"compose": dockerComposeSnippet,
			},
		})
	}
}

// EnrollmentStatus handles GET /api/runners/enrollment-status?token=...
func EnrollmentStatus(database *sql.DB) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		userID := auth.UserIDFromContext(r.Context())
		if userID == 0 {
			runnerFail(w, http.StatusUnauthorized, "Authentication required")
			return
		}
		token := r.URL.Query().Get("token")
		if token == "" {
			runnerFail(w, http.StatusBadRequest, "token is required")
			return
		}

		runnerID, ok := getEnrollmentResult(token)
		if !ok {
			runnerOK(w, http.StatusOK, map[string]any{"status": "pending"})
			return
		}

		rn, err := db.GetRunnerByID(r.Context(), database, runnerID, userID)
		if err != nil || rn == nil {
			// Registered but not visible to this user (shouldn't happen).
			runnerOK(w, http.StatusOK, map[string]any{"status": "pending"})
			return
		}

		runnerOK(w, http.StatusOK, map[string]any{
			"status": "registered",
			"runner": runnerRowJSON(*rn),
		})
	}
}
