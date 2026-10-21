package db

// Empty-history statistics must return zeros, not scan errors: SUM/AVG over
// zero rows are NULL and used to fail the integer scans.

import (
	"context"
	"testing"
)

func TestUpgradeStatsForUserWithoutHistory(t *testing.T) {
	database, err := Open(t.TempDir() + "/stats-empty.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	if err := Migrate(context.Background(), database); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	s, err := GetUpgradeHistoryStats(context.Background(), database, 42)
	if err != nil {
		t.Fatalf("GetUpgradeHistoryStats for empty user: %v", err)
	}
	if s.Total != 0 || s.Successful != 0 || s.Failed != 0 {
		t.Fatalf("stats = %+v, want zero counts", s)
	}

	ts, err := GetTrackedAppUpgradeHistoryStats(context.Background(), database, 42)
	if err != nil {
		t.Fatalf("GetTrackedAppUpgradeHistoryStats for empty user: %v", err)
	}
	if ts.Total != 0 || ts.Successful != 0 || ts.Failed != 0 || ts.TotalAppsChanged != 0 {
		t.Fatalf("tracked stats = %+v, want zero counts", ts)
	}
}
