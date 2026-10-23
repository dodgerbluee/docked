package imagesync

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/dockedapp/backend/internal/db"
)

// newTrackedTestDB creates the tables the tracked-apps pipeline touches
// (Node-created schema shapes).
func newTrackedTestDB(t *testing.T) *sql.DB {
	t.Helper()
	database, err := db.Open(filepath.Join(t.TempDir(), "tracked-test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { database.Close() })

	stmts := []string{
		`CREATE TABLE tracked_apps (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			name TEXT NOT NULL,
			image_name TEXT,
			github_repo TEXT,
			source_type TEXT DEFAULT 'docker',
			gitlab_token TEXT,
			current_version TEXT,
			current_digest TEXT,
			latest_version TEXT,
			latest_digest TEXT,
			has_update INTEGER DEFAULT 0,
			current_version_publish_date TEXT,
			latest_version_publish_date TEXT,
			last_checked DATETIME,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			repository_token_id INTEGER,
			UNIQUE(user_id, image_name, github_repo)
		)`,
		`CREATE TABLE batch_runs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			job_type TEXT DEFAULT 'docker-hub-pull',
			status TEXT NOT NULL,
			is_manual INTEGER DEFAULT 0,
			started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			completed_at DATETIME,
			duration_ms INTEGER,
			containers_checked INTEGER DEFAULT 0,
			containers_updated INTEGER DEFAULT 0,
			error_message TEXT,
			logs TEXT,
			heartbeat_at DATETIME
		)`,
		`CREATE TABLE discord_webhooks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL, webhook_url TEXT NOT NULL,
			server_name TEXT, channel_name TEXT, name TEXT,
			enabled INTEGER DEFAULT 1, avatar_url TEXT, guild_id TEXT, channel_id TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE discord_notifications_sent (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL, deduplication_key TEXT NOT NULL,
			notification_type TEXT, sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(user_id, deduplication_key)
		)`,
	}
	for _, s := range stmts {
		if _, err := database.Exec(s); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
	return database
}

func newTrackedTestService(t *testing.T) *Service {
	t.Helper()
	ClearReleaseCache()
	t.Cleanup(ClearReleaseCache)
	dockerRateLimitDelay = 0
	t.Cleanup(func() { dockerRateLimitDelay = time.Second })
	return NewService(newTrackedTestDB(t), nil)
}

func insertTrackedApp(t *testing.T, database *sql.DB, values map[string]any) *db.TrackedAppRow {
	t.Helper()
	cols := []string{"user_id", "name"}
	args := []any{1, values["name"]}
	for _, c := range []string{"image_name", "github_repo", "source_type", "current_version",
		"current_digest", "latest_version", "latest_digest", "has_update",
		"current_version_publish_date", "latest_version_publish_date", "gitlab_token",
		"repository_token_id"} {
		if v, ok := values[c]; ok {
			cols = append(cols, c)
			args = append(args, v)
		}
	}
	q := fmt.Sprintf("INSERT INTO tracked_apps (%s) VALUES (%s)",
		join(cols, ", "), placeholders(len(cols)))
	res, err := database.Exec(q, args...)
	if err != nil {
		t.Fatalf("insert tracked app: %v", err)
	}
	id, _ := res.LastInsertId()
	app, err := db.GetTrackedAppByID(context.Background(), database, id, 1)
	if err != nil || app == nil {
		t.Fatalf("reload tracked app: %v", err)
	}
	return app
}

func join(parts []string, sep string) string {
	out := ""
	for i, p := range parts {
		if i > 0 {
			out += sep
		}
		out += p
	}
	return out
}

func placeholders(n int) string {
	out := ""
	for i := 0; i < n; i++ {
		if i > 0 {
			out += ", "
		}
		out += "?"
	}
	return out
}

func nullStr(s string) sql.NullString {
	return sql.NullString{String: s, Valid: true}
}

// ---------- pure helpers ----------

func TestNormalizeVersion(t *testing.T) {
	cases := map[string]string{
		"v1.2.3":   "1.2.3",
		"V1.2.3":   "1.2.3",
		" 1.2.3 ":  "1.2.3",
		"latest":   "latest",
		"":         "",
		"v":        "",
		"1.0-beta": "1.0-beta",
		" v1.2.3":  "v1.2.3", // faithful: ^v is anchored pre-trim (Node quirk)
	}
	for in, want := range cases {
		if got := normalizeVersion(in); got != want {
			t.Errorf("normalizeVersion(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestNormalizeDigestForComparison(t *testing.T) {
	if got := normalizeDigestForComparison("SHA256:ABC"); got != "abc" {
		t.Errorf("got %q", got)
	}
	if got := normalizeDigestForComparison(""); got != "" {
		t.Errorf("got %q", got)
	}
}

func TestFormatDigest(t *testing.T) {
	if formatDigest("") != nil {
		t.Error("empty digest should be nil")
	}
	got := formatDigest("sha256:0123456789abcdef0123")
	if got == nil || *got != "0123456789ab" {
		t.Errorf("got %v", got)
	}
}

func TestJsStoreableString(t *testing.T) {
	for _, bad := range []string{"", " ", "null", "undefined"} {
		if jsStoreableString(bad) != "" {
			t.Errorf("jsStoreableString(%q) should be empty", bad)
		}
	}
	if jsStoreableString(" 1.2.3 ") != "1.2.3" {
		t.Error("should trim valid values")
	}
}

func TestNewlyDetectedDocker(t *testing.T) {
	app := &db.TrackedAppRow{HasUpdate: 0}
	if !newlyDetectedDocker(true, app, nil, nil) {
		t.Error("first-time update must be newly detected")
	}
	if newlyDetectedDocker(false, app, nil, nil) {
		t.Error("no update -> not newly detected")
	}

	app = &db.TrackedAppRow{HasUpdate: 1,
		LatestDigest: nullStr("sha256:aaa"), LatestVersion: nullStr("1.0")}
	if !newlyDetectedDocker(true, app, strPtr("sha256:bbb"), nil) {
		t.Error("different digest must re-trigger")
	}
	if newlyDetectedDocker(true, app, strPtr("sha256:aaa"), strPtr("1.0")) {
		t.Error("same digest+version must not re-trigger")
	}
	app = &db.TrackedAppRow{HasUpdate: 1, LatestVersion: nullStr("1.0")}
	if !newlyDetectedDocker(true, app, nil, strPtr("v2.0")) {
		t.Error("different version must re-trigger")
	}
}

func TestNewlyDetectedVersion(t *testing.T) {
	app := &db.TrackedAppRow{HasUpdate: 1, LatestVersion: nullStr("1.0")}
	if newlyDetectedVersion(true, app, strPtr("V1.0")) {
		t.Error("normalized match must not re-trigger")
	}
	if !newlyDetectedVersion(true, app, strPtr("2.0")) {
		t.Error("different version must re-trigger")
	}
}

func TestCreateTrackedImageKey(t *testing.T) {
	d := trackedNotification{Name: "n", ImageName: "img:latest", LatestDigest: strPtr("sha256:ABC")}
	if got := createTrackedImageKey(7, d); got != "7:img:latest:abc" {
		t.Errorf("got %q", got)
	}
	d = trackedNotification{Name: "n", GithubRepo: "o/r", LatestVersion: "1.2"}
	if got := createTrackedImageKey(7, d); got != "7:o/r:1.2" {
		t.Errorf("got %q", got)
	}
	d = trackedNotification{Name: "only-name"}
	if got := createTrackedImageKey(7, d); got != "7:only-name:" {
		t.Errorf("got %q", got)
	}
}

func TestFormatTrackedAppNotification(t *testing.T) {
	embeds := formatTrackedAppNotification(trackedNotification{
		Name: "Immich", ImageName: "ghcr.io/image/immich", SourceType: "docker",
		CurrentVersion: "v1.0", LatestVersion: "v1.1",
		LatestVersionPublishDate: strPtr("2026-01-02T03:04:05.000Z"),
	})["embeds"].([]any)[0].(map[string]any)

	if embeds["title"] != trackedEmbedTitle {
		t.Errorf("title = %v", embeds["title"])
	}
	fields := embeds["fields"].([]map[string]any)
	if len(fields) != 4 {
		t.Fatalf("want 4 fields, got %d", len(fields))
	}
	if fields[0]["name"] != "Latest Version" || fields[1]["name"] != "Release Date" ||
		fields[2]["name"] != "Source" || fields[3]["name"] != "Current Version" {
		t.Errorf("field order = %v %v %v %v", fields[0]["name"], fields[1]["name"],
			fields[2]["name"], fields[3]["name"])
	}
	// Non-hub image still gets a hub.docker.com link (faithful Node quirk:
	// getDockerHubRepoUrl only strips docker.io/ prefixes).
	if fields[2]["value"] != "[Docker: ghcr.io/image/immich](https://hub.docker.com/r/ghcr.io/image/immich)" {
		t.Errorf("source = %v", fields[2]["value"])
	}

	// GitHub source + release link.
	embeds = formatTrackedAppNotification(trackedNotification{
		Name: "App", GithubRepo: "owner/repo", SourceType: "github",
		CurrentVersion: "1.0", LatestVersion: "2.0", ReleaseURL: strPtr("https://github.com/owner/repo/releases/tag/2.0"),
	})["embeds"].([]any)[0].(map[string]any)
	fields = embeds["fields"].([]map[string]any)
	if fields[0]["value"] != "[2.0](https://github.com/owner/repo/releases/tag/2.0)" {
		t.Errorf("latest display = %v", fields[0]["value"])
	}
	if fields[1]["name"] != "Source" {
		t.Error("no publish date -> no Release Date field")
	}
	if fields[1]["value"] != "[GitHub: owner/repo](https://github.com/owner/repo)" {
		t.Errorf("source = %v", fields[1]["value"])
	}

	// GitLab apps name their own source. The faithful Node behaviour rendered
	// them as "Docker: Unknown", which announced a GitLab release as if it
	// came from an unnamed Docker image.
	embeds = formatTrackedAppNotification(trackedNotification{
		Name: "App", GithubRepo: "group/proj", SourceType: "gitlab",
		CurrentVersion: "1.0", LatestVersion: "2.0",
	})["embeds"].([]any)[0].(map[string]any)
	fields = embeds["fields"].([]map[string]any)
	if fields[1]["value"] != "GitLab: group/proj" {
		t.Errorf("gitlab source branch = %v", fields[1]["value"])
	}
}

func TestParseGitHubRepo(t *testing.T) {
	cases := []struct {
		in          string
		owner, repo string
		ok          bool
	}{
		{"owner/repo", "owner", "repo", true},
		{"https://github.com/owner/repo", "owner", "repo", true},
		{"https://github.com/owner/repo.git", "owner", "repo", true},
		{"git@github.com:owner/repo.git", "owner", "repo", true}, // Node strips .git pre-split
		{"justowner", "", "", false},
		{"", "", "", false},
	}
	for _, c := range cases {
		o, r, ok := parseGitHubRepo(c.in)
		if ok != c.ok || o != c.owner || r != c.repo {
			t.Errorf("parseGitHubRepo(%q) = %q,%q,%v want %q,%q,%v", c.in, o, r, ok, c.owner, c.repo, c.ok)
		}
	}
}

func TestParseGitLabRepo(t *testing.T) {
	o, r, b, ok := parseGitLabRepo("group/sub/project")
	if !ok || o != "group" || r != "sub/project" || b != gitlabComBase {
		t.Errorf("owner/repo form = %q %q %q %v", o, r, b, ok)
	}
	o, r, b, ok = parseGitLabRepo("https://gitlab.example.com/group/proj.git")
	if !ok || o != "group" || r != "proj" || b != "https://gitlab.example.com" {
		t.Errorf("https form = %q %q %q %v", o, r, b, ok)
	}
	o, r, b, ok = parseGitLabRepo("git@gitlab.com:group/proj.git")
	if !ok || o != "group" || r != "proj" || b != "https://gitlab.com" {
		t.Errorf("ssh form = %q %q %q %v", o, r, b, ok)
	}
}

// ---------- DB layer ----------

func TestUpdateTrackedAppFields(t *testing.T) {
	database := newTrackedTestDB(t)
	ctx := context.Background()

	app := insertTrackedApp(t, database, map[string]any{
		"name": "keep", "image_name": "img",
		"latest_version": "old", "latest_digest": "sha256:old",
	})

	// absent key = untouched, nil value = NULL.
	if applied, err := db.UpdateTrackedAppFields(ctx, database, app.ID, 1, map[string]any{
		"has_update":     1,
		"latest_digest":  nil,
		"latest_version": "new",
	}, app.ObservedSnapshot()); err != nil || !applied {
		t.Fatalf("update: applied=%v err=%v", applied, err)
	}

	got, err := db.GetTrackedAppByID(ctx, database, app.ID, 1)
	if err != nil || got == nil {
		t.Fatalf("reload: %v", err)
	}
	if got.HasUpdate != 1 || got.LatestVersion.String != "new" || got.LatestDigest.Valid {
		t.Errorf("got has_update=%d latest_version=%q latest_digest.valid=%v",
			got.HasUpdate, got.LatestVersion.String, got.LatestDigest.Valid)
	}
	if got.ImageName.String != "img" {
		t.Error("image_name must be untouched")
	}

	// Wrong user must not match.
	if applied, err := db.UpdateTrackedAppFields(ctx, database, app.ID, 999,
		map[string]any{"has_update": 0}, app.ObservedSnapshot()); err != nil || applied {
		t.Fatalf("update wrong user: applied=%v err=%v", applied, err)
	}
	got, _ = db.GetTrackedAppByID(ctx, database, app.ID, 1)
	if got.HasUpdate != 1 {
		t.Error("wrong-user update must not apply")
	}
}

// A scan that started before a user's explicit acknowledgement must not
// re-apply its stale verdict afterwards: the write is guarded by the observed
// columns the scan read, and applied=false when they have moved.
func TestUpdateTrackedAppFieldsSkipsStaleSnapshot(t *testing.T) {
	database := newTrackedTestDB(t)
	ctx := context.Background()

	app := insertTrackedApp(t, database, map[string]any{
		"name": "race", "image_name": "img",
		"current_version": "1.0", "latest_version": "2.0",
		"current_digest": "sha256:old", "latest_digest": "sha256:new",
		"has_update": 1,
	})
	stale := app.ObservedSnapshot()

	// The user acknowledges 2.0 while the scan is in flight.
	if _, err := database.ExecContext(ctx,
		`UPDATE tracked_apps SET current_version='2.0', current_digest='sha256:new',
		 latest_version='2.0', latest_digest='sha256:new', has_update=0 WHERE id=?`, app.ID); err != nil {
		t.Fatalf("acknowledge: %v", err)
	}

	// The stale scan now tries to persist its verdict.
	applied, err := db.UpdateTrackedAppFields(ctx, database, app.ID, 1, map[string]any{
		"has_update": 1, "latest_version": "3.0", "latest_digest": "sha256:third",
	}, stale)
	if err != nil {
		t.Fatalf("stale update: %v", err)
	}
	if applied {
		t.Error("stale snapshot must not apply")
	}

	got, err := db.GetTrackedAppByID(ctx, database, app.ID, 1)
	if err != nil || got == nil {
		t.Fatalf("reload: %v", err)
	}
	if got.HasUpdate != 0 || got.CurrentVersion.String != "2.0" ||
		got.CurrentDigest.String != "sha256:new" || got.LatestDigest.String != "sha256:new" {
		t.Errorf("acknowledgement clobbered: has_update=%d current=%q/%q latest_digest=%q",
			got.HasUpdate, got.CurrentVersion.String, got.CurrentDigest.String, got.LatestDigest.String)
	}

	// Non-vacuity control: the same write against a fresh snapshot applies.
	fresh := got.ObservedSnapshot()
	applied, err = db.UpdateTrackedAppFields(ctx, database, app.ID, 1,
		map[string]any{"latest_version": "3.0"}, fresh)
	if err != nil || !applied {
		t.Errorf("fresh snapshot must apply: applied=%v err=%v", applied, err)
	}
}

// ---------- Docker Hub tags flow ----------

func hubTagsServer(t *testing.T, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	old := dockerHubTagsBase
	dockerHubTagsBase = srv.URL
	t.Cleanup(func() { dockerHubTagsBase = old })
	return srv
}

func TestGetLatestVersionFromDockerHubTags(t *testing.T) {
	ctx := context.Background()

	t.Run("429 aborts", func(t *testing.T) {
		hubTagsServer(t, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusTooManyRequests)
		})
		_, err := getLatestVersionFromDockerHubTags(ctx, "library/nginx")
		if !errors.Is(err, ErrRateLimited) {
			t.Errorf("want ErrRateLimited, got %v", err)
		}
	})

	t.Run("non-200 returns nil", func(t *testing.T) {
		hubTagsServer(t, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusNotFound)
		})
		info, err := getLatestVersionFromDockerHubTags(ctx, "no/suchrepo")
		if err != nil || info != nil {
			t.Errorf("want nil,nil got %v,%v", info, err)
		}
	})

	t.Run("latest tag resolves version by digest match", func(t *testing.T) {
		hubTagsServer(t, func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/v2/repositories/library/nginx/tags/" {
				t.Errorf("unexpected path %q", r.URL.Path)
			}
			json.NewEncoder(w).Encode(map[string]any{
				"results": []map[string]any{
					{"name": "latest", "digest": "sha256:aaa", "tag_last_pushed": "2026-01-02T03:04:05Z"},
					{"name": "1.25.3", "digest": "sha256:aaa", "tag_last_pushed": "2026-01-02T03:04:05Z"},
					{"name": "1.25.2", "digest": "sha256:bbb", "tag_last_pushed": "2025-12-01T00:00:00Z"},
				},
			})
		})
		info, err := getLatestVersionFromDockerHubTags(ctx, "nginx")
		if err != nil || info == nil {
			t.Fatalf("got %v, %v", info, err)
		}
		if info.latestVersion != "1.25.3" {
			t.Errorf("latestVersion = %q", info.latestVersion)
		}
		if info.latestDigest != "sha256:aaa" {
			t.Errorf("latestDigest = %q", info.latestDigest)
		}
		if info.latestPublishDate != "2026-01-02T03:04:05Z" {
			t.Errorf("publishDate = %q", info.latestPublishDate)
		}
	})
}

