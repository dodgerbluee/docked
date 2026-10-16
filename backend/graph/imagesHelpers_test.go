package graph

import (
	"encoding/json"
	"testing"

	"github.com/dockedapp/backend/internal/db"
)

func TestNormalizeImageID(t *testing.T) {
	cases := []struct{ in, want string }{
		{"sha256:aaaabbbbccccdddd1111", "aaaabbbbcccc"},
		{"aaaabbbbccccdddd1111", "aaaabbbbcccc"},
		{"sha256:abc", "abc"},
		{"", ""},
	}
	for _, c := range cases {
		if got := normalizeImageID(c.in); got != c.want {
			t.Errorf("normalizeImageID(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestHasValidRepoTags(t *testing.T) {
	cases := []struct {
		in   []string
		want bool
	}{
		{nil, false},
		{[]string{}, false},
		{[]string{"<none>:<none>"}, false},
		{[]string{"<none>:<none>", "extra"}, true},
		{[]string{"repo:tag"}, true},
	}
	for _, c := range cases {
		if got := hasValidRepoTags(c.in); got != c.want {
			t.Errorf("hasValidRepoTags(%v) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestExtractRepoTagsFromDigests(t *testing.T) {
	got := extractRepoTagsFromDigests([]string{
		"registry.example.com/orphan@sha256:deadbeef",
		"weird-entry",
	})
	want := []string{"registry.example.com/orphan:<none>", "<none>:<none>"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("extractRepoTagsFromDigests[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestCreatedToString(t *testing.T) {
	cases := []struct {
		raw  string
		want string
	}{
		{``, ``},
		{`1704067200`, "2024-01-01T00:00:00Z"},
		{`"2024-02-02T00:00:00Z"`, "2024-02-02T00:00:00Z"},
		{`null`, ""},
	}
	for _, c := range cases {
		got := createdToString(json.RawMessage(c.raw))
		if got != c.want {
			t.Errorf("createdToString(%s) = %q, want %q", c.raw, got, c.want)
		}
	}
}

func TestInstanceDisplayName(t *testing.T) {
	if got := instanceDisplayName(db.SourceInstanceRow{Name: "primary", URL: "http://x:9443"}); got != "primary" {
		t.Errorf("named instance: got %q, want %q", got, "primary")
	}
	if got := instanceDisplayName(db.SourceInstanceRow{URL: "https://portainer.lan:9443"}); got != "portainer.lan" {
		t.Errorf("unnamed instance: got %q, want %q", got, "portainer.lan")
	}
	if got := instanceDisplayName(db.SourceInstanceRow{URL: "::not a url::"}); got != "::not a url::" {
		t.Errorf("unparseable url: got %q, want passthrough", got)
	}
}
