package graph

import (
	"testing"

	"github.com/dockedapp/backend/graph/model"
)

// TestEnumConstIdempotent asserts that enumConst never corrupts an already
// normalized UPPER_SNAKE enum member. Every generated member must round-trip
// to itself, so a value that already came from the enum layer stays valid.
func TestEnumConstIdempotent(t *testing.T) {
	check := func(name string, members []string) {
		for _, m := range members {
			if got := enumConst(m); got != m {
				t.Errorf("%s: enumConst(%q) = %q, want unchanged", name, m, got)
			}
		}
	}
	check("AuthType", strAll(len(model.AllAuthType), func(i int) string { return string(model.AllAuthType[i]) }))
	check("BatchJobType", strAll(len(model.AllBatchJobType), func(i int) string { return string(model.AllBatchJobType[i]) }))
	check("BatchRunStatus", strAll(len(model.AllBatchRunStatus), func(i int) string { return string(model.AllBatchRunStatus[i]) }))
	check("ContainerState", strAll(len(model.AllContainerState), func(i int) string { return string(model.AllContainerState[i]) }))
	check("ExecutionContainerStatus", strAll(len(model.AllExecutionContainerStatus), func(i int) string { return string(model.AllExecutionContainerStatus[i]) }))
	check("IntentExecutionStatus", strAll(len(model.AllIntentExecutionStatus), func(i int) string { return string(model.AllIntentExecutionStatus[i]) }))
	check("IntentScheduleType", strAll(len(model.AllIntentScheduleType), func(i int) string { return string(model.AllIntentScheduleType[i]) }))
	check("IntentTriggerType", strAll(len(model.AllIntentTriggerType), func(i int) string { return string(model.AllIntentTriggerType[i]) }))
	check("OperationStatus", strAll(len(model.AllOperationStatus), func(i int) string { return string(model.AllOperationStatus[i]) }))
	check("OperationType", strAll(len(model.AllOperationType), func(i int) string { return string(model.AllOperationType[i]) }))
	check("Registry", strAll(len(model.AllRegistry), func(i int) string { return string(model.AllRegistry[i]) }))
	check("Role", strAll(len(model.AllRole), func(i int) string { return string(model.AllRole[i]) }))
	check("RunnerStatus", strAll(len(model.AllRunnerStatus), func(i int) string { return string(model.AllRunnerStatus[i]) }))
	check("SourceType", strAll(len(model.AllSourceType), func(i int) string { return string(model.AllSourceType[i]) }))
	check("TrackedAppSourceType", strAll(len(model.AllTrackedAppSourceType), func(i int) string { return string(model.AllTrackedAppSourceType[i]) }))
	check("UpgradePhase", strAll(len(model.AllUpgradePhase), func(i int) string { return string(model.AllUpgradePhase[i]) }))
	check("UpgradeStatus", strAll(len(model.AllUpgradeStatus), func(i int) string { return string(model.AllUpgradeStatus[i]) }))
}