func TestCheckDockerTrackedAppFirstCheckBackfills(t *testing.T) {
	svc := newTrackedTestService(t)
	hubTagsServer(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"results": []map[string]any{
				{"name": "latest", "digest": "sha256:aaa", "tag_last_pushed": "2026-01-02T03:04:05Z"},
				{"name": "1.2.3", "digest": "sha256:aaa", "tag_last_pushed": "2026-01-02T03:04:05Z"},
			},
		})
	})

	app := insertTrackedApp(t, svc.DB, map[string]any{
		"name": "backfill", "image_name": "nginx", "source_type": "docker",
	})

	res, err := svc.CheckTrackedApp(context.Background(), app)
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if res.HasUpdate {
		t.Error("first check must not report an update")
	}
	if res.CurrentVersion != "1.2.3" {
		t.Errorf("display current = %q", res.CurrentVersion)
	}

	got, _ := db.GetTrackedAppByID(context.Background(), svc.DB, app.ID, 1)
	if got.CurrentVersion.String != "1.2.3" || got.CurrentDigest.String != "sha256:aaa" {
		t.Errorf("backfill failed: current_version=%q current_digest=%q",
			got.CurrentVersion.String, got.CurrentDigest.String)
	}
	if got.LatestVersion.String != "1.2.3" || got.LatestDigest.String != "sha256:aaa" {
		t.Errorf("latest not stored: %q %q", got.LatestVersion.String, got.LatestDigest.String)
	}
	if !got.LastChecked.Valid || got.LastChecked.String == "" {
		t.Error("last_checked not written")
	}
}

