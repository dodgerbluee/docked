package imagesync

import (
	"database/sql"
	"testing"

	"github.com/dockedapp/backend/internal/db"
)

func ns(s string) sql.NullString { return sql.NullString{String: s, Valid: true} }

func TestExtractImageInfo(t *testing.T) {
	tests := []struct {
		image string
		repo  string
		tag   string
	}{
		{"nginx", "nginx", "latest"},
		{"nginx:1.25", "nginx", "1.25"},
		{"ghcr.io/owner/repo:stable", "ghcr.io/owner/repo", "stable"},
		// Faithful to Node's naive split(":") with parts[0]/parts[1]:
		// registry ports mis-split there too.
		{"localhost:5000/myimage:v2", "localhost", "5000/myimage"},
	}
	for _, tc := range tests {
		repo, tag := extractImageInfo(tc.image)
		if repo != tc.repo || tag != tc.tag {
			t.Errorf("extractImageInfo(%q) = (%q, %q), want (%q, %q)", tc.image, repo, tag, tc.repo, tc.tag)
		}
	}
}

func TestDetectProvider(t *testing.T) {
	tests := map[string]string{
		"ghcr.io/owner/repo":           "ghcr",
		"registry.gitlab.com/g/r":      "gitlab",
		"gcr.io/proj/img":              "gcr",
		"lscr.io/linuxserver/heimdall": "dockerhub",
		"nginx":                        "dockerhub",
	}
	for repo, want := range tests {
		if got := detectProvider(repo); got != want {
			t.Errorf("detectProvider(%q) = %q, want %q", repo, got, want)
		}
	}
}

func TestGetCurrentDigest(t *testing.T) {
	// Config.Image with @sha256 wins.
	details := map[string]any{
		"Config": map[string]any{"Image": "nginx@sha256:abc123"},
	}
	got := getCurrentDigest(details, &db.DockerHubImageVersion{CurrentDigest: ns("sha256:stored")})
	if got == nil || *got != "sha256:abc123" {
		t.Errorf("getCurrentDigest = %v, want sha256:abc123", got)
	}

	// No @sha256 in inspect -> stored digest.
	details = map[string]any{"Config": map[string]any{"Image": "nginx:latest"}}
	got = getCurrentDigest(details, &db.DockerHubImageVersion{CurrentDigest: ns("sha256:stored")})
	if got == nil || *got != "sha256:stored" {
		t.Errorf("getCurrentDigest = %v, want sha256:stored", got)
	}

	// Neither -> nil.
	got = getCurrentDigest(details, nil)
	if got != nil {
		t.Errorf("getCurrentDigest = %v, want nil", got)
	}
}

