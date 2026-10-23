package graph

import (
	"context"
	"errors"
	"testing"

	"github.com/dockedapp/backend/internal/db"
)

func stackDependentInspectDoc(id, name, stack string) map[string]any {
	return map[string]any{
		"Id":    id,
		"Name":  "/" + name,
		"State": runningState(),
		"Config": map[string]any{
			"Image":  "linuxserver/radarr:latest",
			"Labels": map[string]any{"com.docker.compose.project": stack},
		},
		"HostConfig":      map[string]any{"NetworkMode": "bridge"},
		"NetworkSettings": map[string]any{"Networks": map[string]any{}},
	}
}

// The post-upgrade recovery sweep stops and starts stack peers. When one of
// them is the target of a concurrent upgrade, stopping it loses that
// operation's rollback, so the sweep must leave locked containers alone.
func TestRestartDependentSweepSkipsContainersLockedByOthers(t *testing.T) {
	database := newPipelineTestDB(t)
	f := newFakeRunner(t)

	f.seed("prov-new", map[string]any{
		"Id": "prov-new", "Name": "/gluetun", "State": runningState(),
		"Config":          map[string]any{"Image": "qmcgaw/gluetun:v2", "Labels": map[string]any{}},
		"HostConfig":      map[string]any{"NetworkMode": "bridge"},
		"NetworkSettings": map[string]any{"Networks": map[string]any{}},
	})
	f.seed("stk-1", stackDependentInspectDoc("stk-1", "radarr", "servarr"))
	f.seed("stk-2", stackDependentInspectDoc("stk-2", "sonarr", "servarr"))
	f.seed("stk-3", stackDependentInspectDoc("stk-3", "prowlarr", "servarr"))

	ctx := context.Background()
	runnerID := int64(1)
	// stk-2 belongs to a concurrent operation. stk-3 is locked by THIS
	// pipeline under its own owner token, so it is ours to restart and must
	// not look busy just because the sweep claims under a different owner.
	if ok, err := db.AcquireUpgradeLock(ctx, database, upgradeLockKey(&runnerID, "sonarr"), "other-op"); err != nil || !ok {
		t.Fatalf("seed lock: ok=%v err=%v", ok, err)
	}

	r := &Resolver{DB: database}
	err := (&mutationResolver{r}).restartDependentContainers(ctx, *pipelineRunnerRow(f.srv.URL),
		"prov-new", "gluetun", "prov-1", "servarr", false, map[string]bool{}, map[string]bool{"prowlarr": true})
	if err != nil {
		t.Fatalf("sweep failed: %v", err)
	}

	if got := f.stopCount("stk-1"); got != 1 {
		t.Errorf("unlocked peer: stops = %d, want 1", got)
	}
	if got := f.stopCount("stk-3"); got != 1 {
		t.Errorf("peer this pipeline already locked: stops = %d, want 1", got)
	}
	if got := f.stopCount("stk-2"); got != 0 {
		t.Errorf("peer locked by another operation: stops = %d, want 0", got)
	}
	owner, held, err := db.GetActiveUpgradeLockOwner(ctx, database, upgradeLockKey(&runnerID, "sonarr"))
	if err != nil || !held || owner != "other-op" {
		t.Errorf("the sweep disturbed another operation's lock: owner=%q held=%v err=%v", owner, held, err)
	}
	if _, held, _ := db.GetActiveUpgradeLockOwner(ctx, database, upgradeLockKey(&runnerID, "radarr")); held {
		t.Error("the sweep leaked its restart lock")
	}
}

// The upgrade recreates the container under the same name with a brand new
// Docker id. A lock keyed on the id stops guarding the container at that
// moment - and its release frees an id that no longer exists - so a second
// request for the same container is handed a fresh key and walks past the
// guard. Locks are name-scoped so one guard covers the whole operation.
func TestUpgradeLockGuardsContainerAcrossRecreate(t *testing.T) {
	database := newPipelineTestDB(t)
	ctx := context.Background()
	runnerID := int64(16)

	if ok, err := db.AcquireUpgradeLock(ctx, database, upgradeLockKey(&runnerID, "gluetun"), "upgrade-1"); err != nil || !ok {
		t.Fatalf("first upgrade could not lock: ok=%v err=%v", ok, err)
	}

	// Mid-flight the pipeline has removed the old container and created a new
	// one. A second request resolves the same container and must be refused.
	if ok, err := db.AcquireUpgradeLock(ctx, database, upgradeLockKey(&runnerID, "gluetun"), "upgrade-2"); err != nil || ok {
		t.Errorf("second upgrade got past the guard: ok=%v err=%v", ok, err)
	}

	// The id-scoped key the previous code used was free the instant the old
	// container was removed, which is the hazard being closed.
	if ok, err := db.AcquireUpgradeLock(ctx, database, containerTargetKey("new-docker-id", &runnerID), "upgrade-2"); err != nil || !ok {
		t.Errorf("expected the id-scoped key to be free, ok=%v err=%v", ok, err)
	}
}

