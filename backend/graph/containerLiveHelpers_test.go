package graph

import (
	"database/sql"
	"testing"

	"github.com/dockedapp/backend/internal/db"
)

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
		{full, full[:12], true},      // standard 12-char short id
		{full[:12], full, true},      // reversed direction
		{full, "0", false},           // the prod footgun: DB PK "0" as docker id
		{full, "0575c211b5e", false}, // 11 chars: below short-id length
		{"0", full, false},           // degenerate live id
		{full, "1abc", false},
	}
	for _, c := range cases {
		if got := dockerIDMatches(c.live, c.requested); got != c.want {
			t.Errorf("dockerIDMatches(%q, %q) = %v, want %v", c.live, c.requested, got, c.want)
		}
	}
}

func flaggedRow(id int64, dockerID string) db.ContainerRow {
	r := baseRow(id, dockerID)
	r.LatestDigest = sql.NullString{String: "sha256:bbb", Valid: true}
	r.CurrentDigest = sql.NullString{String: "sha256:aaa", Valid: true}
	r.RepoDigests = sql.NullString{String: `["img@sha256:aaa"]`, Valid: true}
	return r
}

func baseRow(id int64, dockerID string) db.ContainerRow {
	return db.ContainerRow{
		ID:          id,
		RunnerID:    sql.NullInt64{Int64: 7, Valid: true},
		EndpointID:  sql.NullInt64{Int64: 2, Valid: true},
		ContainerID: dockerID,
	}
}

// Join duplicates (one container matching several registry rows) must collapse
// to one entry, and a flagged duplicate must win over an unflagged one so the
// update badge and the list agree.
func TestDedupeContainerRowsPrefersFlagged(t *testing.T) {
	rows := []db.ContainerRow{
		baseRow(1, "aaa"),
		flaggedRow(1, "aaa"), // same container, flagged join row
		baseRow(2, "bbb"),    // distinct container
	}
	out := dedupeContainerRows(rows)
	if len(out) != 2 {
		t.Fatalf("len = %d, want 2", len(out))
	}
	if !db.ContainerHasUpdate(out[0]) {
		t.Errorf("flagged duplicate must win over unflagged")
	}
}

// Live-merged runner rows are synthetic (ID 0): identity dedup must key on
// (runner, endpoint, docker-id), not the row ID, or every live container
// collapses into one entry.
func TestDedupeContainerRowsKeepsSyntheticRows(t *testing.T) {
	rows := []db.ContainerRow{
		baseRow(0, "aaa"),
		baseRow(0, "bbb"),
		baseRow(0, "ccc"),
	}
	if out := dedupeContainerRows(rows); len(out) != 3 {
		t.Fatalf("len = %d, want 3 (ID-0 rows must not collapse)", len(out))
	}
}
