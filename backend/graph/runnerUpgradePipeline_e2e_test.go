package graph

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/dockedapp/backend/internal/db"
)

// fakeRunner is an in-memory dockhand-wire-compatible server: it lets the
// upgrade pipeline run end-to-end (inspect → stop dependents → pull → remove
// → create → start) against scripted failures, so the failure-path recovery
// (dependent restore, provider rollback) is actually exercised.
type fakeRunner struct {
	mu        sync.Mutex
	byID      map[string]map[string]any // id -> inspect document
	seq       int
	pullFails bool
	// failCreate maps a create name to how many times it must fail before
	// succeeding (models a transient engine error mid-pipeline).
	failCreate map[string]int
	creates    []createRecord

	srv *httptest.Server
}

type createRecord struct {
	Name    string
	Payload map[string]any
}

func newFakeRunner(t *testing.T) *fakeRunner {
	t.Helper()
	f := &fakeRunner{byID: map[string]map[string]any{}, failCreate: map[string]int{}}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /containers", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		out := make([]map[string]any, 0, len(f.byID))
		for id, doc := range f.byID {
			state := jObj(doc, "State")
			out = append(out, map[string]any{
				"id":    id,
				"name":  strings.TrimPrefix(jStr(doc, "Name"), "/"),
				"image": jStr(jObj(doc, "Config"), "Image"),
				"state": jStr(state, "Status"),
			})
		}
		writeJSON(w, http.StatusOK, map[string]any{"containers": out})
	})
	mux.HandleFunc("GET /containers/{id}/json", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		doc, ok := f.byID[r.PathValue("id")]
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]any{"message": "no such container"})
			return
		}
		writeJSON(w, http.StatusOK, doc)
	})
	mux.HandleFunc("POST /containers/{id}/stop", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		doc, ok := f.byID[r.PathValue("id")]
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]any{"message": "no such container"})
			return
		}
		doc["State"] = map[string]any{"Status": "exited", "Running": false}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("POST /containers/{id}/start", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		doc, ok := f.byID[r.PathValue("id")]
		if !ok {
			writeJSON(w, http.StatusNotFound, map[string]any{"message": "no such container"})
			return
		}
		doc["State"] = map[string]any{"Status": "running", "Running": true}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("DELETE /containers/{id}", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if _, ok := f.byID[r.PathValue("id")]; !ok {
			writeJSON(w, http.StatusNotFound, map[string]any{"message": "no such container"})
			return
		}
		delete(f.byID, r.PathValue("id"))
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("POST /containers/create", func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]any{"message": err.Error()})
			return
		}
		name := r.URL.Query().Get("name")
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.failCreate[name] > 0 {
			f.failCreate[name]--
			writeJSON(w, http.StatusInternalServerError, map[string]any{"message": "engine create failure"})
			return
		}
		f.seq++
		id := fmt.Sprintf("fakedoc%03d", f.seq)
		f.byID[id] = map[string]any{
			"Id":    id,
			"Name":  name,
			"State": map[string]any{"Status": "created", "Running": false},
			"Config": map[string]any{
				"Image":  payload["Image"],
				"Env":    payload["Env"],
				"Labels": payload["Labels"],
			},
			"HostConfig":      payload["HostConfig"],
			"NetworkSettings": map[string]any{"Networks": map[string]any{}},
		}
		f.creates = append(f.creates, createRecord{Name: name, Payload: payload})
		writeJSON(w, http.StatusCreated, map[string]any{"Id": id})
	})
	mux.HandleFunc("POST /images/pull", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		fails := f.pullFails
		f.mu.Unlock()
		if fails {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"message": "pull failure"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{})
	})
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	return f
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func (f *fakeRunner) seed(id string, doc map[string]any) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.byID[id] = doc
}

// findByName returns the inspect document for a container name (leading slash
// ignored), or nil when absent.
func (f *fakeRunner) findByName(name string) map[string]any {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, doc := range f.byID {
		if strings.TrimPrefix(jStr(doc, "Name"), "/") == name {
			return doc
		}
	}
	return nil
}

func (f *fakeRunner) createRecords() []createRecord {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]createRecord(nil), f.creates...)
}