// A release that frees the wrong key strands every lock in the set until its
// lease expires, blocking the containers for the full TTL.
func TestAcquireUpgradeLockSetReleasesWhatItAcquired(t *testing.T) {
	database := newPipelineTestDB(t)
	ctx := context.Background()
	rr := db.RunnerRow{ID: 16}

	r := &Resolver{DB: database}
	held, release, err := (&mutationResolver{r}).acquireUpgradeLockSet(ctx, rr, "sweep-owner", []string{"radarr", "sonarr"}, false)
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}
	if len(held) != 2 {
		t.Fatalf("held = %v, want both names", held)
	}
	n, err := db.CountActiveUpgradeLocks(ctx, database)
	if err != nil || n != 2 {
		t.Fatalf("locks after acquire = %d (err %v), want 2", n, err)
	}

	release()

	n, err = db.CountActiveUpgradeLocks(ctx, database)
	if err != nil || n != 0 {
		t.Errorf("locks after release = %d (err %v), want 0", n, err)
	}
}

// Same rule for the shared-network-mode sibling sweep.
func TestRestartSiblingSweepSkipsLockedContainers(t *testing.T) {
	database := newPipelineTestDB(t)
	f := newFakeRunner(t)

	provider := func(id, name string) map[string]any {
		return map[string]any{
			"Id": id, "Name": "/" + name, "State": runningState(),
			"Config":          map[string]any{"Image": "qmcgaw/gluetun:v2", "Labels": map[string]any{}},
			"HostConfig":      map[string]any{"NetworkMode": "container:gluetun"},
			"NetworkSettings": map[string]any{"Networks": map[string]any{}},
		}
	}
	f.seed("prov-new", map[string]any{
		"Id": "prov-new", "Name": "/gluetun", "State": runningState(),
		"Config":          map[string]any{"Image": "qmcgaw/gluetun:v2", "Labels": map[string]any{}},
		"HostConfig":      map[string]any{"NetworkMode": "bridge"},
		"NetworkSettings": map[string]any{"Networks": map[string]any{}},
	})
	f.seed("sib-1", provider("sib-1", "radarr"))
	f.seed("sib-2", provider("sib-2", "sonarr"))

	ctx := context.Background()
	runnerID := int64(1)
	if ok, err := db.AcquireUpgradeLock(ctx, database, upgradeLockKey(&runnerID, "sonarr"), "other-op"); err != nil || !ok {
		t.Fatalf("seed lock: ok=%v err=%v", ok, err)
	}

	original := map[string]any{"HostConfig": map[string]any{"NetworkMode": "container:gluetun"}}
	r := &Resolver{DB: database}
	if err := (&mutationResolver{r}).restartSiblingContainers(ctx, *pipelineRunnerRow(f.srv.URL), original, "prov-new", map[string]bool{}); err != nil {
		t.Fatalf("sibling sweep: %v", err)
	}

	if got := f.stopCount("sib-1"); got != 1 {
		t.Errorf("unlocked sibling: stops = %d, want 1", got)
	}
	if got := f.stopCount("sib-2"); got != 0 {
		t.Errorf("sibling locked by another operation: stops = %d, want 0", got)
	}
}

// A sibling the sweep stops but cannot start leaves a service that was running
// before the upgrade now down, so the sweep must report it instead of letting
// the upgrade claim a clean success.
func TestRestartSiblingSweepReportsContainersLeftDown(t *testing.T) {
	database := newPipelineTestDB(t)
	f := newFakeRunner(t)
	f.failStarts = true

	provider := func(id, name string) map[string]any {
		return map[string]any{
			"Id": id, "Name": "/" + name, "State": runningState(),
			"Config":          map[string]any{"Image": "qmcgaw/gluetun:v2", "Labels": map[string]any{}},
			"HostConfig":      map[string]any{"NetworkMode": "container:gluetun"},
			"NetworkSettings": map[string]any{"Networks": map[string]any{}},
		}
	}
	f.seed("prov-new", map[string]any{
		"Id": "prov-new", "Name": "/gluetun", "State": runningState(),
		"Config":          map[string]any{"Image": "qmcgaw/gluetun:v2", "Labels": map[string]any{}},
		"HostConfig":      map[string]any{"NetworkMode": "bridge"},
		"NetworkSettings": map[string]any{"Networks": map[string]any{}},
	})
	f.seed("sib-1", provider("sib-1", "radarr"))

	ctx := context.Background()
	r := &Resolver{DB: database}
	original := map[string]any{"HostConfig": map[string]any{"NetworkMode": "container:gluetun"}}
	err := (&mutationResolver{r}).restartSiblingContainers(ctx, *pipelineRunnerRow(f.srv.URL), original, "prov-new", map[string]bool{})
	if err == nil {
		t.Fatal("a sibling stopped and not restarted must be reported")
	}
	if !errors.Is(err, errDependentDown) {
		t.Errorf("err = %v, want it to wrap errDependentDown", err)
	}
}