func TestCheckDockerTrackedAppDigestMismatch(t *testing.T) {
	svc := newTrackedTestService(t)
	hubTagsServer(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"results": []map[string]any{
				{"name": "latest", "digest": "sha256:new", "tag_last_pushed": "2026-02-02T00:00:00Z"},
				{"name": "2.0", "digest": "sha256:new", "tag_last_pushed": "2026-02-02T00:00:00Z"},
			},
		})
	})

	app := insertTrackedApp(t, svc.DB, map[string]any{
		"name": "mismatch", "image_name": "nginx", "source_type": "docker",
		"current_version": "1.0", "current_digest": "sha256:old",
	})

	res, err := svc.CheckTrackedApp(context.Background(), app)
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if !res.HasUpdate {
		t.Fatal("digest mismatch must set hasUpdate")
	}
	if res.LatestVersion != "2.0" {
		t.Errorf("latest = %q", res.LatestVersion)
	}

	got, _ := db.GetTrackedAppByID(context.Background(), svc.DB, app.ID, 1)
	if got.HasUpdate != 1 || got.LatestVersion.String != "2.0" {
		t.Errorf("db: has_update=%d latest=%q", got.HasUpdate, got.LatestVersion.String)
	}
	if got.LatestVersionPublishDate.String != "2026-02-02T00:00:00Z" {
		t.Errorf("latest publish date = %q", got.LatestVersionPublishDate.String)
	}
	// current_version must NOT be backfilled when a real current exists.
	if got.CurrentVersion.String != "1.0" {
		t.Errorf("current_version overwritten: %q", got.CurrentVersion.String)
	}
}