func newPipelineTestDB(t *testing.T) *sql.DB {
	t.Helper()
	database, err := db.Open(t.TempDir() + "/pipeline.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { database.Close() })
	if err := db.Migrate(context.Background(), database); err != nil {
		t.Fatal(err)
	}
	return database
}

func runningState() map[string]any {
	return map[string]any{"Status": "running", "Running": true}
}

func providerInspectDoc() map[string]any {
	return map[string]any{
		"Id":    "prov-1",
		"Name":  "/gluetun",
		"State": runningState(),
		"Config": map[string]any{
			"Image":  "qmcgaw/gluetun:v1",
			"Labels": map[string]any{},
		},
		"HostConfig": map[string]any{
			"NetworkMode": "bridge",
			"Binds":       []any{"/host/cfg:/gluetun:rw"},
		},
		"Mounts": []any{
			map[string]any{"Type": "bind", "Source": "/host/cfg", "Destination": "/gluetun", "Mode": "rw"},
			// Image-declared anonymous volume: absent from HostConfig.Binds,
			// must be re-attached on recreate or the data is orphaned.
			map[string]any{"Type": "volume", "Source": "anon777", "Destination": "/gluetun/anon", "Mode": "rw"},
		},
		"NetworkSettings": map[string]any{"Networks": map[string]any{}},
	}
}

func dependentInspectDoc() map[string]any {
	return map[string]any{
		"Id":    "dep-1",
		"Name":  "/arr",
		"State": runningState(),
		"Config": map[string]any{
			"Image":  "linuxserver/radarr:latest",
			"Labels": map[string]any{},
		},
		"HostConfig": map[string]any{
			"NetworkMode": "container:gluetun",
		},
		"NetworkSettings": map[string]any{"Networks": map[string]any{}},
	}
}

func pipelineRunnerRow(url string) *db.RunnerRow {
	return &db.RunnerRow{ID: 1, UserID: 1, Name: "r1", URL: url, APIKey: "k", Enabled: true}
}

func pipelineContainerRow() *db.ContainerRow {
	return &db.ContainerRow{
		ID: 1, ContainerID: "prov-1", ContainerName: "gluetun",
		ImageName: sql.NullString{String: "qmcgaw/gluetun:v1", Valid: true},
	}
}

// A mid-pipeline failure after the up-front dependent removal used to orphan
// the dependents permanently: nothing else recreates them. The pipeline must
// restore them from the pre-stop snapshots.
func TestUpgradePipelineRestoresDependentsOnPullFailure(t *testing.T) {
	database := newPipelineTestDB(t)
	f := newFakeRunner(t)
	f.pullFails = true
	f.seed("prov-1", providerInspectDoc())
	f.seed("dep-1", dependentInspectDoc())

	r := &Resolver{DB: database}
	err := (&mutationResolver{r}).runnerUpgradePipeline(
		context.Background(), 1, pipelineContainerRow(), pipelineRunnerRow(f.srv.URL), "qmcgaw/gluetun:v1", nil)
	if err == nil || !strings.Contains(err.Error(), "pull image") {
		t.Fatalf("pipeline error = %v, want pull image failure", err)
	}
	if f.findByName("gluetun") == nil {
		t.Error("provider must still exist after a pull failure")
	}
	if f.findByName("arr") == nil {
		t.Error("dependent must be restored after a failed upgrade")
	}
}

// When the pipeline fails AFTER removing the provider, the rollback must put
// the provider back (original image) and re-point the dependents at it.
func TestUpgradePipelineRollsBackProviderAndDependentsOnCreateFailure(t *testing.T) {
	database := newPipelineTestDB(t)
	f := newFakeRunner(t)
	f.seed("prov-1", providerInspectDoc())
	f.seed("dep-1", dependentInspectDoc())
	// The pipeline's recreate (name keeps the leading slash) fails once;
	// the rollback's provider recreate then succeeds.
	f.failCreate["/gluetun"] = 1

	r := &Resolver{DB: database}
	err := (&mutationResolver{r}).runnerUpgradePipeline(
		context.Background(), 1, pipelineContainerRow(), pipelineRunnerRow(f.srv.URL), "qmcgaw/gluetun:v1", nil)
	if err == nil || !strings.Contains(err.Error(), "create container") {
		t.Fatalf("pipeline error = %v, want create container failure", err)
	}

	provider := f.findByName("gluetun")
	if provider == nil {
		t.Fatal("provider must be rolled back into existence")
	}
	if img := jStr(jObj(provider, "Config"), "Image"); img != "qmcgaw/gluetun:v1" {
		t.Errorf("rolled-back provider image = %q, want the original qmcgaw/gluetun:v1", img)
	}
	dep := f.findByName("arr")
	if dep == nil {
		t.Fatal("dependent must be restored after the rollback")
	}
	wantNM := "container:" + jStr(provider, "Id")
	if nm := jStr(jObj(dep, "HostConfig"), "NetworkMode"); nm != wantNM {
		t.Errorf("restored dependent NetworkMode = %q, want %q", nm, wantNM)
	}
}

// The happy path must re-attach image-declared anonymous volumes as explicit
// binds; otherwise the recreate silently gets a fresh empty volume.
func TestUpgradePipelinePreservesAnonymousVolumes(t *testing.T) {
	database := newPipelineTestDB(t)
	f := newFakeRunner(t)
	f.seed("prov-1", providerInspectDoc())

	r := &Resolver{DB: database}
	if err := (&mutationResolver{r}).runnerUpgradePipeline(
		context.Background(), 1, pipelineContainerRow(), pipelineRunnerRow(f.srv.URL), "qmcgaw/gluetun:v1", nil); err != nil {
		t.Fatalf("happy-path pipeline errored: %v", err)
	}

	var hc map[string]any
	for _, rec := range f.createRecords() {
		if strings.TrimPrefix(rec.Name, "/") == "gluetun" {
			hc = jObj(rec.Payload, "HostConfig")
		}
	}
	if hc == nil {
		t.Fatal("no create payload captured for gluetun")
	}
	binds, _ := hc["Binds"].([]any)
	var found bool
	for _, b := range binds {
		if s, ok := b.(string); ok && strings.HasPrefix(s, "anon777:/gluetun/anon") {
			found = true
		}
	}
	if !found {
		t.Errorf("anonymous volume not re-attached; Binds = %v", binds)
	}
	// The explicit bind mount must not be duplicated.
	var dupes int
	for _, b := range binds {
		if s, ok := b.(string); ok && strings.HasPrefix(s, "/host/cfg:") {
			dupes++
		}
	}
	if dupes != 1 {
		t.Errorf("bind mount duplicated %d times in %v", dupes, binds)
	}
}
