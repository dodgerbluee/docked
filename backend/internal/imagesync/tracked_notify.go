package imagesync

import (
	"context"
	"fmt"
	"log/slog"
	"net/url"
	"regexp"
	"time"

	"github.com/dockedapp/backend/internal/db"
)

// notificationTypeTrackedApp matches Node's discordService dedup type string.
const notificationTypeTrackedApp = "tracked-app"

const trackedEmbedTitle = "🆕 Tracked Application Update Available"

// trackedNotification mirrors the imageData object passed to Node's
// discordService.queueNotification from trackedAppService.
type trackedNotification struct {
	Name                     string
	ImageName                string // "" for github/gitlab sources
	GithubRepo               string
	SourceType               string // docker | github | gitlab
	CurrentVersion           string
	LatestVersion            string
	LatestDigest             *string
	LatestVersionPublishDate *string
	ReleaseURL               *string
	// Host qualifies a runner-reported app: the same application can be
	// installed on several runners, and without this the second one is
	// deduped against the first. Empty for user-scoped tracked apps, which
	// belong to no single host.
	Host string
}

// createTrackedImageKey ports createTrackedImageKey + extractNotificationValues:
// identifier = imageName || githubRepo || name; digest normalized.
func createTrackedImageKey(userID int64, d trackedNotification) string {
	identifier := d.ImageName
	if identifier == "" {
		identifier = d.GithubRepo
	}
	if identifier == "" {
		identifier = d.Name
	}
	digest := ""
	if d.LatestDigest != nil {
		digest = normalizedDigest(*d.LatestDigest)
	}
	key := digest
	if key == "" {
		key = d.LatestVersion
	}
	host := ""
	if d.Host != "" {
		host = "host:" + d.Host + ":"
	}
	return fmt.Sprintf("%d:%s%s:%s", userID, host, identifier, key)
}

var ghRepoRe = regexp.MustCompile(`^[a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+$`)
var ghVersionRe = regexp.MustCompile(`^[a-zA-Z0-9._-]+$`)

// formatTrackedAppNotification ports formatVersionUpdateNotification for the
// tracked-app shape (field order: Latest Version, Release Date, Source,
// Current Version).
func formatTrackedAppNotification(d trackedNotification) map[string]any {
	var sourceDisplay string
	switch {
	case d.SourceType == "github" && d.GithubRepo != "":
		if ghRepoRe.MatchString(d.GithubRepo) {
			sourceDisplay = fmt.Sprintf("[GitHub: %s](https://github.com/%s)", d.GithubRepo, d.GithubRepo)
		} else {
			sourceDisplay = "GitHub: " + d.GithubRepo
		}
	case d.SourceType == "github":
		sourceDisplay = "GitHub: Unknown"
	case d.SourceType == "gitlab":
		// The gitlab check carries its repository in the same field the github
		// check uses, so without this branch a GitLab app was announced with a
		// "Docker: Unknown" source.
		if d.GithubRepo == "" {
			sourceDisplay = "GitLab: Unknown"
		} else {
			sourceDisplay = "GitLab: " + d.GithubRepo
		}
	default:
		imageDisplay := d.ImageName
		if imageDisplay == "" {
			imageDisplay = "Unknown"
		}
		if u := getDockerHubRepoUrl(d.ImageName); u != "" {
			sourceDisplay = fmt.Sprintf("[Docker: %s](%s)", imageDisplay, u)
		} else {
			sourceDisplay = "Docker: " + imageDisplay
		}
	}

	latestDisplay := d.LatestVersion
	if latestDisplay == "" {
		latestDisplay = "Unknown"
	}
	currentDisplay := d.CurrentVersion
	if currentDisplay == "" {
		currentDisplay = "Unknown"
	}

	// GitHub: hyperlink the latest version to the release page.
	// GitHub is the only source whose release page is reachable at a known
	// host, so it is pinned to github.com; GitLab installs are commonly
	// self-hosted, so any https host is accepted there.
	if (d.SourceType == "github" || d.SourceType == "gitlab") && d.ReleaseURL != nil && *d.ReleaseURL != "" && d.LatestVersion != "" {
		ru := *d.ReleaseURL
		if u, err := url.Parse(ru); err == nil && u.Scheme == "https" &&
			(d.SourceType == "gitlab" || u.Hostname() == "github.com") {
			latestDisplay = fmt.Sprintf("[%s](%s)", d.LatestVersion, ru)
		}
	}

	if d.SourceType == "github" && d.GithubRepo != "" && d.LatestVersion != "" && latestDisplay == d.LatestVersion {
		if ghRepoRe.MatchString(d.GithubRepo) && ghVersionRe.MatchString(d.LatestVersion) {
			latestDisplay = fmt.Sprintf("[%s](https://github.com/%s/releases/tag/%s)",
				d.LatestVersion, d.GithubRepo, d.LatestVersion)
		}
	}

	fields := []map[string]any{
		{"name": "Latest Version", "value": latestDisplay, "inline": true},
	}
	if d.LatestVersionPublishDate != nil && *d.LatestVersionPublishDate != "" {
		fields = append(fields, map[string]any{
			"name": "Release Date", "value": formatPublishDate(*d.LatestVersionPublishDate), "inline": true,
		})
	}
	fields = append(fields,
		map[string]any{"name": "Source", "value": sourceDisplay, "inline": false},
		map[string]any{"name": "Current Version", "value": currentDisplay, "inline": false},
	)

	return map[string]any{
		"embeds": []any{map[string]any{
			"title":       trackedEmbedTitle,
			"description": fmt.Sprintf("A new version of **%s** is now available!", d.Name),
			"color":       notificationColor,
			"fields":      fields,
			"timestamp":   time.Now().UTC().Format(time.RFC3339),
			"footer":      map[string]string{"text": "Docked System"},
		}},
	}
}

// queueTrackedNotification ports queueNotification for the tracked-app half:
// webhook lookup, dedup (in-memory + DB), format once, deliver sequentially.
// Delivery runs on a detached context: Node's queueNotification is
// fire-and-forget, so a client disconnecting from the sync check mutations
// must not strand notifications whose update state is already persisted.
func (n *notifier) queueTrackedNotification(ctx context.Context, d trackedNotification, userID int64) {
	ctx = context.WithoutCancel(ctx)

	webhooks, err := db.GetEnabledDiscordWebhooks(ctx, n.db, userID)
	if err != nil || len(webhooks) == 0 {
		if err != nil {
			slog.Debug("error loading discord webhooks", "error", err)
		}
		return
	}

	dedupKey := createTrackedImageKey(userID, d)
	if n.isDuplicate(ctx, dedupKey, userID) {
		slog.Debug("skipping duplicate tracked-app notification", "name", d.Name, "key", dedupKey)
		return
	}

	payload := formatTrackedAppNotification(d)

	for _, webhook := range webhooks {
		if err := sendWithRetry(ctx, webhook.WebhookURL, payload); err != nil {
			n.forget(dedupKey)
			slog.Error("failed to send tracked-app notification", "name", d.Name, "error", err)
		} else {
			n.recordNotification(ctx, dedupKey, userID, notificationTypeTrackedApp)
			slog.Info("tracked-app discord notification sent", "name", d.Name)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(notificationDelay):
		}
	}
}