func TestCheckAllTrackedAppsAbortsOnRateLimit(t *testing.T) {
	svc := newTrackedTestService(t)
	hubTagsServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
	})
	insertTrackedApp(t, svc.DB, map[string]any{"name": "a", "image_name": "nginx"})

	checked, updated, err := svc.CheckAllTrackedApps(context.Background(), 1)
	if !errors.Is(err, ErrRateLimited) {
		t.Fatalf("want ErrRateLimited, got %v", err)
	}
	if checked != 0 || updated != 0 {
		t.Errorf("checked=%d updated=%d", checked, updated)
	}
}

// ---------- GitHub flow ----------

func githubServer(t *testing.T, handler http.HandlerFunc) {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	old := githubAPIBase
	githubAPIBase = srv.URL
	t.Cleanup(func() { githubAPIBase = old })
}

func TestCheckGitHubTrackedAppUpdate(t *testing.T) {
	svc := newTrackedTestService(t)
	githubServer(t, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/repos/owner/repo/releases/latest":
			json.NewEncoder(w).Encode(map[string]any{
				"tag_name": "2.0", "published_at": "2026-02-02T00:00:00Z",
				"html_url": "https://github.com/owner/repo/releases/tag/2.0",
			})
		case "/repos/owner/repo/releases":
			json.NewEncoder(w).Encode([]map[string]any{
				{"tag_name": "2.0", "published_at": "2026-02-02T00:00:00Z"},
				{"tag_name": "1.0", "published_at": "2026-01-01T00:00:00Z"},
			})
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})

	app := insertTrackedApp(t, svc.DB, map[string]any{
		"name": "gh", "github_repo": "owner/repo", "source_type": "github",
		"current_version": "1.0",
	})

	res, err := svc.CheckTrackedApp(context.Background(), app)
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if !res.HasUpdate || res.LatestVersion != "2.0" || res.CurrentVersion != "1.0" {
		t.Errorf("res = %+v", res)
	}
	if res.CurrentVersionPublishDate == nil || *res.CurrentVersionPublishDate != "2026-01-01T00:00:00Z" {
		t.Errorf("current publish date = %v", res.CurrentVersionPublishDate)
	}

	got, _ := db.GetTrackedAppByID(context.Background(), svc.DB, app.ID, 1)
	if got.HasUpdate != 1 || got.LatestVersion.String != "2.0" {
		t.Errorf("db: has_update=%d latest=%q", got.HasUpdate, got.LatestVersion.String)
	}
	if got.LatestVersionPublishDate.String != "2026-02-02T00:00:00Z" {
		t.Errorf("latest publish date = %q", got.LatestVersionPublishDate.String)
	}
}

