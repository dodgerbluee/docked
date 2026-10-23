package imagesync

import (
	"context"
	"errors"
	"testing"

	"github.com/dockedapp/backend/internal/db"
)

// The client's batchJobProgress handler is written for the job types this
// service owns (DOCKER_HUB_PULL and friends). Those runs are started here and
// by the cron scheduler, not by a mutation, so completeRun is the only place
// that can report them. A run that finalizes without reaching OnBatchRun is a
// run no subscriber ever hears about.
func TestCompleteRunReportsEveryOutcome(t *testing.T) {
	svc, database := newAppVersionTestService(t)
	ctx := context.Background()

	type report struct {
		userID int64
		runID  int64
	}
	var got []report
	svc.OnBatchRun = func(_ context.Context, userID, runID int64) {
		got = append(got, report{userID, runID})
	}

	cases := []struct {
		name       string
		runErr     error
		wantStatus string
	}{
		{name: "clean scan", runErr: nil, wantStatus: "completed"},
		{
			name:       "partial scan",
			runErr:     &PartialScanError{Scanned: 1, Failed: 1, Details: []string{"runner offline"}},
			wantStatus: "completed",
		},
		{name: "hard failure", runErr: errors.New("no runner could be scanned"), wantStatus: "failed"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			runID, err := db.CreateBatchRun(ctx, database, 7, "docker-hub-pull", true)
			if err != nil {
				t.Fatalf("create run: %v", err)
			}
			before := len(got)
			if err := svc.completeRun(ctx, 7, runID, 10, 2, tc.runErr); err == nil && tc.runErr != nil {
				t.Fatal("completeRun must surface the scan error")
			}
			if len(got) != before+1 {
				t.Fatalf("OnBatchRun calls = %d, want exactly 1 more", len(got)-before)
			}
			last := got[len(got)-1]
			if last.userID != 7 || last.runID != runID {
				t.Fatalf("reported (%d, %d), want (7, %d)", last.userID, last.runID, runID)
			}
			var status string
			if err := database.QueryRowContext(ctx,
				"SELECT status FROM batch_runs WHERE id = ?", runID).Scan(&status); err != nil {
				t.Fatalf("read run: %v", err)
			}
			if status != tc.wantStatus {
				t.Fatalf("run status = %q, want %s", status, tc.wantStatus)
			}
		})
	}
}

// An unwired hook must not break a scan: the service is built without it in
// tests and in any embedding that has no GraphQL layer.
func TestCompleteRunWithoutReportHook(t *testing.T) {
	svc, database := newAppVersionTestService(t)
	ctx := context.Background()

	runID, err := db.CreateBatchRun(ctx, database, 3, "docker-hub-pull", false)
	if err != nil {
		t.Fatalf("create run: %v", err)
	}
	if err := svc.completeRun(ctx, 3, runID, 1, 0, nil); err != nil {
		t.Fatalf("completeRun: %v", err)
	}
	var status string
	if err := database.QueryRowContext(ctx,
		"SELECT status FROM batch_runs WHERE id = ?", runID).Scan(&status); err != nil {
		t.Fatalf("read run: %v", err)
	}
	if status != "completed" {
		t.Fatalf("run status = %q, want completed", status)
	}
}
