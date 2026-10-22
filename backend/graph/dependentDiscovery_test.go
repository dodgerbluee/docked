package graph

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dockedapp/backend/internal/db"
)

// A dependent whose network_mode references the provider by FULL container ID
// (container:<64-hex>) must be discovered during pre-upgrade discovery.
// Name-only matching skipped it, so a failed upgrade left the dependent wired
// to the deleted old provider ID with no rollback.
func TestFindDependentContainersMatchesByID(t *testing.T) {
	providerID := strings.Repeat("a", 64)
	depID := strings.Repeat("b", 64)

	mux := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/containers":
			_ = json.NewEncoder(w).Encode(map[string]any{"containers": []map[string]any{
				{"id": providerID, "name": "/gluetun", "image": "qmcgaw/gluetun", "state": "running"},
				{"id": depID, "name": "/vpn-app", "image": "containrrr/watchtower", "state": "running"},
			}})
		case "/containers/" + depID + "/json":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"Id":   depID,
				"Name": "/vpn-app",
				"State": map[string]any{
					"Status": "running",
				},
				"HostConfig": map[string]any{
					"NetworkMode": "container:" + providerID,
				},
			})
		default:
			http.NotFound(w, r)
		}
	})
	srv := httptest.NewServer(mux)
	defer srv.Close()

	rr := db.RunnerRow{URL: srv.URL, APIKey: "k"}
	deps := findDependentContainers(context.Background(), rr, providerID, "gluetun")
	if len(deps) != 1 || deps[0].ID != depID {
		t.Fatalf("ID-referencing dependent not discovered, got %+v", deps)
	}
}
