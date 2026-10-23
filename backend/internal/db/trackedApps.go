package db

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strings"
)

// ErrTrackedAppExists is returned by CreateTrackedApp when another app with
// the same identity (user + image name, or user + GitHub repo) is already
// tracked.
var ErrTrackedAppExists = errors.New("tracked app already exists")

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
	RepositoryTokenID         sql.NullInt64
	GitlabToken               sql.NullString
}

const trackedAppCols = `id, user_id, name, image_name, github_repo, source_type,
	current_version, current_digest, latest_version, latest_digest, has_update,
	current_version_publish_date, latest_version_publish_date, last_checked, created_at, updated_at,
	repository_token_id, gitlab_token`

func scanTrackedApp(row interface{ Scan(...any) error }) (TrackedAppRow, error) {
	var r TrackedAppRow
	err := row.Scan(&r.ID, &r.UserID, &r.Name, &r.ImageName, &r.GithubRepo,
		&r.SourceType, &r.CurrentVersion, &r.CurrentDigest, &r.LatestVersion, &r.LatestDigest,
		&r.HasUpdate, &r.CurrentVersionPublishDate, &r.LatestVersionPublishDate,
		&r.LastChecked, &r.CreatedAt, &r.UpdatedAt,
		&r.RepositoryTokenID, &r.GitlabToken)
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
	imageName, githubRepo *string, sourceType string, gitlabToken, currentVersion *string) (int64, error) {

	result, err := database.ExecContext(ctx,
		`INSERT INTO tracked_apps (user_id, name, image_name, github_repo, source_type, gitlab_token, current_version)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		userID, name, imageName, githubRepo, sourceType, gitlabToken, currentVersion)
	if err != nil {
		if strings.Contains(err.Error(), "UNIQUE constraint failed") {
			return 0, fmt.Errorf("create tracked app: %w: %w", ErrTrackedAppExists, err)
		}
		return 0, fmt.Errorf("create tracked app: %w", err)
	}
	return result.LastInsertId()
}

// GetTrackedAppByImageName returns a tracked app matching the exact image name (conflict checks).
func GetTrackedAppByImageName(ctx context.Context, database *sql.DB, userID int64, imageName string) (*TrackedAppRow, error) {
	row := database.QueryRowContext(ctx,
		"SELECT "+trackedAppCols+" FROM tracked_apps WHERE user_id = ? AND image_name = ?", userID, imageName)

	r, err := scanTrackedApp(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get tracked app by image name: %w", err)
	}
	return &r, nil
}

func UpdateTrackedApp(ctx context.Context, database *sql.DB, id, userID int64,
	name, imageName, githubRepo, sourceType, gitlabToken *string) error {

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
	if gitlabToken != nil {
		// Empty string clears the token (mirrors Node semantics).
		if *gitlabToken == "" {
			setClauses = append(setClauses, "gitlab_token = NULL")
		} else {
			setClauses = append(setClauses, "gitlab_token = ?")
			args = append(args, *gitlabToken)
		}
	}

	// When the tracked source identity (image/repo/type) actually changes,
	// the observed state (versions, digests, dates, update flag) belongs to
	// the OLD source and must be reset, or the next check compares a new
	// image against the old image's baseline. The CASE conditions run
	// against the pre-update row values; COALESCE keeps NULL and ''
	// equivalent so no-op edits don't wipe state.
	if imageName != nil || githubRepo != nil || sourceType != nil {
		conds := []string{}
		condArgs := []any{}
		if imageName != nil {
			conds = append(conds, "COALESCE(image_name,'') <> ?")
			condArgs = append(condArgs, *imageName)
		}
		if githubRepo != nil {
			conds = append(conds, "COALESCE(github_repo,'') <> ?")
			condArgs = append(condArgs, *githubRepo)
		}
		if sourceType != nil {
			conds = append(conds, "source_type <> ?")
			condArgs = append(condArgs, *sourceType)
		}
		changed := strings.Join(conds, " OR ")
		for _, col := range []string{
			"current_version", "current_digest", "latest_version", "latest_digest",
			"current_version_publish_date", "latest_version_publish_date", "last_checked",
		} {
			setClauses = append(setClauses, fmt.Sprintf("%s = CASE WHEN %s THEN NULL ELSE %s END", col, changed, col))
			args = append(args, condArgs...)
		}
		setClauses = append(setClauses, fmt.Sprintf("has_update = CASE WHEN %s THEN 0 ELSE has_update END", changed))
		args = append(args, condArgs...)
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

// TrackedAppSnapshot carries the columns the check pipeline read before
// contacting the upstream source. UpdateTrackedAppFields only applies its
// writes while the row still matches this snapshot, so a concurrent user edit
// (or parallel scan) is skipped instead of clobbered.
//
// The source-identity columns are part of the guard as well: they decide WHICH
// upstream the observation came from. A check that read a GitHub-tracked row
// and then had its source_type or image_name edited mid-flight would otherwise
// pass a purely digest-shaped guard and file the old source's release data under
// a row that now describes something else.
type TrackedAppSnapshot struct {
	CurrentVersion sql.NullString
	CurrentDigest  sql.NullString
	LatestVersion  sql.NullString
	LatestDigest   sql.NullString

	SourceType sql.NullString
	ImageName  sql.NullString
	GithubRepo sql.NullString
}

// ObservedSnapshot captures a loaded row's observed-state and source-identity
// columns so the caller can pass them as the guard to UpdateTrackedAppFields.
func (a *TrackedAppRow) ObservedSnapshot() TrackedAppSnapshot {
	return TrackedAppSnapshot{
		CurrentVersion: a.CurrentVersion,
		CurrentDigest:  a.CurrentDigest,
		LatestVersion:  a.LatestVersion,
		LatestDigest:   a.LatestDigest,
		SourceType:     sql.NullString{String: a.SourceType, Valid: a.SourceType != ""},
		ImageName:      a.ImageName,
		GithubRepo:     a.GithubRepo,
	}
}

// UpdateTrackedAppFields applies the dynamic column updates produced by the
// tracked-apps check pipeline, mirroring Node's updateTrackedApp: map keys
// are column names, a nil value writes SQL NULL, and absent keys are left
// untouched. Keys come from this package's fixed allow-list, never user
// input. The write is guarded by the caller's snapshot of the observed
// columns; applied=false means the row changed underneath the check and the
// update was skipped.
func UpdateTrackedAppFields(ctx context.Context, database *sql.DB, id, userID int64,
	sets map[string]any, snapshot TrackedAppSnapshot) (applied bool, err error) {

	if len(sets) == 0 {
		return true, nil
	}

	cols := make([]string, 0, len(sets))
	for k := range sets {
		cols = append(cols, k)
	}
	sort.Strings(cols)

	assigns := make([]string, 0, len(cols))
	args := make([]any, 0, len(cols)+9)
	for _, c := range cols {
		assigns = append(assigns, c+" = ?")
		args = append(args, sets[c])
	}
	assigns = append(assigns, "updated_at = CURRENT_TIMESTAMP")
	args = append(args, id, userID,
		snapshot.CurrentVersion, snapshot.CurrentDigest,
		snapshot.LatestVersion, snapshot.LatestDigest,
		snapshot.SourceType, snapshot.ImageName, snapshot.GithubRepo)

	query := fmt.Sprintf(`UPDATE tracked_apps SET %s
		 WHERE id = ? AND user_id = ?
		   AND current_version IS NOT DISTINCT FROM ?
		   AND current_digest IS NOT DISTINCT FROM ?
		   AND latest_version IS NOT DISTINCT FROM ?
		   AND latest_digest IS NOT DISTINCT FROM ?
		   AND source_type IS NOT DISTINCT FROM ?
		   AND image_name IS NOT DISTINCT FROM ?
		   AND github_repo IS NOT DISTINCT FROM ?`,
		joinStrings(assigns, ", "))
	res, err := database.ExecContext(ctx, query, args...)
	if err != nil {
		return false, fmt.Errorf("update tracked app fields: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("update tracked app fields: %w", err)
	}
	return n > 0, nil
}

// normalizeVersion mirrors imagesync's version normalization: strip a
// leading v/V, trim, lower-case. Kept local so the db layer can decide
// whether an explicit current_version matches the observed latest_version.
func normalizeVersion(v string) string {
	s := v
	if len(s) > 0 && (s[0] == 'v' || s[0] == 'V') {
		s = s[1:]
	}
	return strings.ToLower(strings.TrimSpace(s))
}

// SetTrackedAppCurrentVersion applies an explicit user upgrade: sets current_version,
// syncs latest_version, clears has_update, and optionally carries the publish date over.
// Mirrors the Node PUT /tracked-apps/:id current_version semantics.
//
// The write is guarded on the observed (latest_version, latest_digest). A scan
// that lands between the client rendering the card and the user confirming the
// upgrade moves that observation, and an unguarded write then does two kinds of
// damage at once: it writes latest_version back from the stale read (undoing the
// scan's newer finding) and records the scan's digest as the baseline for a
// version that never ran it. The app then reads as up to date while it is
// behind. current_digest therefore comes from the observed snapshot rather than
// the column, and hasUpdate lets the caller keep the flag set when a re-read
// shows the acknowledged version is no longer the observed latest. Returns
// applied=false when the guard did not hold so the caller can re-read.
func SetTrackedAppCurrentVersion(ctx context.Context, database *sql.DB, id, userID int64,
	currentVersion, newLatest string, observed TrackedAppSnapshot, publishDate *string, hasUpdate bool) (bool, error) {

	// Move the digest baseline only when the acknowledged version IS the
	// observed latest version: that is the one case where the observed digest
	// is the digest this version runs. When the user sets a DIFFERENT version
	// (e.g. a rollback, or a manual tag that isn't the observed latest), the
	// observed digest belongs to another version, so the stale baseline must
	// be cleared instead - otherwise the digest-first comparison flags a bogus
	// update against a digest the app never ran.
	digestMatches := normalizeVersion(currentVersion) != "" &&
		normalizeVersion(observed.LatestVersion.String) == normalizeVersion(currentVersion)

	var currentDigest any
	if digestMatches && observed.LatestDigest.Valid {
		currentDigest = observed.LatestDigest.String
	}

	res, err := database.ExecContext(ctx,
		`UPDATE tracked_apps
		 SET current_version = ?, latest_version = ?, has_update = ?,
		     current_digest = ?,
		     current_version_publish_date = ?, latest_version_publish_date = NULL,
		     updated_at = datetime('now')
		 WHERE id = ? AND user_id = ?
		   AND latest_version IS NOT DISTINCT FROM ? AND latest_digest IS NOT DISTINCT FROM ?`,
		currentVersion, newLatest, hasUpdate, currentDigest, publishDate, id, userID,
		observed.LatestVersion, observed.LatestDigest)
	if err != nil {
		return false, fmt.Errorf("set tracked app current version: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("set tracked app current version: %w", err)
	}
	return n > 0, nil
}

// TrackedAppUpgradeHistoryInput carries the fields for a tracked_app_upgrade_history insert.
type TrackedAppUpgradeHistoryInput struct {
	UserID       int64
	TrackedAppID int64
	AppName      string
	Provider     string
	Repository   string
	OldVersion   string
	NewVersion   string
	OldTag       *string
	NewTag       *string
	OldCommitSHA *string
	NewCommitSHA *string
	Status       string
}

// InsertTrackedAppUpgradeHistory writes a tracked app upgrade record (parity with Node's
// createTrackedAppUpgradeHistory used by the explicit-upgrade flow).
func InsertTrackedAppUpgradeHistory(ctx context.Context, database *sql.DB, h TrackedAppUpgradeHistoryInput) error {
	status := h.Status
	if status == "" {
		status = "success"
	}
	_, err := database.ExecContext(ctx,
		`INSERT INTO tracked_app_upgrade_history (
			user_id, tracked_app_id, app_name, provider, repository,
			old_version, new_version, old_tag, new_tag,
			old_commit_sha, new_commit_sha, status
		 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		h.UserID, h.TrackedAppID, h.AppName, h.Provider, h.Repository,
		h.OldVersion, h.NewVersion, h.OldTag, h.NewTag,
		h.OldCommitSHA, h.NewCommitSHA, status)
	if err != nil {
		return fmt.Errorf("insert tracked app upgrade history: %w", err)
	}
	return nil
}

// TrackedAppUpgradeRow is a row from the tracked_app_upgrade_history table.
type TrackedAppUpgradeRow struct {
	ID              int64
	TrackedAppID    sql.NullInt64
	AppName         sql.NullString
	Provider        sql.NullString
	Repository      sql.NullString
	OldVersion      sql.NullString
	NewVersion      sql.NullString
	OldTag          sql.NullString
	NewTag          sql.NullString
	OldCommitSHA    sql.NullString
	NewCommitSHA    sql.NullString
	ReleaseNotes    sql.NullString
	Status          string
	ErrorMessage    sql.NullString
	UpgradeDuration sql.NullInt64
	CreatedAt       string
}

const trackedAppUpgradeCols = `id, tracked_app_id, app_name, provider, repository,
	old_version, new_version, old_tag, new_tag, old_commit_sha, new_commit_sha,
	release_notes, status, error_message, upgrade_duration_ms, created_at`

func scanTrackedAppUpgrade(row interface{ Scan(...any) error }) (TrackedAppUpgradeRow, error) {
	var r TrackedAppUpgradeRow
	err := row.Scan(&r.ID, &r.TrackedAppID, &r.AppName, &r.Provider, &r.Repository,
		&r.OldVersion, &r.NewVersion, &r.OldTag, &r.NewTag, &r.OldCommitSHA, &r.NewCommitSHA,
		&r.ReleaseNotes, &r.Status, &r.ErrorMessage, &r.UpgradeDuration, &r.CreatedAt)
	return r, err
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
		`SELECT `+trackedAppUpgradeCols+`
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
		r, err := scanTrackedAppUpgrade(rows)
		if err != nil {
			return nil, 0, fmt.Errorf("scan tracked app upgrade: %w", err)
		}
		results = append(results, r)
	}
	return results, total, rows.Err()
}

// GetTrackedAppUpgradeHistoryAll returns the user's tracked-app upgrade history
// across all apps with the same filters/paging as Node's REST route
// (appName is a LIKE substring match; provider/status are exact).
func GetTrackedAppUpgradeHistoryAll(ctx context.Context, database *sql.DB, userID int64, appName, provider, status *string, limit, offset int) ([]TrackedAppUpgradeRow, error) {
	q := `SELECT ` + trackedAppUpgradeCols + ` FROM tracked_app_upgrade_history WHERE user_id = ?`
	args := []any{userID}
	if appName != nil && *appName != "" {
		q += " AND app_name LIKE ?"
		args = append(args, "%"+*appName+"%")
	}
	if provider != nil && *provider != "" {
		q += " AND provider = ?"
		args = append(args, *provider)
	}
	if status != nil && *status != "" {
		q += " AND status = ?"
		args = append(args, *status)
	}
	q += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
	args = append(args, limit, offset)

	rows, err := database.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("get tracked app upgrades all: %w", err)
	}
	defer rows.Close()

	var results []TrackedAppUpgradeRow
	for rows.Next() {
		r, err := scanTrackedAppUpgrade(rows)
		if err != nil {
			return nil, fmt.Errorf("scan tracked app upgrade: %w", err)
		}
		results = append(results, r)
	}
	return results, rows.Err()
}

// TrackedAppUpgradeStats aggregates tracked_app_upgrade_history for one user,
// mirroring Node's getTrackedAppUpgradeHistoryStats.
type TrackedAppUpgradeStats struct {
	Total            int
	Successful       int
	Failed           int
	AvgDuration      sql.NullFloat64
	FirstUpgrade     sql.NullString
	LastUpgrade      sql.NullString
	TotalAppsChanged int
}

func GetTrackedAppUpgradeHistoryStats(ctx context.Context, database *sql.DB, userID int64) (*TrackedAppUpgradeStats, error) {
	var s TrackedAppUpgradeStats
	err := database.QueryRowContext(ctx,
		`SELECT COUNT(*),
			COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0),
			AVG(upgrade_duration_ms), MIN(created_at), MAX(created_at),
			COUNT(DISTINCT app_name)
		 FROM tracked_app_upgrade_history WHERE user_id = ?`, userID).
		Scan(&s.Total, &s.Successful, &s.Failed, &s.AvgDuration, &s.FirstUpgrade, &s.LastUpgrade, &s.TotalAppsChanged)
	if err != nil {
		return nil, fmt.Errorf("tracked app upgrade stats: %w", err)
	}
	return &s, nil
}
