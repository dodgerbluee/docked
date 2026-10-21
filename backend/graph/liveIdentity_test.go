package graph

import (
	"context"
	"testing"

	"github.com/dockedapp/backend/graph/model"
	"github.com/dockedapp/backend/internal/db"
)

func connItems(c *model.ContainerConnection) []string {
	out := make([]string, 0, len(c.Items))
	for _, it := range c.Items {
		out = append(out, it.ID)
	}
	return out
}

func containers(n int) []*model.Container {
	out := make([]*model.Container, n)
	for i := range out {
		out[i] = &model.Container{ID: string(rune('a' + i))}
	}
	return out
}

// Grouped connections (StackGroup.containers, ContainerGroup.standalone)
// must return the FULL parent list when the client passes no paging args —
// the client never paginates these, so slicing them to a default page would
// silently hide containers.
func TestPaginateContainersFullReturnsEverythingWithoutArgs(t *testing.T) {
	all := containers(600)
	got := paginateContainersFull(all, nil, nil)
	if len(got.Items) != 600 {
		t.Fatalf("no-arg page = %d items, want all 600", len(got.Items))
	}
	if got.TotalCount != 600 || got.PageInfo.HasNextPage {
		t.Errorf("totalCount=%d hasNext=%v, want 600/false", got.TotalCount, got.PageInfo.HasNextPage)
	}
}

func TestPaginateContainersFullPagesAndClamps(t *testing.T) {
	all := containers(10)
	first, after := 4, "4"
	got := paginateContainersFull(all, &first, &after)
	want := []string{"e", "f", "g", "h"}
	if got.Items[0].ID != "e" || connItems(got)[3] != "h" {
		t.Errorf("page = %v, want %v", connItems(got), want)
	}
	if !got.PageInfo.HasNextPage || !got.PageInfo.HasPreviousPage {
		t.Errorf("pageInfo = %+v, want both neighbors", got.PageInfo)
	}

	huge := 10_000
	clamped := paginateContainersFull(all, &huge, nil)
	if len(clamped.Items) != 10 {
		t.Errorf("clamped page = %d items, want 10 (list is shorter than the cap)", len(clamped.Items))
	}
	wide := paginateContainersFull(containers(maxPageLimit+50), &huge, nil)
	if len(wide.Items) != maxPageLimit {
		t.Errorf("first=10000 over %d items = %d, want clamp to %d", maxPageLimit+50, len(wide.Items), maxPageLimit)
	}
}

func TestStackGroupContainersFieldResolver(t *testing.T) {
	obj := &model.StackGroup{Containers: &model.ContainerConnection{Items: containers(7)}}
	r := &stackGroupResolver{}
	full, err := r.Containers(context.Background(), obj, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(full.Items) != 7 || full.TotalCount != 7 {
		t.Fatalf("no-arg resolve = %d/%d, want 7/7", len(full.Items), full.TotalCount)
	}
	first := 3
	page, err := r.Containers(context.Background(), obj, &first, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 3 || !page.PageInfo.HasNextPage {
		t.Errorf("first=3 resolve = %d items hasNext=%v", len(page.Items), page.PageInfo.HasNextPage)
	}
}

func TestContainerGroupStandaloneFieldResolver(t *testing.T) {
	obj := &model.ContainerGroup{Standalone: &model.ContainerConnection{Items: containers(4)}}
	r := &containerGroupResolver{}
	full, err := r.Standalone(context.Background(), obj, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(full.Items) != 4 {
		t.Fatalf("no-arg resolve = %d, want 4", len(full.Items))
	}
	empty := &model.ContainerGroup{}
	got, err := r.Standalone(context.Background(), empty, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got == nil || len(got.Items) != 0 {
		t.Errorf("nil standalone = %+v, want empty connection", got)
	}
}

// "live-<dockerID>" ids are not tied to a DB row: resolution must search
// every enabled runner and the per-runner list must be live-merged and
// deterministically ordered so cursors stay stable.
func TestLiveContainerResolvesAcrossRunners(t *testing.T) {
	database := newPipelineTestDB(t)
	ctx := context.Background()
	uid, err := db.CreateUser(ctx, database, "live-id", "hash", "Administrator", 1)
	if err != nil {
		t.Fatal(err)
	}

	empty := newFakeRunner(t)
	host := newFakeRunner(t)
	doc := providerInspectDoc()
	doc["Id"] = "live-target"
	host.seed("live-target", doc)

	r1, err := db.CreateRunner(ctx, database, uid, "empty", empty.srv.URL, "k")
	if err != nil {
		t.Fatal(err)
	}
	r2, err := db.CreateRunner(ctx, database, uid, "host", host.srv.URL, "k")
	if err != nil {
		t.Fatal(err)
	}

	r := &Resolver{DB: database}
	row := r.liveRunnerContainerByDockerID(ctx, uid, "live-target")
	if row == nil {
		t.Fatalf("live- lookup found nothing across runners %d/%d", r1, r2)
	}
	if row.ContainerName != "gluetun" {
		t.Errorf("resolved name = %q, want gluetun", row.ContainerName)
	}
	if row := r.liveRunnerContainerByDockerID(ctx, uid, "absent-id"); row != nil {
		t.Errorf("unknown docker id resolved to %+v, want nil", row)
	}

	rows, err := r.runnerContainersForRunner(ctx, uid, r2)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].ContainerID != "live-target" {
		t.Fatalf("runnerContainersForRunner = %+v, want the one live container", rows)
	}
	if rows, err := r.runnerContainersForRunner(ctx, uid, r1); err != nil || len(rows) != 0 {
		t.Errorf("empty runner = %+v err=%v, want no rows", rows, err)
	}
}
