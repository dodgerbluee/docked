package db

import (
	"context"
	"database/sql"
	"testing"
)

func TestIntentMatcherMirrorsNodeSemantics(t *testing.T) {
	eligible := ContainerRow{
		ContainerName:    "Web-Frontend",
		ImageName:        sql.NullString{String: "ghcr.io/acme/web:2", Valid: true},
		StackName:        sql.NullString{String: "production", Valid: true},
		Registry:         sql.NullString{String: "ghcr.io", Valid: true},
		RunnerID:         sql.NullInt64{Int64: 7, Valid: true},
		CurrentDigest:    sql.NullString{String: "old", Valid: true},
		LatestDigest:     sql.NullString{String: "new", Valid: true},
		RepoDigests:      sql.NullString{String: `["sha256:old"]`, Valid: true},
		SourceInstanceID: sql.NullInt64{},
	}

	if !containerHasUpdate(eligible) {
		t.Fatal("digest change should be update-eligible")
	}
	if !intentIncludes(eligible,
		[]string{"web-*"}, []string{"GHCR.IO/*"}, []string{"runner:7"},
		[]string{"prod?ction"}, []string{"ghcr.*"}) {
		t.Fatal("case-insensitive globs and typed runner source should match")
	}
	if intentIncludes(eligible, nil, nil, []string{"portainer:7"}, nil, nil) {
		t.Fatal("typed source identity must distinguish runner from portainer")
	}
	if !intentExcludes(eligible, []string{"*-frontend"}, nil, nil, nil) {
		t.Fatal("container exclusion glob should match")
	}
	if !intentExcludes(eligible, nil, nil, nil, []string{"GHCR.IO"}) {
		t.Fatal("registry exclusion should be case-insensitive")
	}

	noUpdate := eligible
	noUpdate.RepoDigests.String = `["SHA256:NEW"]`
	if containerHasUpdate(noUpdate) {
		t.Fatal("latest digest already present in multi-arch repoDigests must not be eligible")
	}

	unknown := eligible
	unknown.RepoDigests.Valid = false
	if containerHasUpdate(unknown) {
		t.Fatal("missing repoDigests must avoid Node-incompatible false positives")
	}
}

// An explicitly empty inclusion list ("[]" stored in the DB) must match
// nothing; an unset (NULL) list constrains nothing.
func TestIntentEmptyInclusionListMatchesNothing(t *testing.T) {
	c := ContainerRow{
		ContainerName: "web",
		ImageName:     sql.NullString{String: "img:1", Valid: true},
		RunnerID:      sql.NullInt64{Int64: 3, Valid: true},
	}
	for _, tc := range []struct {
		name                                            string
		containers, images, sources, stacks, registries []string
	}{
		{"containers", []string{}, nil, nil, nil, nil},
		{"images", nil, []string{}, nil, nil, nil},
		{"sources", nil, nil, []string{}, nil, nil},
		{"stacks", nil, nil, nil, []string{}, nil},
		{"registries", nil, nil, nil, nil, []string{}},
	} {
		if intentIncludes(c, tc.containers, tc.images, tc.sources, tc.stacks, tc.registries) {
			t.Errorf("empty %s inclusion list should match nothing", tc.name)
		}
	}
	if !intentIncludes(c, nil, nil, nil, nil, nil) {
		t.Error("unset inclusion lists should match everything")
	}

	// DB round-trip: [] stores "[]" and decodes back to a non-nil empty
	// slice; nil stores NULL and decodes to nil.
	encoded := marshalJSONArr([]string{})
	if encoded == nil || *encoded != "[]" {
		t.Fatalf("marshalJSONArr([]) = %v, want \"[]\"", encoded)
	}
	if got := UnmarshalStringArr(sql.NullString{String: *encoded, Valid: true}); got == nil || len(got) != 0 {
		t.Errorf("UnmarshalStringArr(\"[]\") = %#v, want non-nil empty slice", got)
	}
	if v := marshalJSONArr(nil); v != nil {
		t.Errorf("marshalJSONArr(nil) = %v, want NULL", *v)
	}
	if got := UnmarshalStringArr(sql.NullString{}); got != nil {
		t.Errorf("UnmarshalStringArr(NULL) = %#v, want nil", got)
	}
}

// The scheduled-evaluation claim must be atomic: only one caller wins a cron
// point, and re-claiming the same or an older point fails.
func TestClaimIntentEvaluationIsAtomic(t *testing.T) {
	database := newMigratedTestDB(t)
	ctx := context.Background()
	if _, err := database.ExecContext(ctx,
		`INSERT INTO intents (user_id, name, schedule_type, schedule_cron, enabled)
		 VALUES (1, 'nightly', 'scheduled', '0 3 * * *', 1)`); err != nil {
		t.Fatal(err)
	}
	var id int64
	if err := database.QueryRowContext(ctx, `SELECT id FROM intents WHERE user_id = 1`).Scan(&id); err != nil {
		t.Fatal(err)
	}

	won, err := ClaimIntentEvaluation(ctx, database, id, 1, "2026-10-21T03:00:00.000Z")
	if err != nil {
		t.Fatal(err)
	}
	if !won {
		t.Fatal("first claim of a NULL last_evaluated_at must win")
	}
	won, err = ClaimIntentEvaluation(ctx, database, id, 1, "2026-10-21T03:00:00.000Z")
	if err != nil {
		t.Fatal(err)
	}
	if won {
		t.Fatal("re-claiming the same trigger point must lose")
	}
	won, _ = ClaimIntentEvaluation(ctx, database, id, 1, "2026-10-20T03:00:00.000Z")
	if won {
		t.Fatal("claiming an older trigger point must lose")
	}
	won, _ = ClaimIntentEvaluation(ctx, database, id, 1, "2026-10-22T03:00:00.000Z")
	if !won {
		t.Fatal("claiming a newer trigger point must win")
	}
	// Ownership is enforced: another user cannot claim it.
	won, _ = ClaimIntentEvaluation(ctx, database, id, 2, "2026-10-23T03:00:00.000Z")
	if won {
		t.Fatal("cross-user claim must lose")
	}
}
