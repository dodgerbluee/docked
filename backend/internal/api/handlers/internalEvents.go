package handlers

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/dockedapp/backend/graph/model"
	"github.com/dockedapp/backend/internal/events"
	"github.com/dockedapp/backend/internal/respond"
)

// incomingEvent is the wire shape posted by the Node process to the
// /internal/events bridge. Payload is the GraphQL-shaped JSON for the
// matching event model.
type incomingEvent struct {
	Type    string          `json:"type"`
	UserID  int64           `json:"userId"`
	Payload json.RawMessage `json:"payload"`
}

// InternalEvents handles POST /internal/events: the cross-process bridge
// that lets the Node server publish GraphQL subscription events through
// the Go hub. Guarded by a shared-secret header (both processes share
// JWT_SECRET).
func InternalEvents(hub *events.Hub, secret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if secret == "" || r.Header.Get("X-Internal-Token") != secret {
			respond.Error(w, http.StatusUnauthorized, "unauthorized")
			return
		}

		var ev incomingEvent
		if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&ev); err != nil {
			respond.Error(w, http.StatusBadRequest, "invalid event payload")
			return
		}

		switch ev.Type {
		case "containersUpdated":
			var p model.ContainersUpdatedEvent
			if err := json.Unmarshal(ev.Payload, &p); err != nil {
				respond.Error(w, http.StatusBadRequest, "invalid containersUpdated payload")
				return
			}
			hub.PublishContainersUpdated(ev.UserID, p)
		case "upgradeProgress":
			var p model.UpgradeProgressEvent
			if err := json.Unmarshal(ev.Payload, &p); err != nil {
				respond.Error(w, http.StatusBadRequest, "invalid upgradeProgress payload")
				return
			}
			hub.PublishUpgradeProgress(ev.UserID, p)
		case "batchJobProgress":
			var p model.BatchRun
			if err := json.Unmarshal(ev.Payload, &p); err != nil {
				respond.Error(w, http.StatusBadRequest, "invalid batchJobProgress payload")
				return
			}
			hub.PublishBatchJob(ev.UserID, p)
		case "intentExecutionProgress":
			var p model.IntentExecution
			if err := json.Unmarshal(ev.Payload, &p); err != nil {
				respond.Error(w, http.StatusBadRequest, "invalid intentExecutionProgress payload")
				return
			}
			hub.PublishIntentExecution(ev.UserID, p)
		case "runnerStatusChanged":
			var p model.RunnerStatusEvent
			if err := json.Unmarshal(ev.Payload, &p); err != nil {
				respond.Error(w, http.StatusBadRequest, "invalid runnerStatusChanged payload")
				return
			}
			hub.PublishRunnerStatus(ev.UserID, p)
		case "operationProgress":
			var p model.Operation
			if err := json.Unmarshal(ev.Payload, &p); err != nil {
				respond.Error(w, http.StatusBadRequest, "invalid operationProgress payload")
				return
			}
			hub.PublishOperation(ev.UserID, p)
		default:
			respond.Error(w, http.StatusBadRequest, "unknown event type")
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}
