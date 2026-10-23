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

	// Missing repoDigests must not suppress a real update. Node compares
	// repoDigests when it has them and the current digest otherwise; the Go
	// port that bailed out on missing repoDigests silently hid updates for
	// every container whose image was pulled without a registry digest.
	unknown := eligible
	unknown.RepoDigests.Valid = false
	if !containerHasUpdate(unknown) {
		t.Error("missing repoDigests must fall back to the current-digest comparison")
	}
	upToDate := unknown
	upToDate.CurrentDigest.String = "new"
	if containerHasUpdate(upToDate) {
		t.Error("current digest already equal to latest must not be eligible")
	}
	// A repo-qualified digest entry (the raw form dockhand reports) must
	// normalize the same way as the bare form.
	raw := eligible
	raw.RepoDigests.String = `["ghcr.io/acme/web@sha256:new"]`
	if containerHasUpdate(raw) {
		t.Error("repo-qualified repoDigests must normalize to the bare digest")
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

	// DB round-trip under the write contract: an explicit empty list is
	// normalized to NULL (the intent form sends [] for dimensions the user
	// did not pick — storing "[]" there would match nothing). A legacy "[]"
	// row still decodes to a non-nil empty slice and still matches nothing.
	if encoded := marshalJSONArr([]string{}); encoded != nil {
		t.Fatalf("marshalJSONArr([]) = %q, want NULL", *encoded)
	}
	if got := UnmarshalStringArr(sql.NullString{String: "[]", Valid: true}); got == nil || len(got) != 0 {
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

// The claim comparison must be format-normalized: rows written in SQLite's
// CURRENT_TIMESTAMP layout ("YYYY-MM-DD HH:MM:SS") sort BEFORE the ISO
// "YYYY-MM-DDTHH:MM:SS.sssZ" layout under a raw string compare (space < T),
// which would let an older cron point re-claim a newer evaluation.
func TestClaimIntentEvaluationNormalizesTimestampFormats(t *testing.T) {
	database := newMigratedTestDB(t)
	ctx := context.Background()
	if _, err := database.ExecContext(ctx,
		`INSERT INTO intents (user_id, name, schedule_type, schedule_cron, enabled, last_evaluated_at)
		 VALUES (1, 'nightly', 'scheduled', '0 3 * * *', 1, '2026-10-21 04:00:00')`); err != nil {
		t.Fatal(err)
	}
	var id int64
	if err := database.QueryRowContext(ctx, `SELECT id FROM intents WHERE user_id = 1`).Scan(&id); err != nil {
		t.Fatal(err)
	}

	// 03:00 is OLDER than the stored 04:00 evaluation and must lose, even
	// though the raw strings compare "2026-10-21 04:00:00" < "2026-10-21T03:00:00.000Z".
	if won, _ := ClaimIntentEvaluation(ctx, database, id, 1, "2026-10-21T03:00:00.000Z"); won {
		t.Fatal("older cron point must lose against a CURRENT_TIMESTAMP-format last_evaluated_at")
	}
	if won, _ := ClaimIntentEvaluation(ctx, database, id, 1, "2026-10-21T05:00:00.000Z"); !won {
		t.Fatal("newer cron point must win")
	}
	// A corrupt value must not wedge the intent forever: it is claimable.
	if _, err := database.ExecContext(ctx, `UPDATE intents SET last_evaluated_at = 'garbage' WHERE id = ?`, id); err != nil {
		t.Fatal(err)
	}
	if won, _ := ClaimIntentEvaluation(ctx, database, id, 1, "2026-10-21T06:00:00.000Z"); !won {
		t.Fatal("unparseable last_evaluated_at must be claimable")
	}
}

// CreateIntent normalizes explicit empty filter lists to NULL: the intent
// form sends [] for every dimension the user did not pick, and a stored "[]"
// would make the whole intent match nothing.
func TestCreateIntentEmptyListsStoredNull(t *testing.T) {
	database := newMigratedTestDB(t)
	ctx := context.Background()
	id, err := CreateIntent(ctx, database, 1, "ui-created", nil, true,
		[]string{"web"}, []string{}, []string{}, []string{}, []string{},
		[]string{}, []string{}, []string{}, []string{},
		"scheduled", strPtr("0 3 * * *"), 1, false, 0)
	if err != nil {
		t.Fatal(err)
	}
	var mc, mi, ms, mst, mr, ec, ei, est, er sql.NullString
	if err := database.QueryRowContext(ctx,
		`SELECT match_containers, match_images, match_sources, match_stacks, match_registries,
		        exclude_containers, exclude_images, exclude_stacks, exclude_registries
		 FROM intents WHERE id = ?`, id).
		Scan(&mc, &mi, &ms, &mst, &mr, &ec, &ei, &est, &er); err != nil {
		t.Fatal(err)
	}
	if !mc.Valid || mc.String != `["web"]` {
		t.Errorf("match_containers = %v, want [\"web\"]", mc)
	}
	for name, v := range map[string]sql.NullString{
		"match_images": mi, "match_sources": ms, "match_stacks": mst, "match_registries": mr,
		"exclude_containers": ec, "exclude_images": ei, "exclude_stacks": est, "exclude_registries": er,
	} {
		if v.Valid {
			t.Errorf("%s = %q, want NULL", name, v.String)
		}
	}
}

// Completion is monotonic: whichever terminal write lands first wins and
// later writes (a late executor update vs a peer's cleanup) are no-ops.
func TestIntentExecutionCompletionIsMonotonic(t *testing.T) {
	database := newMigratedTestDB(t)
	ctx := context.Background()
	if _, err := database.ExecContext(ctx,
		`INSERT INTO intents (user_id, name, schedule_type, enabled) VALUES (1, 'i', 'scheduled', 1)`); err != nil {
		t.Fatal(err)
	}
	var intentID int64
	if err := database.QueryRowContext(ctx, `SELECT id FROM intents WHERE user_id = 1`).Scan(&intentID); err != nil {
		t.Fatal(err)
	}

	execID, err := CreateIntentExecution(ctx, database, intentID, 1, "manual")
	if err != nil {
		t.Fatal(err)
	}
	if err := UpdateIntentExecution(ctx, database, execID, "completed", 3, 3, 0, 0, nil); err != nil {
		t.Fatal(err)
	}
	if err := MarkIntentExecutionFailed(ctx, database, execID, "peer cleanup"); err != nil {
		t.Fatal(err)
	}
	var status string
	var errMsg sql.NullString
	if err := database.QueryRowContext(ctx,
		`SELECT status, error_message FROM intent_executions WHERE id = ?`, execID).Scan(&status, &errMsg); err != nil {
		t.Fatal(err)
	}
	if status != "completed" || errMsg.Valid {
		t.Errorf("after late failure write: status=%q error=%v, want completed/NULL", status, errMsg)
	}

	// Reverse order: the failure write wins and a late success must lose.
	execID2, err := CreateIntentExecution(ctx, database, intentID, 1, "manual")
	if err != nil {
		t.Fatal(err)
	}
	if err := MarkIntentExecutionFailed(ctx, database, execID2, "boom"); err != nil {
		t.Fatal(err)
	}
	if err := UpdateIntentExecution(ctx, database, execID2, "completed", 5, 5, 0, 0, nil); err != nil {
		t.Fatal(err)
	}
	if err := database.QueryRowContext(ctx,
		`SELECT status, error_message FROM intent_executions WHERE id = ?`, execID2).Scan(&status, &errMsg); err != nil {
		t.Fatal(err)
	}
	if status != "failed" || errMsg.String != "boom" {
		t.Errorf("after late success write: status=%q error=%v, want failed/boom", status, errMsg)
	}
}
