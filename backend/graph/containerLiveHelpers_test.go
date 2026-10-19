package graph

import "testing"

// TestDockerIDMatches guards the short-id leniency: a trivial prefix like "0"
// (e.g. a DB primary key mistakenly sent as a docker id) must never resolve to
// an arbitrary container whose id happens to start with it.
func TestDockerIDMatches(t *testing.T) {
	full := "0575c211b5e70b70bb5de061c62013293b3ec8cd8debb734b115acee49fa7691"
	cases := []struct {
		live, requested string
		want            bool
	}{
		{full, full, true},
		{full, full[:12], true},   // standard 12-char short id
		{full[:12], full, true},   // reversed direction
		{full, "0", false},        // the prod footgun: DB PK "0" as docker id
		{full, "0575c211b5e", false}, // 11 chars: below short-id length
		{"0", full, false},        // degenerate live id
		{full, "1abc", false},
	}
	for _, c := range cases {
		if got := dockerIDMatches(c.live, c.requested); got != c.want {
			t.Errorf("dockerIDMatches(%q, %q) = %v, want %v", c.live, c.requested, got, c.want)
		}
	}
}
