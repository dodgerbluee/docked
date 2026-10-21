package graph

import (
	"database/sql"
	"testing"

	"github.com/dockedapp/backend/graph/model"
	"github.com/dockedapp/backend/internal/db"
)

func TestContainerRowToModelStateMapping(t *testing.T) {
	cases := map[string]model.ContainerState{
		"running":    model.ContainerStateRunning,
		"exited":     model.ContainerStateExited,
		"restarting": model.ContainerStateRestarting,
		"created":    model.ContainerStateCreated,
		"paused":     model.ContainerStatePaused,
		"dead":       model.ContainerStateDead,
		"weird":      model.ContainerStateUnknown,
	}
	for state, want := range cases {
		row := db.ContainerRow{ID: 1, ContainerID: "abc", ContainerName: "c",
			State: sql.NullString{String: state, Valid: true}}
		if got := containerRowToModel(&row).State; got != want {
			t.Errorf("state %q mapped to %q, want %q", state, got, want)
		}
	}
}

// Synthetic live runner rows have no DB primary key; every one of them used
// to surface ID "0", colliding across containers.
func TestContainerRowToModelStableLiveIDs(t *testing.T) {
	live := db.ContainerRow{ID: 0, ContainerID: "deadbeefcafe", ContainerName: "live"}
	if got := containerRowToModel(&live).ID; got != "live-deadbeefcafe" {
		t.Errorf("live row ID = %q, want live-deadbeefcafe", got)
	}
	stored := db.ContainerRow{ID: 42, ContainerID: "abc", ContainerName: "db"}
	if got := containerRowToModel(&stored).ID; got != "42" {
		t.Errorf("stored row ID = %q, want 42", got)
	}
}

// Node stores GitLab project paths in the github_repo column; gitlab-sourced
// apps must surface that value as gitlabRepo, other sources must not.
func TestTrackedAppToModelGitlabRepo(t *testing.T) {
	gitlab := db.TrackedAppRow{ID: 1, Name: "app", SourceType: "gitlab",
		GithubRepo: sql.NullString{String: "group/proj", Valid: true}}
	m := trackedAppToModel(&gitlab)
	if m.GitlabRepo == nil || *m.GitlabRepo != "group/proj" {
		t.Errorf("gitlab app GitlabRepo = %v, want group/proj", m.GitlabRepo)
	}
	if m.GithubRepo == nil || *m.GithubRepo != "group/proj" {
		t.Errorf("gitlab app GithubRepo = %v, want the shared column value", m.GithubRepo)
	}

	github := db.TrackedAppRow{ID: 2, Name: "app2", SourceType: "github",
		GithubRepo: sql.NullString{String: "owner/repo", Valid: true}}
	if got := trackedAppToModel(&github).GitlabRepo; got != nil {
		t.Errorf("github app GitlabRepo = %q, want nil", *got)
	}
}

func TestContainerRowToModelUpdatedAt(t *testing.T) {
	updated := db.ContainerRow{ID: 1, ContainerID: "a", ContainerName: "c",
		CreatedAt: sql.NullString{String: "2026-01-01 00:00:00", Valid: true},
		UpdatedAt: sql.NullString{String: "2026-02-02 10:30:00", Valid: true}}
	m := containerRowToModel(&updated)
	if !m.UpdatedAt.Equal(parseTime("2026-02-02 10:30:00")) {
		t.Errorf("updatedAt = %v, want 2026-02-02 10:30:00", m.UpdatedAt)
	}

	stale := db.ContainerRow{ID: 2, ContainerID: "b", ContainerName: "c",
		CreatedAt: sql.NullString{String: "2026-01-01 00:00:00", Valid: true}}
	m2 := containerRowToModel(&stale)
	if !m2.UpdatedAt.Equal(parseTime("2026-01-01 00:00:00")) {
		t.Errorf("null updated_at should fall back to created_at, got %v", m2.UpdatedAt)
	}
}

func TestStackGroupKeySeparatesSources(t *testing.T) {
	runnerA := db.ContainerRow{StackName: sql.NullString{String: "web", Valid: true},
		RunnerID: sql.NullInt64{Int64: 1, Valid: true}}
	runnerB := db.ContainerRow{StackName: sql.NullString{String: "web", Valid: true},
		RunnerID: sql.NullInt64{Int64: 2, Valid: true}}
	endpoint := db.ContainerRow{StackName: sql.NullString{String: "web", Valid: true},
		EndpointID: sql.NullInt64{Int64: 3, Valid: true}}
	plain := db.ContainerRow{StackName: sql.NullString{String: "web", Valid: true}}

	if stackGroupKey(&runnerA) == stackGroupKey(&runnerB) {
		t.Error("same stack name on different runners must not share a group")
	}
	if stackGroupKey(&runnerA) == stackGroupKey(&endpoint) {
		t.Error("runner- and endpoint-backed stacks must not share a group")
	}
	if stackGroupKey(&plain) != "web" {
		t.Errorf("sourceless key = %q, want web", stackGroupKey(&plain))
	}
}

// The provider enum layer used to collapse gitlab/gcr onto DOCKER_HUB,
// mislabeling the registry badge and any client-side registry logic.
func TestImageInfoRegistryEnumMapping(t *testing.T) {
	cases := map[string]model.Registry{
		"":          model.RegistryDockerHub,
		"dockerhub": model.RegistryDockerHub,
		"ghcr":      model.RegistryGhcr,
		"GHCR":      model.RegistryGhcr,
		"gitlab":    model.RegistryGitlab,
		"gcr":       model.RegistryGcr,
		"quay":      model.RegistryQuay,
		"lscr":      model.RegistryOther,
	}
	for provider, want := range cases {
		row := db.ContainerRow{ID: 1,
			ImageRepo: sql.NullString{String: "ns/repo", Valid: true},
			LatestTag: sql.NullString{String: "1.0", Valid: true},
			Provider:  sql.NullString{String: provider, Valid: provider != ""}}
		info := imageInfoFromRow(&row)
		if info == nil {
			t.Fatalf("provider %q: imageInfoFromRow returned nil", provider)
		}
		if info.Registry != want {
			t.Errorf("provider %q mapped to %q, want %q", provider, info.Registry, want)
		}
	}
}

// Docker reports an explicit --stop-timeout 0 as the number 0 and an unset
// one as null; the explicit zero must survive recreate.
func TestAddPreservedConfigFieldsStopTimeout(t *testing.T) {
	out := map[string]any{}
	addPreservedConfigFields(out, map[string]any{"StopTimeout": float64(0)})
	if v, ok := out["StopTimeout"].(int); !ok || v != 0 {
		t.Errorf("explicit zero StopTimeout = %#v, want int 0", out["StopTimeout"])
	}
	out = map[string]any{}
	addPreservedConfigFields(out, map[string]any{"StopTimeout": nil})
	if _, ok := out["StopTimeout"]; ok {
		t.Error("null StopTimeout must be skipped")
	}
	out = map[string]any{}
	addPreservedConfigFields(out, map[string]any{"StopTimeout": float64(30)})
	if v := out["StopTimeout"]; v != 30 {
		t.Errorf("StopTimeout = %#v, want 30", v)
	}
}
