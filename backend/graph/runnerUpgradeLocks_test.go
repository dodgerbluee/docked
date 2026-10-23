package graph

import (
	"context"
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
	if ok, err := db.AcquireUpgradeLock(ctx, database, containerTargetKey("stk-2", &runnerID), "other-op"); err != nil || !ok {
		t.Fatalf("seed lock: ok=%v err=%v", ok, err)
	}

	r := &Resolver{DB: database}
	err := (&mutationResolver{r}).restartDependentContainers(ctx, *pipelineRunnerRow(f.srv.URL),
		"prov-new", "gluetun", "prov-1", "servarr", false, map[string]bool{}, map[string]bool{"stk-3": true})
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
	owner, held, err := db.GetActiveUpgradeLockOwner(ctx, database, containerTargetKey("stk-2", &runnerID))
	if err != nil || !held || owner != "other-op" {
		t.Errorf("the sweep disturbed another operation's lock: owner=%q held=%v err=%v", owner, held, err)
	}
	if _, held, _ := db.GetActiveUpgradeLockOwner(ctx, database, containerTargetKey("stk-1", &runnerID)); held {
		t.Error("the sweep leaked its restart lock")
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
	if ok, err := db.AcquireUpgradeLock(ctx, database, containerTargetKey("sib-2", &runnerID), "other-op"); err != nil || !ok {
		t.Fatalf("seed lock: ok=%v err=%v", ok, err)
	}

	original := map[string]any{"HostConfig": map[string]any{"NetworkMode": "container:gluetun"}}
	r := &Resolver{DB: database}
	(&mutationResolver{r}).restartSiblingContainers(ctx, *pipelineRunnerRow(f.srv.URL), original, "prov-new", map[string]bool{})

	if got := f.stopCount("sib-1"); got != 1 {
		t.Errorf("unlocked sibling: stops = %d, want 1", got)
	}
	if got := f.stopCount("sib-2"); got != 0 {
		t.Errorf("sibling locked by another operation: stops = %d, want 0", got)
	}
}