func TestCheckGitHubTrackedAppNotFoundKeepsLatest(t *testing.T) {
	svc := newTrackedTestService(t)
	githubServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	})

	app := insertTrackedApp(t, svc.DB, map[string]any{
		"name": "gh404", "github_repo": "owner/repo", "source_type": "github",
		"current_version": "1.0", "latest_version": "keep-me", "has_update": 1,
	})

	res, err := svc.CheckTrackedApp(context.Background(), app)
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if res.HasUpdate {
		t.Error("404 must not report an update")
	}
	got, _ := db.GetTrackedAppByID(context.Background(), svc.DB, app.ID, 1)
	if got.LatestVersion.String != "keep-me" {
		t.Errorf("github path must never clear latest_version, got %q", got.LatestVersion.String)
	}
	if got.HasUpdate != 0 {
		t.Errorf("has_update should reset to 0, got %d", got.HasUpdate)
	}
}

// A failed upstream lookup is not an observation. An expired or missing token
// (401) must leave a confirmed update exactly as it was, in the row and in the
// reported result.
func TestCheckGitHubTrackedAppAuthFailureKeepsUpdate(t *testing.T) {
	svc := newTrackedTestService(t)
	githubServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	})

	app := insertTrackedApp(t, svc.DB, map[string]any{
		"name": "gh401", "github_repo": "owner/repo", "source_type": "github",
		"current_version": "1.0", "latest_version": "2.0", "has_update": 1,
	})

	res, err := svc.CheckTrackedApp(context.Background(), app)
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if !res.HasUpdate {
		t.Error("a failed lookup must not report that the update is gone")
	}
	got, _ := db.GetTrackedAppByID(context.Background(), svc.DB, app.ID, 1)
	if got.HasUpdate != 1 || got.LatestVersion.String != "2.0" {
		t.Errorf("db: has_update=%d latest=%q", got.HasUpdate, got.LatestVersion.String)
	}
}