func TestNormalizeImageName(t *testing.T) {
	tests := map[string]string{
		"Nginx:1.25":                     "nginx",
		"docker.io/library/nginx:latest": "library/nginx",
		"ghcr.io/Owner/Repo:v1":          "owner/repo",
		"lscr.io/linuxserver/heimdall":   "linuxserver/heimdall",
		"gcr.io/proj/img:tag":            "proj/img",
		"  JC21/App:latest  ":            "jc21/app",
	}
	for in, want := range tests {
		if got := normalizeImageName(in); got != want {
			t.Errorf("normalizeImageName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestCreateDedupKey(t *testing.T) {
	// Digest wins when present.
	key := createDedupKey(1, "nginx", "docker.io/library/nginx:latest", "abc123", "1.26")
	if key != "1:nginx:library/nginx:abc123" {
		t.Errorf("dedup key = %q", key)
	}
	// Empty digest falls back to normalized version.
	key = createDedupKey(1, "nginx", "nginx:latest", "  ", "V1.26")
	if key != "1:nginx:nginx:v1.26" {
		t.Errorf("dedup key = %q", key)
	}
	// "Unknown" version yields empty key segment.
	key = createDedupKey(1, "nginx", "nginx:latest", "", "Unknown")
	if key != "1:nginx:nginx:" {
		t.Errorf("dedup key = %q", key)
	}
}

func TestPrevKey(t *testing.T) {
	// JS template literals render null as "null".
	got := prevKey("nginx", sql.NullString{}, sql.NullInt64{})
	if got != "nginx-null-null" {
		t.Errorf("prevKey = %q, want nginx-null-null", got)
	}
	got = prevKey("nginx", ns("http://portainer:9000"), sql.NullInt64{Int64: 2, Valid: true})
	if got != "nginx-http://portainer:9000-2" {
		t.Errorf("prevKey = %q", got)
	}
}

// updateRow builds a ContainerRow that db.ContainerHasUpdate reports as true
// (github-releases provider with differing versions).
func updateRow(name string, latestDigest, latestVersion string) db.ContainerRow {
	return db.ContainerRow{
		ContainerName: name,
		Provider:      ns("github-releases"),
		ImageTag:      ns("1.0.0"),
		LatestVersion: ns(latestVersion),
		LatestDigest:  ns(latestDigest),
	}
}

func TestShouldNotify(t *testing.T) {
	c := updateRow("nginx", "abc", "1.26")

	// New container with update -> notify.
	notify, newly := shouldNotify(c, nil)
	if !notify || !newly {
		t.Errorf("new-with-update: got (%v,%v), want (true,true)", notify, newly)
	}

	// Previously no update, now update -> notify.
	prev := previousEntry{hasUpdate: false}
	notify, newly = shouldNotify(c, &prev)
	if !notify || !newly {
		t.Errorf("newly-had-update: got (%v,%v), want (true,true)", notify, newly)
	}

	// Both had update, digest changed -> notify.
	prev = previousEntry{hasUpdate: true, latestDigest: "zzz", latestVersion: "1.25"}
	notify, _ = shouldNotify(c, &prev)
	if !notify {
		t.Error("details changed: expected notify")
	}

	// Both had update, same details -> no notify.
	prev = previousEntry{hasUpdate: true, latestDigest: "abc", latestVersion: "1.26"}
	notify, _ = shouldNotify(c, &prev)
	if notify {
		t.Error("details unchanged: expected no notify")
	}

	// No current update -> never notify.
	cNoUpdate := db.ContainerRow{ContainerName: "nginx"}
	notify, _ = shouldNotify(cNoUpdate, nil)
	if notify {
		t.Error("no update: expected no notify")
	}
}

func TestHasUpdateDetailsChanged(t *testing.T) {
	c := updateRow("nginx", "sha256:ABC", "1.26")
	// Normalization: prefix + case-insensitive comparison.
	prev := previousEntry{hasUpdate: true, latestDigest: "abc", latestVersion: "1.26"}
	if hasUpdateDetailsChanged(prev, c) {
		t.Error("normalized digests equal: expected no change")
	}
	// One side empty -> not "changed" (Node requires both non-null).
	prev = previousEntry{hasUpdate: true, latestDigest: "", latestVersion: ""}
	if hasUpdateDetailsChanged(prev, c) {
		t.Error("empty previous values: expected no change")
	}
}

func TestFormatPublishDate(t *testing.T) {
	if got := formatPublishDate("2026-01-15T08:00:00Z"); got != "Jan 15, 2026" {
		t.Errorf("formatPublishDate = %q", got)
	}
	if got := formatPublishDate("not-a-date"); got != "not-a-date" {
		t.Errorf("formatPublishDate fallback = %q", got)
	}
}

func TestGetDockerHubRepoUrl(t *testing.T) {
	tests := map[string]string{
		"nginx:latest":                    "https://hub.docker.com/r/library/nginx",
		"jc21/nginx-proxy-manager:latest": "https://hub.docker.com/r/jc21/nginx-proxy-manager",
		"docker.io/library/nginx":         "https://hub.docker.com/r/library/nginx",
		"":                                "",
	}
	for in, want := range tests {
		if got := getDockerHubRepoUrl(in); got != want {
			t.Errorf("getDockerHubRepoUrl(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestValidateWebhookURL(t *testing.T) {
	good := "https://discord.com/api/webhooks/123456789/AbC-_9xY"
	safe, err := validateWebhookURL(good)
	if err != nil || safe != good {
		t.Errorf("validateWebhookURL(%q) = (%q, %v)", good, safe, err)
	}

	bad := []string{
		"https://evil.com/api/webhooks/123/abc",
		"https://discord.com/api/webhooks/abc/def",  // non-numeric id
		"https://discord.com/api/webhooks/123/inv!", // invalid token chars
		"https://discord.com/other/path",
		"http://discordapp.com/api/webhooks/1/a",
	}
	for _, u := range bad {
		if _, err := validateWebhookURL(u); err == nil {
			t.Errorf("validateWebhookURL(%q) should fail", u)
		}
	}

	// discordapp.com host is allowed.
	if _, err := validateWebhookURL("https://discordapp.com/api/webhooks/1/a"); err != nil {
		t.Errorf("discordapp.com should be allowed: %v", err)
	}
}
