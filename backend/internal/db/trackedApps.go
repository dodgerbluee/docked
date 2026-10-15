package db

import (
	"context"
	"database/sql"
	"fmt"
)

// TrackedAppRow is a row from the tracked_apps table.
type TrackedAppRow struct {
	ID                        int64
	UserID                    int64
	Name                      string
	ImageName                 sql.NullString
	GithubRepo                sql.NullString
	SourceType                string
	CurrentVersion            sql.NullString
	CurrentDigest             sql.NullString
	LatestVersion             sql.NullString
	LatestDigest              sql.NullString
	HasUpdate                 int
	CurrentVersionPublishDate sql.NullString
	LatestVersionPublishDate  sql.NullString
	LastChecked               sql.NullString
	CreatedAt                 string
	UpdatedAt                 string
}

const trackedAppCols = `id, user_id, name, image_name, github_repo, source_type,
	current_version, current_digest, latest_version, latest_digest, has_update,
	current_version_publish_date, latest_version_publish_date, last_checked, created_at, updated_at`

func scanTrackedApp(row interface{ Scan(...any) error }) (TrackedAppRow, error) {
	var r TrackedAppRow
	err := row.Scan(&r.ID, &r.UserID, &r.Name, &r.ImageName, &r.GithubRepo,
		&r.SourceType, &r.CurrentVersion, &r.CurrentDigest, &r.LatestVersion, &r.LatestDigest,
		&r.HasUpdate, &r.CurrentVersionPublishDate, &r.LatestVersionPublishDate,
		&r.LastChecked, &r.CreatedAt, &r.UpdatedAt)
	return r, err
}

func GetAllTrackedApps(ctx context.Context, database *sql.DB, userID int64) ([]TrackedAppRow, error) {
	rows, err := database.QueryContext(ctx,
		"SELECT "+trackedAppCols+" FROM tracked_apps WHERE user_id = ? ORDER BY name ASC", userID)
	if err != nil {
		return nil, fmt.Errorf("get tracked apps: %w", err)
	}
	defer rows.Close()

	var results []TrackedAppRow
	for rows.Next() {
		r, err := scanTrackedApp(rows)
		if err != nil {
			return nil, fmt.Errorf("scan tracked app: %w", err)
		}
		results = append(results, r)
	}
	return results, rows.Err()
}

func GetTrackedAppByID(ctx context.Context, database *sql.DB, id, userID int64) (*TrackedAppRow, error) {
	row := database.QueryRowContext(ctx,
		"SELECT "+trackedAppCols+" FROM tracked_apps WHERE id = ? AND user_id = ?", id, userID)

	r, err := scanTrackedApp(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get tracked app: %w", err)
	}
	return &r, nil
}

func CreateTrackedApp(ctx context.Context, database *sql.DB, userID int64, name string,
	imageName, githubRepo *string, sourceType string) (int64, error) {

	result, err := database.ExecContext(ctx,
		`INSERT INTO tracked_apps (user_id, name, image_name, github_repo, source_type)
		 VALUES (?, ?, ?, ?, ?)`,
		userID, name, imageName, githubRepo, sourceType)
	if err != nil {
		return 0, fmt.Errorf("create tracked app: %w", err)
	}
	return result.LastInsertId()
}

func UpdateTrackedApp(ctx context.Context, database *sql.DB, id, userID int64,
	name, imageName, githubRepo, sourceType *string) error {

	setClauses := []string{}
	args := []any{}

	if name != nil {
		setClauses = append(setClauses, "name = ?")
		args = append(args, *name)
	}
	if imageName != nil {
		setClauses = append(setClauses, "image_name = ?")
		args = append(args, *imageName)
	}
	if githubRepo != nil {
		setClauses = append(setClauses, "github_repo = ?")
		args = append(args, *githubRepo)
	}
	if sourceType != nil {
		setClauses = append(setClauses, "source_type = ?")
		args = append(args, *sourceType)
	}

	if len(setClauses) == 0 {
		return nil
	}

	setClauses = append(setClauses, "updated_at = datetime('now')")
	args = append(args, id, userID)

	query := fmt.Sprintf("UPDATE tracked_apps SET %s WHERE id = ? AND user_id = ?",
		joinStrings(setClauses, ", "))

	_, err := database.ExecContext(ctx, query, args...)
	return err
}

func DeleteTrackedApp(ctx context.Context, database *sql.DB, id, userID int64) error {
	_, err := database.ExecContext(ctx,
		"DELETE FROM tracked_apps WHERE id = ? AND user_id = ?", id, userID)
	return err
}

func UpdateTrackedAppVersion(ctx context.Context, database *sql.DB, id int64, latestVersion, latestDigest string) error {
	hasUpdate := 0
	if latestVersion != "" {
		hasUpdate = 1
	}
	_, err := database.ExecContext(ctx,
		`UPDATE tracked_apps SET latest_version=?, latest_digest=?, has_update=?, last_checked=CURRENT_TIMESTAMP WHERE id=?`,
		latestVersion, latestDigest, hasUpdate, id)
	return err
}

// TrackedAppUpgradeRow is a row from the tracked_app_upgrade_history table.
type TrackedAppUpgradeRow struct {
	ID           int64
	TrackedAppID sql.NullInt64
	OldVersion   sql.NullString
	NewVersion   sql.NullString
	OldTag       sql.NullString
	NewTag       sql.NullString
	OldCommitSHA sql.NullString
	NewCommitSHA sql.NullString
	Status       string
	CreatedAt    string
}

// GetTrackedAppUpgradeHistory returns upgrade records for a single tracked app.
func GetTrackedAppUpgradeHistory(ctx context.Context, database *sql.DB, userID, trackedAppID int64, limit, offset int) ([]TrackedAppUpgradeRow, int, error) {
	var total int
	if err := database.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM tracked_app_upgrade_history WHERE user_id = ? AND tracked_app_id = ?",
		userID, trackedAppID).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("count tracked app upgrades: %w", err)
	}

	rows, err := database.QueryContext(ctx,
		`SELECT id, tracked_app_id, old_version, new_version, old_tag, new_tag,
			old_commit_sha, new_commit_sha, status, created_at
		 FROM tracked_app_upgrade_history
		 WHERE user_id = ? AND tracked_app_id = ?
		 ORDER BY created_at DESC LIMIT ? OFFSET ?`,
		userID, trackedAppID, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("get tracked app upgrades: %w", err)
	}
	defer rows.Close()

	var results []TrackedAppUpgradeRow
	for rows.Next() {
		var r TrackedAppUpgradeRow
		if err := rows.Scan(&r.ID, &r.TrackedAppID, &r.OldVersion, &r.NewVersion,
			&r.OldTag, &r.NewTag, &r.OldCommitSHA, &r.NewCommitSHA, &r.Status, &r.CreatedAt); err != nil {
			return nil, 0, fmt.Errorf("scan tracked app upgrade: %w", err)
		}
		results = append(results, r)
	}
	return results, total, rows.Err()
}