// A GitHub rate limit (403) aborts the check without touching the row.
func TestCheckGitHubTrackedAppRateLimitDoesNotWrite(t *testing.T) {
	svc := newTrackedTestService(t)
	githubServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	})

	app := insertTrackedApp(t, svc.DB, map[string]any{
		"name": "gh403", "github_repo": "owner/repo", "source_type": "github",
		"current_version": "1.0", "latest_version": "2.0", "has_update": 1,
	})

	if _, err := svc.CheckTrackedApp(context.Background(), app); err == nil {
		t.Fatal("a GitHub rate limit must surface as an error")
	}
	got, _ := db.GetTrackedAppByID(context.Background(), svc.DB, app.ID, 1)
	if got.HasUpdate != 1 || got.LatestVersion.String != "2.0" {
		t.Errorf("db: has_update=%d latest=%q", got.HasUpdate, got.LatestVersion.String)
	}
}

// GitLab reports "no releases" as 200 + [], so every non-200 (here a rejected
// token) is a failed lookup and must not erase the confirmed update.
func TestCheckGitLabTrackedAppTokenRejectedKeepsUpdate(t *testing.T) {
	svc := newTrackedTestService(t)
	gitlabServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	})

	app := insertTrackedApp(t, svc.DB, map[string]any{
		"name": "gl401", "github_repo": "group/proj", "source_type": "gitlab",
		"current_version": "3.0", "latest_version": "3.1", "has_update": 1,
	})

	res, err := svc.CheckTrackedApp(context.Background(), app)
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if !res.HasUpdate {
		t.Error("a rejected token must not report that the update is gone")
	}
	got, _ := db.GetTrackedAppByID(context.Background(), svc.DB, app.ID, 1)
	if got.HasUpdate != 1 || got.LatestVersion.String != "3.1" {
		t.Errorf("db: has_update=%d latest=%q", got.HasUpdate, got.LatestVersion.String)
	}
}

