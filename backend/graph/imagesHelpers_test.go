package graph

import (
	"testing"
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
