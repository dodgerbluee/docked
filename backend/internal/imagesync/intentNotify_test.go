package imagesync

import (
	"encoding/json"
	"strings"
	"testing"
)

func ptr(s string) *string { return &s }

func TestFormatIntentExecutionNotification(t *testing.T) {
	data := IntentExecutionNotify{
		IntentName: "Nightly patch", Status: "partial", TriggerType: "scheduled_window",
		DurationMs:        12400,
		ContainersMatched: 4, ContainersUpgraded: 2, ContainersFailed: 1, ContainersSkipped: 1,
		ContainerResults: []IntentNotifyContainer{
			{ContainerName: "alpha", Status: "upgraded", ImageName: "repo/alpha:1",
				OldImage: ptr("repo/alpha:1"), NewImage: ptr("repo/alpha:2")},
			// upgraded without a resolvable old→new pair falls back to the
			// "(imageName)" line; empty imageName becomes "unknown".
			{ContainerName: "beta", Status: "upgraded", ImageName: ""},
			{ContainerName: "gamma", Status: "failed", ImageName: "repo/gamma:1",
				ErrorMessage: ptr(strings.Repeat("e", 120))},
			{ContainerName: "delta", Status: "skipped", ImageName: "repo/delta:1"},
		},
	}
	payload := formatIntentExecutionNotification(data)

	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "🤖 Intent Execution Complete") {
		t.Fatalf("missing title in %s", raw)
	}

	embed := payload["embeds"].([]any)[0].(map[string]any)
	if embed["color"] != intentColorPartial {
		t.Errorf("color = %v, want partial %d", embed["color"], intentColorPartial)
	}
	fields := embed["fields"].([]map[string]any)
	byName := map[string]map[string]any{}
	for _, f := range fields {
		byName[f["name"].(string)] = f
	}
	if byName["Status"]["value"] != "Partial" {
		t.Errorf("Status field = %v", byName["Status"])
	}
	if byName["Duration"]["value"] != "12s" {
		t.Errorf("Duration field = %v (want 12s, Math.round semantics)", byName["Duration"])
	}
	if byName["Containers"]["value"] != "4 matched · 2 upgraded · 1 failed · 1 skipped" {
		t.Errorf("Containers field = %v", byName["Containers"])
	}

	up := byName["Upgraded (2)"]
	if up == nil {
		t.Fatal("missing Upgraded (2) field")
	}
	upVal := up["value"].(string)
	if !strings.Contains(upVal, "✅ **alpha**\u2003repo/alpha:1 → repo/alpha:2") {
		t.Errorf("upgraded line missing old → new: %q", upVal)
	}
	if !strings.Contains(upVal, "✅ **beta** (unknown)") {
		t.Errorf("upgraded fallback line missing: %q", upVal)
	}

	fail := byName["Failed (1)"]
	if fail == nil {
		t.Fatal("missing Failed (1) field")
	}
	if !strings.Contains(fail["value"].(string), "❌ **gamma**: "+strings.Repeat("e", 80)) {
		t.Errorf("failed line not truncated to 80 chars: %q", fail["value"])
	}
	if strings.Contains(fail["value"].(string), strings.Repeat("e", 81)) {
		t.Error("error snippet exceeded 80-char truncation")
	}
	if _, ok := byName["Skipped (1)"]; ok {
		t.Error("skipped containers must not produce a field")
	}
}

func TestTruncateFieldLines(t *testing.T) {
	lines := make([]string, 0, 20)
	for i := 0; i < 20; i++ {
		lines = append(lines, strings.Repeat("x", 100))
	}
	got := truncateFieldLines(lines)
	if !strings.Contains(got, "_...and ") {
		t.Fatalf("expected overflow marker, got %q", got)
	}
	if len(got) > 1024 {
		t.Errorf("truncated field exceeds Discord limit: %d chars", len(got))
	}
	kept := truncateFieldLines([]string{"short", "lines"})
	if kept != "short\nlines" {
		t.Errorf("short lists must pass through, got %q", kept)
	}
}