// Negative cache must short-circuit repeat lookups: second call issues zero
// HTTP requests (approved fix over Node's dead falsy-cache check).
func TestFindReleaseByTagNegativeCache(t *testing.T) {
	newTrackedTestService(t) // resets release cache + seams
	var hits int
	githubServer(t, func(w http.ResponseWriter, r *http.Request) {
		hits++
		if r.URL.Path == "/repos/owner/repo/releases" {
			json.NewEncoder(w).Encode([]any{})
			return
		}
		w.WriteHeader(http.StatusNotFound)
	})

	ctx := context.Background()
	rel, err := ghFindReleaseByTag(ctx, "owner/repo", "1.0")
	if err != nil || rel != nil {
		t.Fatalf("first lookup = %v, %v", rel, err)
	}
	first := hits
	if first == 0 {
		t.Fatal("first lookup issued no requests")
	}

	rel, err = ghFindReleaseByTag(ctx, "owner/repo", "1.0")
	if err != nil || rel != nil {
		t.Fatalf("second lookup = %v, %v", rel, err)
	}
	if hits != first {
		t.Errorf("repeat lookup issued %d extra requests, want 0", hits-first)
	}
}

// Delivery must survive caller cancellation (Node's queueNotification is
// fire-and-forget): a cancelled sync-mutation ctx must not strand a
// notification whose update state is already persisted.
type recordingRoundTripper struct{ hits int }

func (rt *recordingRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	rt.hits++
	return &http.Response{
		StatusCode: http.StatusNoContent,
		Body:       io.NopCloser(strings.NewReader("")),
		Request:    req,
	}, nil
}

func TestTrackedNotificationSurvivesCancel(t *testing.T) {
	svc := newTrackedTestService(t)
	rt := &recordingRoundTripper{}
	webhookTransport = rt
	t.Cleanup(func() { webhookTransport = nil })

	if _, err := svc.notifier.db.Exec(
		"INSERT INTO discord_webhooks (user_id, webhook_url, enabled) VALUES (1, ?, 1)",
		"https://discord.com/api/webhooks/123456789/AbC-_9xY"); err != nil {
		t.Fatalf("seed webhook: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // client already gone when the check finishes

	svc.notifier.queueTrackedNotification(ctx, trackedNotification{
		Name: "app", ImageName: "img", SourceType: "docker", LatestVersion: "2.0",
	}, 1)

	if rt.hits != 1 {
		t.Fatalf("delivery after ctx cancel: got %d webhook posts, want 1", rt.hits)
	}
}

// ---------- GitLab flow ----------

func gitlabServer(t *testing.T, handler http.HandlerFunc) {
	t.Helper()
	srv := httptest.NewServer(handler)
	t.Cleanup(srv.Close)
	old := gitlabComBase
	gitlabComBase = srv.URL
	t.Cleanup(func() { gitlabComBase = old })
}

func TestCheckGitLabTrackedAppUpdate(t *testing.T) {
	svc := newTrackedTestService(t)
	gitlabServer(t, func(w http.ResponseWriter, r *http.Request) {
		// r.URL.Path is percent-decoded: %2F arrives as "/".
		if r.URL.Path == "/api/v4/projects/group/proj/releases" {
			json.NewEncoder(w).Encode([]map[string]any{
				{"tag_name": "3.1", "name": "Release 3.1", "released_at": "2026-03-03T00:00:00Z",
					"_links": map[string]string{"self": "https://gitlab.com/group/proj/-/releases/3.1"}},
			})
			return
		}
		w.WriteHeader(http.StatusNotFound)
	})

	app := insertTrackedApp(t, svc.DB, map[string]any{
		"name": "gl", "github_repo": "group/proj", "source_type": "gitlab",
		"current_version": "3.0",
	})

	res, err := svc.CheckTrackedApp(context.Background(), app)
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if !res.HasUpdate || res.LatestVersion != "3.1" {
		t.Errorf("res = %+v", res)
	}
	got, _ := db.GetTrackedAppByID(context.Background(), svc.DB, app.ID, 1)
	if got.HasUpdate != 1 || got.LatestVersion.String != "3.1" {
		t.Errorf("db: has_update=%d latest=%q", got.HasUpdate, got.LatestVersion.String)
	}
}

func TestCheckGitLabTrackedAppNoReleaseClearsLatest(t *testing.T) {
	svc := newTrackedTestService(t)
	gitlabServer(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode([]any{}) // empty releases
	})

	app := insertTrackedApp(t, svc.DB, map[string]any{
		"name": "gl-clear", "github_repo": "group/proj", "source_type": "gitlab",
		"current_version": "3.0", "latest_version": "stale",
	})

	if _, err := svc.CheckTrackedApp(context.Background(), app); err != nil {
		t.Fatalf("check: %v", err)
	}
	got, _ := db.GetTrackedAppByID(context.Background(), svc.DB, app.ID, 1)
	if got.LatestVersion.Valid {
		t.Errorf("gitlab path clears latest_version when no release and no update, got %q",
			got.LatestVersion.String)
	}
}

// ---------- batch lifecycle ----------

func TestTrackedBatchLifecycle(t *testing.T) {
	svc := newTrackedTestService(t)
	ctx := context.Background()

	runID, err := svc.TrackedAcquire(ctx, 1, true)
	if err != nil {
		t.Fatalf("acquire: %v", err)
	}
	if _, err := svc.TrackedAcquire(ctx, 1, true); err == nil {
		t.Error("second acquire must fail while running")
	}

	if err := svc.TrackedExecuteAndComplete(ctx, 1, runID); err != nil {
		t.Fatalf("execute: %v", err)
	}

	row, err := db.GetLatestBatchRunByJobType(ctx, svc.DB, 1, TrackedJobType)
	if err != nil || row == nil {
		t.Fatalf("load run: %v", err)
	}
	if row.Status != "completed" {
		t.Errorf("status = %q", row.Status)
	}

	// Guard released: a fresh acquire works.
	runID2, err := svc.TrackedAcquire(ctx, 1, false)
	if err != nil {
		t.Fatalf("re-acquire: %v", err)
	}
	_ = svc.TrackedExecuteAndComplete(ctx, 1, runID2)
}

func strPtr(s string) *string { return &s }

// ---------- GITLAB_TOKEN scoping ----------

func TestIsGitLabDotCom(t *testing.T) {
	for _, tc := range []struct {
		url  string
		want bool
	}{
		{"https://gitlab.com/api/v4/projects/x/releases", true},
		{"https://www.gitlab.com/x", true},
		{"https://gitlab.example.com/api/v4/x", false},
		{"http://127.0.0.1:8080/api/v4/x", false},
		{"https://gitlab.com.evil.tld/x", false},
		{"not a url", false},
	} {
		if got := isGitLabDotCom(tc.url); got != tc.want {
			t.Errorf("isGitLabDotCom(%q) = %v, want %v", tc.url, got, tc.want)
		}
	}
}

func TestGitLabEnvTokenNotSentToSelfHostedHosts(t *testing.T) {
	t.Setenv("GITLAB_TOKEN", "global-secret")
	var gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte("[]"))
	}))
	defer srv.Close()

	if _, _, err := gitlabGet(context.Background(), srv.URL+"/api/v4/projects/x/releases", ""); err != nil {
		t.Fatalf("gitlabGet: %v", err)
	}
	if gotAuth != "" {
		t.Errorf("global GITLAB_TOKEN leaked to self-hosted host: %q", gotAuth)
	}

	// Per-app repository tokens still work on any host.
	if _, _, err := gitlabGet(context.Background(), srv.URL+"/api/v4/projects/x/releases", "app-token"); err != nil {
		t.Fatalf("gitlabGet with app token: %v", err)
	}
	if gotAuth != "Bearer app-token" {
		t.Errorf("app token header = %q, want Bearer app-token", gotAuth)
	}
}

