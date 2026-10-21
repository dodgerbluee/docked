package graph

import "testing"

// pageArgs must honor the default, respect a sane first, and clamp runaway
// first values so no connection can force an unbounded in-memory load.
func TestPageArgsCapsFirst(t *testing.T) {
	if limit, offset := pageArgs(nil, nil, 20); limit != 20 || offset != 0 {
		t.Errorf("default: got (%d,%d), want (20,0)", limit, offset)
	}
	first := 10
	if limit, _ := pageArgs(&first, nil, 20); limit != 10 {
		t.Errorf("first=10: got %d, want 10", limit)
	}
	big := 100000
	if limit, _ := pageArgs(&big, nil, 20); limit != maxPageLimit {
		t.Errorf("first=100000: got %d, want %d", limit, maxPageLimit)
	}
	neg := -5
	if limit, _ := pageArgs(&neg, nil, 20); limit != 20 {
		t.Errorf("first=-5: got %d, want default 20", limit)
	}
	after := "-3"
	if _, offset := pageArgs(nil, &after, 20); offset != 0 {
		t.Errorf("after=-3: got %d, want 0", offset)
	}
	after = "40"
	if _, offset := pageArgs(nil, &after, 20); offset != 40 {
		t.Errorf("after=40: got %d, want 40", offset)
	}
}