// TestEnumConstCoversDBDomain asserts that the raw values the shared SQLite DB
// actually stores (Node's domain: title-case roles, hyphenated job types, etc.)
// normalize to a VALID member of the corresponding GraphQL enum. This is the
// contract that, when broken, produces non-null enum violations at query time.
func TestEnumConstCoversDBDomain(t *testing.T) {
	cases := []struct {
		enum   string
		values []string
		valid  func(s string) bool
	}{
		{"Role", []string{"Administrator", "Member"}, func(s string) bool { return model.Role(s).IsValid() }},
		{"BatchJobType", []string{"docker-hub-pull", "tracked-apps-check", "app-version-scan", "upgrade-containers"}, func(s string) bool { return model.BatchJobType(s).IsValid() }},
		{"BatchRunStatus", []string{"pending", "running", "completed", "failed", "cancelled"}, func(s string) bool { return model.BatchRunStatus(s).IsValid() }},
		{"ContainerState", []string{"running", "exited", "restarting", "created", "paused", "dead", "unknown"}, func(s string) bool { return model.ContainerState(s).IsValid() }},
		{"ExecutionContainerStatus", []string{"pending", "running", "upgraded", "failed", "skipped", "dry_run"}, func(s string) bool { return model.ExecutionContainerStatus(s).IsValid() }},
		{"IntentExecutionStatus", []string{"pending", "running", "completed", "partial", "failed"}, func(s string) bool { return model.IntentExecutionStatus(s).IsValid() }},
		{"IntentScheduleType", []string{"immediate", "scheduled"}, func(s string) bool { return model.IntentScheduleType(s).IsValid() }},
		{"IntentTriggerType", []string{"manual", "scan-detected", "scheduled-window"}, func(s string) bool { return model.IntentTriggerType(s).IsValid() }},
		{"OperationStatus", []string{"pending", "running", "completed", "failed", "cancelled"}, func(s string) bool { return model.OperationStatus(s).IsValid() }},
		{"OperationType", []string{"pull-containers", "upgrade-container", "batch-upgrade", "intent-execution", "batch-job"}, func(s string) bool { return model.OperationType(s).IsValid() }},
		{"Registry", []string{"docker-hub", "ghcr", "gitlab", "gcr", "quay", "other"}, func(s string) bool { return model.Registry(s).IsValid() }},
		{"RunnerStatus", []string{"online", "offline", "degraded"}, func(s string) bool { return model.RunnerStatus(s).IsValid() }},
		{"SourceType", []string{"portainer", "runner"}, func(s string) bool { return model.SourceType(s).IsValid() }},
		{"TrackedAppSourceType", []string{"docker", "github", "gitlab"}, func(s string) bool { return model.TrackedAppSourceType(s).IsValid() }},
		{"UpgradePhase", []string{"pulling", "stopping", "recreating", "starting", "restarting-dependents", "completed", "failed"}, func(s string) bool { return model.UpgradePhase(s).IsValid() }},
		{"UpgradeStatus", []string{"success", "failed", "skipped"}, func(s string) bool { return model.UpgradeStatus(s).IsValid() }},
		{"AuthType", []string{"password", "apikey"}, func(s string) bool { return model.AuthType(s).IsValid() }},
	}
	for _, c := range cases {
		for _, v := range c.values {
			got := enumConst(v)
			if !c.valid(got) {
				t.Errorf("%s: enumConst(%q) = %q is not a valid enum member", c.enum, v, got)
			}
		}
	}
}

func strAll(n int, at func(int) string) []string {
	out := make([]string, n)
	for i := 0; i < n; i++ {
		out[i] = at(i)
	}
	return out
}

// TestDBEnumValueMatchesNodeDomain guards the WRITE side of the enum contract.
// The resolvers persist enum inputs via dbEnumValue; if that mapping drifts
// from the lowercase/hyphenated values Node's consumers compare against, the
// value is written but never matched (e.g. intentEvaluator filters on
// schedule_type === "scheduled", so a stored "SCHEDULED" is silently skipped).
// Each case pins the exact DB literal Node reads, and the round-trip
// enumConst(dbEnumValue(member)) == member proves the two helpers stay inverse.
func TestDBEnumValueMatchesNodeDomain(t *testing.T) {
	cases := []struct {
		member string
		want   string // exact value Node writes/reads in SQLite
	}{
		// AuthType -> source_instances.auth_type
		{"PASSWORD", "password"}, {"APIKEY", "apikey"},
		// TrackedAppSourceType -> tracked_apps.source_type
		{"DOCKER", "docker"}, {"GITHUB", "github"}, {"GITLAB", "gitlab"},
		// IntentScheduleType -> intents.schedule_type
		{"IMMEDIATE", "immediate"}, {"SCHEDULED", "scheduled"},
		// BatchJobType -> batch_config.job_type
		{"DOCKER_HUB_PULL", "docker-hub-pull"},
		{"TRACKED_APPS_CHECK", "tracked-apps-check"},
		{"APP_VERSION_SCAN", "app-version-scan"},
		{"UPGRADE_CONTAINERS", "upgrade-containers"},
	}
	for _, c := range cases {
		got := dbEnumValue(c.member)
		if got != c.want {
			t.Errorf("dbEnumValue(%q) = %q, want %q", c.member, got, c.want)
		}
		// The value we write must normalize back to the same enum member, so a
		// Go read of a Node-written row (and vice versa) stays consistent.
		if back := enumConst(got); back != c.member {
			t.Errorf("round-trip: enumConst(dbEnumValue(%q)) = %q, want %q", c.member, back, c.member)
		}
	}
}