// Release caches must be scoped by the credential used: private-repo
// metadata cached under an app token must not be served to a later
// credentialless check (token removed) for the cache TTL.
func TestGitLabReleaseCacheScopedByToken(t *testing.T) {
	var hits int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		auth := r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		if auth == "Bearer tok-a" {
			_, _ = w.Write([]byte(`[{"tag_name":"2.0","name":"secret","released_at":"2026-01-01T00:00:00Z"}]`))
			return
		}
		_, _ = w.Write([]byte(`[{"tag_name":"1.0","name":"public","released_at":"2025-01-01T00:00:00Z"}]`))
	}))
	defer srv.Close()
	old := gitlabComBase
	gitlabComBase = srv.URL
	t.Cleanup(func() { gitlabComBase = old })

	repo := srv.URL + "/scoped/cache-token-scope"
	rel, err := glGetLatestRelease(context.Background(), repo, "tok-a")
	if err != nil || rel == nil || rel.TagName != "2.0" {
		t.Fatalf("authorized check: rel=%+v err=%v", rel, err)
	}
	// Same token: cache hit, no extra upstream call.
	rel, err = glGetLatestRelease(context.Background(), repo, "tok-a")
	if err != nil || rel == nil || rel.TagName != "2.0" || hits != 1 {
		t.Fatalf("cache hit expected: rel=%+v err=%v hits=%d", rel, err, hits)
	}
	// Credentialless check must NOT see the token-scoped private entry.
	rel, err = glGetLatestRelease(context.Background(), repo, "")
	if err != nil {
		t.Fatalf("anon check: %v", err)
	}
	if rel != nil && rel.TagName == "2.0" {
		t.Error("private release metadata leaked to credentialless check via cache")
	}
	if hits != 2 {
		t.Errorf("upstream hits = %d, want 2 (anon check must refetch)", hits)
	}
}
