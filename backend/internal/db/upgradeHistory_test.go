package db

import (
	"context"
	"testing"
)

// TestGetUpgradeHistoryForContainerMatchesOnHostAndName pins the identity used
// to look up one container's history. The upgrade pipeline removes and
// recreates the container, so its Docker id changes on every upgrade while the
// name and host stay the same. Matching on container_id therefore reported a
// freshly upgraded container as having no history at all (101 of 102 stack
// containers on real data returned totalCount 0 while 2014 history rows
// existed).
func TestGetUpgradeHistoryForContainerMatchesOnHostAndName(t *testing.T) {
	ctx := context.Background()
	database := testDB(t)
	migrate(t, database)

	const uid = 1
	if _, err := database.Exec(
		`INSERT INTO runners (user_id, name, url, api_key, enabled) VALUES (?, 'toybox', 'http://r', 'k', 1)`, uid); err != nil {
		t.Fatal(err)
	}
	var runnerID int64
	if err := database.QueryRow("SELECT id FROM runners WHERE user_id = ?", uid).Scan(&runnerID); err != nil {
		t.Fatal(err)
	}

	// Three upgrades of the same container, each under a NEW Docker id.
	seed := []struct {
		dockerID string
		status   string
	}{
		{"aaaa000000000000000000000000000000000000000000000000000000000001", "success"},
		{"bbbb000000000000000000000000000000000000000000000000000000000002", "success"},
		{"cccc000000000000000000000000000000000000000000000000000000000003", "failed"},
	}
	for _, s := range seed {
		if _, err := database.Exec(
			`INSERT INTO upgrade_history (user_id, runner_id, container_id, container_name, old_image, new_image, status)
			 VALUES (?, ?, ?, 'radarr', 'radarr:1', 'radarr:2', ?)`, uid, runnerID, s.dockerID, s.status); err != nil {
			t.Fatal(err)
		}
	}
	// Same name on another runner: must not be pulled in.
	if _, err := database.Exec(
		`INSERT INTO upgrade_history (user_id, runner_id, container_id, container_name, old_image, new_image, status)
		 VALUES (?, 999, 'dddd000000000000000000000000000000000000000000000000000000000004', 'radarr', 'a:1', 'a:2', 'success')`, uid); err != nil {
		t.Fatal(err)
	}
	// Another user's row.
	if _, err := database.Exec(
		`INSERT INTO upgrade_history (user_id, runner_id, container_id, container_name, old_image, new_image, status)
		 VALUES (2, ?, 'eeee000000000000000000000000000000000000000000000000000000000005', 'radarr', 'a:1', 'a:2', 'success')`, runnerID); err != nil {
		t.Fatal(err)
	}

	// The container's CURRENT id is the last one: an id-based lookup would see
	// one row at most, the host+name lookup sees the container's whole history.
	got, total, err := GetUpgradeHistoryForContainer(ctx, database, uid, 50, 0, &runnerID, nil, "radarr")
	if err != nil {
		t.Fatal(err)
	}
	if total != 3 {
		t.Errorf("total = %d, want 3 (history must follow the container across recreates)", total)
	}
	if len(got) != 3 {
		t.Errorf("rows = %d, want 3", len(got))
	}
	for _, r := range got {
		if !r.RunnerID.Valid || r.RunnerID.Int64 != runnerID {
			t.Errorf("row %d belongs to another host: runnerID=%v", r.ID, r.RunnerID)
		}
	}

	// A name that only exists on another runner must come back empty rather
	// than borrowing that runner's rows.
	other := int64(999)
	if _, total, err := GetUpgradeHistoryForContainer(ctx, database, uid, 50, 0, &other, nil, "radarr"); err != nil {
		t.Fatal(err)
	} else if total != 1 {
		t.Errorf("other runner's window: total = %d, want 1", total)
	}
	if _, total, err := GetUpgradeHistoryForContainer(ctx, database, uid, 50, 0, ptr(int64(12345)), nil, "radarr"); err != nil {
		t.Fatal(err)
	} else if total != 0 {
		t.Errorf("unknown runner: total = %d, want 0", total)
	}

	// Name is required: an empty name must not degrade into "every row".
	if _, _, err := GetUpgradeHistoryForContainer(ctx, database, uid, 50, 0, &runnerID, nil, ""); err == nil {
		t.Error("empty container name must be an error")
	}
}

func ptr(v int64) *int64 { return &v }
