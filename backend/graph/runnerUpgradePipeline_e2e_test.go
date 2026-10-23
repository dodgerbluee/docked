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
	"time"

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
	// pullDelay stalls the pull handler so a pipeline context deadline can
	// fire mid-pull (models a slow registry + stuck upgrade).
	pullDelay time.Duration
	// failStartNew fails the next N start calls for containers the fake
	// CREATED (not seeded ones): models a replacement that starts broken.
	failStartNew int
	// failStarts fails every start call, including for seeded containers:
	// models a peer the recovery sweep stops and then cannot bring back up.
	failStarts bool
	createdIDs map[string]bool
	// failCreate maps a create name to how many times it must fail before
	// succeeding (models a transient engine error mid-pipeline).
	failCreate map[string]int
	// inspectFailAfter allows the first N inspects of a container ID to
	// succeed, then fails every later one (models an inspect that flakes
	// between dependent discovery and snapshot).
	inspectFailAfter map[string]int
	inspectCount     map[string]int
	// stops counts stop calls per container ID so a test can prove a locked
	// container was never touched by the recovery sweep.
	stops   map[string]int
	creates []createRecord

	srv *httptest.Server
}

type createRecord struct {
	Name    string
	Payload map[string]any
}

func newFakeRunner(t *testing.T) *fakeRunner {
	t.Helper()
	f := &fakeRunner{byID: map[string]map[string]any{}, failCreate: map[string]int{}, createdIDs: map[string]bool{},
		inspectFailAfter: map[string]int{}, inspectCount: map[string]int{}, stops: map[string]int{}}
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
		id := r.PathValue("id")
		f.inspectCount[id]++
		if limit, ok := f.inspectFailAfter[id]; ok && f.inspectCount[id] > limit {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"message": "inspect flaked"})
			return
		}
		doc, ok := f.byID[id]
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
		f.stops[r.PathValue("id")]++
		doc["State"] = map[string]any{"Status": "exited", "Running": false}
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("POST /containers/{id}/start", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		id := r.PathValue("id")
		if f.failStarts {
			f.mu.Unlock()
			writeJSON(w, http.StatusInternalServerError, map[string]any{"message": "start failure"})
			return
		}
		if f.failStartNew > 0 && f.createdIDs[id] {
			f.failStartNew--
			f.mu.Unlock()
			writeJSON(w, http.StatusInternalServerError, map[string]any{"message": "start failure"})
			return
		}
		doc, ok := f.byID[id]
		if !ok {
			f.mu.Unlock()
			writeJSON(w, http.StatusNotFound, map[string]any{"message": "no such container"})
			return
		}
		doc["State"] = map[string]any{"Status": "running", "Running": true}
		f.mu.Unlock()
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
		f.createdIDs[id] = true
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
		delay := f.pullDelay
		f.mu.Unlock()
		if delay > 0 {
			time.Sleep(delay)
		}
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

func (f *fakeRunner) stopCount(id string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.stops[id]
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
		// Top-level Image is the image ID the container actually runs from;
		// a rollback must pin this, not the tag (which a mid-pipeline pull
		// may already have moved to a new digest).
		"Image": "sha256:0b1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4f5",
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
			// must be re-attached by NAME on recreate (Source is a host path
			// that only exists on the engine host).
			map[string]any{"Type": "volume", "Name": "anon777", "Source": "/var/lib/docker/volumes/anon777/_data", "Destination": "/gluetun/anon", "Mode": "rw"},
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
	if p := f.findByName("gluetun"); jStr(jObj(p, "State"), "Status") != "running" {
		t.Error("provider was stopped by the pipeline; rollback must bring it back up before dependents can attach")
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
	// The rollback pins the INSPECTED image ID: the tag may already point at
	// the freshly pulled (broken) digest, so recreating from Config.Image
	// would roll forward instead of back.
	if img := jStr(jObj(provider, "Config"), "Image"); !strings.HasPrefix(img, "sha256:0b1d2e3f") {
		t.Errorf("rolled-back provider image = %q, want the inspected image ID sha256:0b1d2e3f...", img)
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
		if s, ok := b.(string); ok && strings.Contains(s, "/var/lib/docker") {
			t.Errorf("anonymous volume re-attached by host path, not volume name: %q", s)
		}
	}
	if !found {
		t.Errorf("anonymous volume not re-attached by name; Binds = %v", binds)
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

// The pipeline removes network_mode dependents before stopping the provider;
// the post-upgrade sweep only sees containers that still exist, so the
// SUCCESS path must recreate the removed dependents from their snapshots —
// otherwise a successful upgrade leaves them permanently gone.
func TestUpgradePipelineRecreatesDependentsOnSuccess(t *testing.T) {
	database := newPipelineTestDB(t)
	f := newFakeRunner(t)
	f.seed("prov-1", providerInspectDoc())
	f.seed("dep-1", dependentInspectDoc())

	r := &Resolver{DB: database}
	if err := (&mutationResolver{r}).runnerUpgradePipeline(
		context.Background(), 1, pipelineContainerRow(), pipelineRunnerRow(f.srv.URL), "qmcgaw/gluetun:v1", nil); err != nil {
		t.Fatalf("happy-path pipeline errored: %v", err)
	}

	provider := f.findByName("gluetun")
	if provider == nil {
		t.Fatal("upgraded provider missing")
	}
	if jStr(jObj(provider, "State"), "Status") != "running" {
		t.Error("upgraded provider must be running")
	}
	dep := f.findByName("arr")
	if dep == nil {
		t.Fatal("dependent must be recreated after a successful upgrade")
	}
	if jStr(jObj(dep, "State"), "Status") != "running" {
		t.Error("recreated dependent must be started")
	}
	wantNM := "container:" + jStr(provider, "Id")
	if nm := jStr(jObj(dep, "HostConfig"), "NetworkMode"); nm != wantNM {
		t.Errorf("recreated dependent NetworkMode = %q, want %q", nm, wantNM)
	}
	// The post-upgrade sweep must not remove+recreate the dependent a second
	// time (one create for arr total).
	var arrCreates int
	for _, rec := range f.createRecords() {
		if strings.TrimPrefix(rec.Name, "/") == "arr" {
			arrCreates++
		}
	}
	if arrCreates != 1 {
		t.Errorf("dependent created %d times, want exactly 1", arrCreates)
	}
}

// The dependent was already REMOVED, so a transient create error must be
// retried, not swallowed: the old code reported a clean success with the
// dependent permanently gone.
func TestUpgradePipelineDependentRecreateRetriesTransientFailure(t *testing.T) {
	database := newPipelineTestDB(t)
	f := newFakeRunner(t)
	f.seed("prov-1", providerInspectDoc())
	f.seed("dep-1", dependentInspectDoc())
	f.failCreate["arr"] = 1 // first recreate attempt fails, retry must recover (dependent creates use the bare name)

	r := &Resolver{DB: database}
	if err := (&mutationResolver{r}).runnerUpgradePipeline(
		context.Background(), 1, pipelineContainerRow(), pipelineRunnerRow(f.srv.URL), "qmcgaw/gluetun:v1", nil); err != nil {
		t.Fatalf("transient dependent create failure must be retried, got: %v", err)
	}
	if f.findByName("arr") == nil {
		t.Fatal("dependent must be recreated after the retry succeeds")
	}
}

// If recreation is exhausted (3 attempts), the operation must NOT report a
// clean success: we removed the dependent, so its loss has to surface. The
// upgraded provider stays up (rolling it back would be worse).
func TestUpgradePipelineReportsFailureWhenDependentRecreateExhausts(t *testing.T) {
	database := newPipelineTestDB(t)
	f := newFakeRunner(t)
	f.seed("prov-1", providerInspectDoc())
	f.seed("dep-1", dependentInspectDoc())
	f.failCreate["arr"] = 99 // every attempt fails

	r := &Resolver{DB: database}
	err := (&mutationResolver{r}).runnerUpgradePipeline(
		context.Background(), 1, pipelineContainerRow(), pipelineRunnerRow(f.srv.URL), "qmcgaw/gluetun:v1", nil)
	if err == nil {
		t.Fatal("lost dependent must fail the operation, not report success")
	}
	if !strings.Contains(err.Error(), "arr") || !strings.Contains(err.Error(), "dependent") {
		t.Errorf("error = %v, want it to name the lost dependent", err)
	}
	provider := f.findByName("gluetun")
	if provider == nil || jStr(jObj(provider, "State"), "Status") != "running" {
		t.Error("the successfully upgraded provider must stay up")
	}
	if f.findByName("arr") != nil {
		t.Error("dependent must be gone after exhausted recreation attempts")
	}
}

// Without dependents the old restore() was a no-op: a pull failure left the
// service stopped forever and a create failure left it deleted. The pipeline
// must put the service back unconditionally, not just when dependents exist.
func TestUpgradePipelineRestartsOriginalOnPullFailureNoDependents(t *testing.T) {
	database := newPipelineTestDB(t)
	f := newFakeRunner(t)
	f.pullFails = true
	f.seed("prov-1", providerInspectDoc())

	r := &Resolver{DB: database}
	err := (&mutationResolver{r}).runnerUpgradePipeline(
		context.Background(), 1, pipelineContainerRow(), pipelineRunnerRow(f.srv.URL), "qmcgaw/gluetun:v1", nil)
	if err == nil || !strings.Contains(err.Error(), "pull image") {
		t.Fatalf("pipeline error = %v, want pull image failure", err)
	}
	p := f.findByName("gluetun")
	if p == nil {
		t.Fatal("provider must still exist after a pull failure")
	}
	if jStr(jObj(p, "State"), "Status") != "running" {
		t.Error("pull failure rollback must restart the stopped original, got state " + jStr(jObj(p, "State"), "Status"))
	}
}

func TestUpgradePipelineRecreatesOriginalOnCreateFailureNoDependents(t *testing.T) {
	database := newPipelineTestDB(t)
	f := newFakeRunner(t)
	f.seed("prov-1", providerInspectDoc())
	f.failCreate["/gluetun"] = 1 // the upgrade create fails once

	r := &Resolver{DB: database}
	err := (&mutationResolver{r}).runnerUpgradePipeline(
		context.Background(), 1, pipelineContainerRow(), pipelineRunnerRow(f.srv.URL), "qmcgaw/gluetun:v1", nil)
	if err == nil || !strings.Contains(err.Error(), "create container") {
		t.Fatalf("pipeline error = %v, want create container failure", err)
	}
	p := f.findByName("gluetun")
	if p == nil {
		t.Fatal("create failure after remove must recreate the original container")
	}
	if jStr(jObj(p, "State"), "Status") != "running" {
		t.Error("recreated original must be started, got state " + jStr(jObj(p, "State"), "Status"))
	}
	// The rollback create must pin the INSPECTED image ID, not the tag.
	recs := f.createRecords()
	if len(recs) == 0 {
		t.Fatal("expected a rollback create")
	}
	last := recs[len(recs)-1]
	if got := last.Payload["Image"]; got != providerInspectDoc()["Image"] {
		t.Errorf("rollback create image = %v, want inspected sha256 pin", got)
	}
}

// With dependents present, rollback delegated to restoreRemovedDependents,
// which happily adopted the HALF-CREATED replacement that occupies the
// original name (start failed) and re-pointed the dependents at it. The
// replacement must be vacated so the pinned original is restored.
func TestUpgradePipelineRollbackReplacesBrokenReplacementWithOriginal(t *testing.T) {
	database := newPipelineTestDB(t)
	f := newFakeRunner(t)
	f.seed("prov-1", providerInspectDoc())
	f.seed("dep-1", dependentInspectDoc())
	f.failStartNew = 1 // the created replacement starts broken

	r := &Resolver{DB: database}
	err := (&mutationResolver{r}).runnerUpgradePipeline(
		context.Background(), 1, pipelineContainerRow(), pipelineRunnerRow(f.srv.URL), "qmcgaw/gluetun:v1", nil)
	if err == nil || !strings.Contains(err.Error(), "start container") {
		t.Fatalf("pipeline error = %v, want start container failure", err)
	}

	provider := f.findByName("gluetun")
	if provider == nil {
		t.Fatal("original provider must be restored")
	}
	if img := jStr(jObj(provider, "Config"), "Image"); !strings.HasPrefix(img, "sha256:") {
		t.Errorf("restored provider image = %v, want the pinned sha256 original", img)
	}
	if jStr(jObj(provider, "State"), "Status") != "running" {
		t.Error("restored provider must be running")
	}
	dep := f.findByName("arr")
	if dep == nil {
		t.Fatal("dependent must be recreated on rollback")
	}
	if nm := jStr(jObj(dep, "HostConfig"), "NetworkMode"); nm != "container:"+jStr(provider, "Id") {
		t.Errorf("dependent NetworkMode = %s, want the RESTORED provider id %s", nm, jStr(provider, "Id"))
	}
}

// The pipeline ctx can already be canceled/deadlined when restore() runs
// (client disconnect, stuck readiness wait). Rollback must run detached or
// the service stays stopped forever.
func TestUpgradePipelineRollbackSurvivesExpiredContext(t *testing.T) {
	database := newPipelineTestDB(t)
	f := newFakeRunner(t)
	f.pullDelay = 2 * time.Second // registry stall blows the pipeline deadline
	f.seed("prov-1", providerInspectDoc())

	ctx, cancel := context.WithTimeout(context.Background(), 400*time.Millisecond)
	defer cancel()
	r := &Resolver{DB: database}
	err := (&mutationResolver{r}).runnerUpgradePipeline(
		ctx, 1, pipelineContainerRow(), pipelineRunnerRow(f.srv.URL), "qmcgaw/gluetun:v1", nil)
	if err == nil {
		t.Fatal("pipeline should have failed on the stalled pull")
	}
	p := f.findByName("gluetun")
	if p == nil {
		t.Fatal("provider must still exist")
	}
	if jStr(jObj(p, "State"), "Status") != "running" {
		t.Error("rollback under an expired ctx must still restart the original, got " + jStr(jObj(p, "State"), "Status"))
	}
}

// A dependent's inspect can flake BETWEEN post-upgrade discovery and the
// snapshot loop in handleNetworkModeContainers. Removing it there strands it
// forever: recreation skips containers with no snapshot. A transient inspect
// failure must leave the dependent untouched.
func TestUpgradePipelineNetworkModeDepSurvivesInspectFlake(t *testing.T) {
	database := newPipelineTestDB(t)
	f := newFakeRunner(t)
	f.seed("prov-1", providerInspectDoc())
	// Stopped dependent: not captured (and so not removed) pre-upgrade; it
	// reaches handleNetworkModeContainers via the post-upgrade sweep.
	depDoc := dependentInspectDoc()
	depDoc["State"] = map[string]any{"Status": "exited", "Running": false}
	f.seed("dep-1", depDoc)
	// Inspect succeeds during pre-upgrade scan and post-upgrade discovery,
	// then flakes exactly when the snapshot loop runs.
	f.inspectFailAfter["dep-1"] = 2

	err := (&mutationResolver{&Resolver{DB: database}}).runnerUpgradePipeline(
		context.Background(), 1, pipelineContainerRow(), pipelineRunnerRow(f.srv.URL), "qmcgaw/gluetun:v1", nil)
	if err != nil {
		t.Fatalf("pipeline should succeed (dependent handling is best-effort): %v", err)
	}
	if f.findByName("arr") == nil {
		t.Fatal("dependent with a failed inspect snapshot must NOT be removed (it could never be recreated)")
	}
}

// restoreRemovedDependents must honor the caller's deadline instead of
// stripping it with WithoutCancel: rollback already hands it a detached
// context with its own budget, and an expired one must stop the work, not
// silently run unbounded against the runner.
func TestRestoreRemovedDependentsHonorsCallerDeadline(t *testing.T) {
	f := newFakeRunner(t)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
	defer cancel()
	time.Sleep(30 * time.Millisecond) // let it expire

	restoreRemovedDependents(ctx, *pipelineRunnerRow(f.srv.URL),
		[]depContainer{{ID: "dep-1", Name: "/arr", Details: dependentInspectDoc()}},
		"gluetun", providerInspectDoc())

	if recs := f.createRecords(); len(recs) != 0 {
		t.Errorf("expired caller ctx must stop rollback work, got %d creates", len(recs))
	}
}

// The container row is snapshotted before the caller acquires the upgrade lock,
// and locks are keyed by host+name because an upgrade removes and recreates the
// container under the same name. A recreate by anyone else in that window left
// the pipeline addressing a Docker id that no longer exists, so it reported a
// failure for a container that was running fine. It must re-resolve the name to
// whatever container currently answers to it.
func TestUpgradePipelineReResolvesReplacedContainerUnderLock(t *testing.T) {
	database := newPipelineTestDB(t)
	f := newFakeRunner(t)
	replacement := providerInspectDoc()
	replacement["Id"] = "prov-2"
	f.seed("prov-2", replacement)

	r := &Resolver{DB: database}
	stale := pipelineContainerRow() // still carries ContainerID "prov-1"
	if err := (&mutationResolver{r}).runnerUpgradePipeline(
		context.Background(), 1, stale, pipelineRunnerRow(f.srv.URL), "qmcgaw/gluetun:v1", nil); err != nil {
		t.Fatalf("pipeline errored on a container that exists: %v", err)
	}
	if got := f.stopCount("prov-2"); got != 1 {
		t.Errorf("live container stopped %d times, want 1", got)
	}
	provider := f.findByName("gluetun")
	if provider == nil {
		t.Fatal("upgraded provider missing")
	}
	if jStr(jObj(provider, "State"), "Status") != "running" {
		t.Error("upgraded provider must be running")
	}
}

// The other half: when the runner answers and no container carries that name,
// the target really is gone, and that must be the reported reason rather than a
// raw inspect 404 against an id nobody recognises.
func TestUpgradePipelineRejectsContainerThatIsGone(t *testing.T) {
	database := newPipelineTestDB(t)
	f := newFakeRunner(t)
	f.seed("dep-1", dependentInspectDoc()) // a different container, same runner

	r := &Resolver{DB: database}
	err := (&mutationResolver{r}).runnerUpgradePipeline(
		context.Background(), 1, pipelineContainerRow(), pipelineRunnerRow(f.srv.URL), "qmcgaw/gluetun:v1", nil)
	if err == nil || !strings.Contains(err.Error(), "no longer exists") {
		t.Fatalf("pipeline error = %v, want the container to be reported as gone", err)
	}
	if f.stopCount("dep-1") != 0 {
		t.Error("a missing target must not touch the other container")
	}
}
