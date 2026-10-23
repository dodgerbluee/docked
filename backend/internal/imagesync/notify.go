package imagesync

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/dockedapp/backend/internal/db"
)

const (
	maxSendRetries                     = 3
	dedupWindow                        = 365 * 24 * time.Hour // version-based keys only
	notificationDelay                  = 100 * time.Millisecond
	notificationColor                  = 23196 // Dodger Blue (#005A9C)
	containerEmbedTitle                = "New Container Update Available 🫙"
	notificationTypePortainerContainer = "portainer-container"
)

// notifier ports the container-update subset of discordService: dedup
// (in-memory + discord_notifications_sent), embed formatting, and webhook
// delivery with retry.
type notifier struct {
	db     *sql.DB
	mu     sync.Mutex
	recent map[string]int64 // dedupKey -> recorded-at unix ms
}

func newNotifier(database *sql.DB) *notifier {
	return &notifier{db: database, recent: make(map[string]int64)}
}

// normalizedDigest strips the sha256: prefix and lowercases (Node's
// normalizeDigest in containerNotificationService).
func normalizedDigest(digest string) string {
	if digest == "" {
		return ""
	}
	return strings.ToLower(strings.TrimPrefix(strings.ToLower(digest), "sha256:"))
}

// jsNull renders a nullable string the way JS template literals render null.
func jsNull(s sql.NullString) string {
	if !s.Valid || s.String == "" {
		return "null"
	}
	return s.String
}

func jsNullInt(i sql.NullInt64) string {
	if !i.Valid {
		return "null"
	}
	return strconv.FormatInt(i.Int64, 10)
}

// prevKey identifies a container across two scans. The runner is part of the
// key: with only name + source url + endpoint, every runner-backed row
// collapses to "name--" and two runners hosting a container of the same name
// overwrite each other in the previous-scan map, so the second one's update is
// never detected.
func prevKey(name string, sourceURL sql.NullString, endpointID, runnerID sql.NullInt64) string {
	return fmt.Sprintf("%s-%s-%s-%s", name, jsNull(sourceURL), jsNullInt(endpointID), jsNullInt(runnerID))
}

// previousEntry is the normalized snapshot of a pre-scan container row.
type previousEntry struct {
	hasUpdate     bool
	latestDigest  string // normalized
	latestVersion string
}

func buildPreviousMap(previous []db.ContainerRow) map[string]previousEntry {
	m := make(map[string]previousEntry, len(previous))
	for _, row := range previous {
		version := ""
		if row.LatestVersion.Valid && row.LatestVersion.String != "" {
			version = row.LatestVersion.String
		} else if row.LatestTag.Valid && row.LatestTag.String != "" {
			version = row.LatestTag.String
		}
		m[prevKey(row.ContainerName, row.SourceURL, row.EndpointID, row.RunnerID)] = previousEntry{
			hasUpdate:     db.ContainerHasUpdate(row),
			latestDigest:  normalizedDigest(row.LatestDigest.String),
			latestVersion: version,
		}
	}
	return m
}

// hasUpdateDetailsChanged ports hasUpdateDetailsChanged.
func hasUpdateDetailsChanged(prev previousEntry, c db.ContainerRow) bool {
	currentDigest := normalizedDigest(c.LatestDigest.String)

	var currentVersion string
	if c.LatestVersion.Valid && c.LatestVersion.String != "" {
		currentVersion = c.LatestVersion.String
	} else if c.LatestTag.Valid && c.LatestTag.String != "" {
		currentVersion = c.LatestTag.String
	}

	digestChanged := currentDigest != "" && prev.latestDigest != "" && currentDigest != prev.latestDigest
	versionChanged := currentVersion != "" && prev.latestVersion != "" && currentVersion != prev.latestVersion
	return digestChanged || versionChanged
}

// shouldNotify ports shouldNotifyContainerUpdate.
func shouldNotify(c db.ContainerRow, prev *previousEntry) (notify bool, newlyIdentified bool) {
	currentHasUpdate := db.ContainerHasUpdate(c)
	if prev == nil {
		return currentHasUpdate, currentHasUpdate
	}
	if !prev.hasUpdate && currentHasUpdate {
		return true, true
	}
	if prev.hasUpdate && currentHasUpdate {
		if hasUpdateDetailsChanged(*prev, c) {
			return true, true
		}
	}
	return false, false
}

// SendContainerUpdateNotifications ports sendContainerUpdateNotifications.
func (n *notifier) SendContainerUpdateNotifications(ctx context.Context, current, previous []db.ContainerRow, userID int64) {
	if len(previous) == 0 {
		return
	}

	defer func() {
		if r := recover(); r != nil {
			slog.Error("panic sending discord notifications", "error", r)
		}
	}()

	prevMap := buildPreviousMap(previous)

	for _, c := range current {
		if !db.ContainerHasUpdate(c) {
			continue
		}
		key := prevKey(c.ContainerName, c.SourceURL, c.EndpointID, c.RunnerID)
		prev, ok := prevMap[key]
		if !ok {
			slog.Debug("previous container not found for key", "key", key, "container", c.ContainerName)
		}

		notify, newly := shouldNotify(c, nilIfZero(prev, ok))
		if newly {
			slog.Info("newly identified upgrade detected",
				"container", c.ContainerName, "image", jsNull(c.ImageName),
				"currentVersion", jsNull(c.ImageTag), "latestVersion", jsNull(c.LatestTag))
		}
		if notify {
			n.queueNotification(ctx, c, userID)
		}
	}
}

func nilIfZero(p previousEntry, ok bool) *previousEntry {
	if !ok {
		return nil
	}
	return &p
}

// normalizeImageName ports discordService.normalizeImageName.
func normalizeImageName(imageName string) string {
	normalized := strings.ToLower(strings.TrimSpace(imageName))
	if i := strings.Index(normalized, ":"); i >= 0 {
		normalized = normalized[:i]
	}
	for _, prefix := range []string{
		"docker.io/", "registry-1.docker.io/", "ghcr.io/",
		"lscr.io/", "registry.gitlab.com/", "gcr.io/",
	} {
		normalized = strings.TrimPrefix(normalized, prefix)
	}
	return normalized
}

// createDedupKey ports createPortainerContainerKey. The host is part of the
// key: two runners can each host a container with the same name and the same
// image, and without the host the second one is silently deduped away.
func createDedupKey(userID int64, containerName, imageName, latestDigest, latestVersion string, runnerID sql.NullInt64) string {
	normalizedImage := normalizeImageName(imageName)
	normalizedVersion := ""
	if latestVersion != "" && latestVersion != "Unknown" {
		normalizedVersion = strings.ToLower(strings.TrimSpace(latestVersion))
	}
	key := latestDigest
	if strings.TrimSpace(key) == "" {
		key = normalizedVersion
	}
	host := "src:" + jsNullInt(runnerID)
	return fmt.Sprintf("%d:%s:%s:%s:%s", userID, host, containerName, normalizedImage, key)
}

var shaKeyRe = regexp.MustCompile(`:[a-f0-9]{64}$`)

// isDuplicate ports isDuplicate: in-memory check (SHA keys never expire),
// immediate in-memory record, then DB check.
func (n *notifier) isDuplicate(ctx context.Context, key string, userID int64) bool {
	n.mu.Lock()
	if ts, ok := n.recent[key]; ok {
		if shaKeyRe.MatchString(key) {
			n.mu.Unlock()
			return true
		}
		if time.Since(time.UnixMilli(ts)) < dedupWindow {
			n.mu.Unlock()
			return true
		}
		delete(n.recent, key)
	}
	n.recent[key] = time.Now().UnixMilli()
	if len(n.recent) > 1000 {
		n.cleanupExpiredLocked()
	}
	n.mu.Unlock()

	sent, err := db.HasDiscordNotificationBeenSent(ctx, n.db, userID, key)
	if err != nil {
		slog.Warn("error checking database for duplicate notification", "error", err)
		return false
	}
	return sent
}

func (n *notifier) cleanupExpiredLocked() {
	now := time.Now()
	for k, ts := range n.recent {
		if !shaKeyRe.MatchString(k) && now.Sub(time.UnixMilli(ts)) >= dedupWindow {
			delete(n.recent, k)
		}
	}
}

func (n *notifier) recordNotification(ctx context.Context, key string, userID int64, notificationType string) {
	n.mu.Lock()
	n.recent[key] = time.Now().UnixMilli()
	n.mu.Unlock()

	if err := db.RecordDiscordNotificationSent(ctx, n.db, userID, key, notificationType); err != nil {
		slog.Warn("error recording notification to database", "error", err)
	}
}

func (n *notifier) forget(key string) {
	n.mu.Lock()
	delete(n.recent, key)
	n.mu.Unlock()
}

// queueNotification ports queueNotification + processNotificationQueue for
// the container-update path: dedup, format once, deliver to each enabled
// webhook sequentially.
func (n *notifier) queueNotification(ctx context.Context, c db.ContainerRow, userID int64) {
	webhooks, err := db.GetEnabledDiscordWebhooks(ctx, n.db, userID)
	if err != nil || len(webhooks) == 0 {
		if err != nil {
			slog.Debug("error loading discord webhooks", "error", err)
		}
		return
	}

	imageName := jsNullOr(c.ImageName, "Unknown")
	currentVersion := jsNullOr(c.ImageTag, "Unknown")
	latestVersion := "Unknown"
	if c.LatestTag.Valid && c.LatestTag.String != "" {
		latestVersion = c.LatestTag.String
	} else if c.LatestVersion.Valid && c.LatestVersion.String != "" {
		latestVersion = c.LatestVersion.String
	}
	rawDigest := normalizedDigest(c.LatestDigest.String)

	dedupKey := createDedupKey(userID, c.ContainerName, imageName, rawDigest, latestVersion, c.RunnerID)
	if n.isDuplicate(ctx, dedupKey, userID) {
		slog.Debug("skipping duplicate discord notification", "container", c.ContainerName, "key", dedupKey)
		return
	}

	var publishDate *string
	if c.LatestPublishDate.Valid && c.LatestPublishDate.String != "" {
		pd := c.LatestPublishDate.String
		publishDate = &pd
	}
	payload := formatVersionUpdateNotification(c.ContainerName, imageName, currentVersion, latestVersion, publishDate)

	for _, webhook := range webhooks {
		result := sendWithRetry(ctx, webhook.WebhookURL, payload)
		if result == nil {
			n.recordNotification(ctx, dedupKey, userID, notificationTypePortainerContainer)
			slog.Info("discord notification sent", "container", c.ContainerName)
		} else {
			n.forget(dedupKey)
			slog.Error("failed to send discord notification", "container", c.ContainerName, "error", result)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(notificationDelay):
		}
	}
}

func jsNullOr(s sql.NullString, fallback string) string {
	if !s.Valid || s.String == "" {
		return fallback
	}
	return s.String
}

// getDockerHubRepoUrl ports getDockerHubRepoUrl.
func getDockerHubRepoUrl(imageName string) string {
	if imageName == "" {
		return ""
	}
	repo := imageName
	if i := strings.Index(repo, ":"); i >= 0 {
		repo = repo[:i]
	}
	for _, prefix := range []string{"docker.io/", "registry-1.docker.io/"} {
		repo = strings.TrimPrefix(repo, prefix)
	}
	if strings.Contains(repo, "/") {
		return "https://hub.docker.com/r/" + repo
	}
	return "https://hub.docker.com/r/library/" + repo
}

// formatVersionUpdateNotification ports formatVersionUpdateNotification for
// the portainer-container shape.
func formatVersionUpdateNotification(name, imageName, currentVersion, latestVersion string, publishDate *string) map[string]any {
	sourceDisplay := "Docker: " + imageName
	if u := getDockerHubRepoUrl(imageName); u != "" {
		sourceDisplay = fmt.Sprintf("[Docker: %s](%s)", imageName, u)
	}

	fields := []map[string]any{
		{"name": "Source", "value": sourceDisplay, "inline": false},
	}
	if publishDate != nil {
		fields = append(fields, map[string]any{
			"name": "Release Date", "value": formatPublishDate(*publishDate), "inline": true,
		})
	}

	return map[string]any{
		"embeds": []any{map[string]any{
			"title":       containerEmbedTitle,
			"description": fmt.Sprintf("A new version of **%s** is now available!", name),
			"color":       notificationColor,
			"fields":      fields,
			"timestamp":   time.Now().UTC().Format(time.RFC3339),
			"footer":      map[string]string{"text": "Docked System"},
		}},
	}
}

// formatPublishDate ports the en-US {year numeric, month short, day numeric}
// formatting, falling back to the raw value on parse failure.
func formatPublishDate(raw string) string {
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02T15:04:05", "2006-01-02"} {
		if t, err := time.Parse(layout, raw); err == nil {
			return t.Format("Jan 2, 2006")
		}
	}
	return raw
}

var webhookPathRe = regexp.MustCompile(`^/api/webhooks/(\d+)/([A-Za-z0-9_-]+)$`)

// ValidateWebhookURL ports the URL validation + reconstruction in
// sendNotificationWithRetry (SSRF guard: whitelisted host + validated parts).
// Exported so the graph's webhook test/info endpoints share the guard.
func ValidateWebhookURL(webhookURL string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(webhookURL))
	if err != nil {
		return "", fmt.Errorf("invalid webhook URL format")
	}
	if u.Scheme != "https" {
		return "", fmt.Errorf("invalid webhook URL format")
	}
	host := strings.ToLower(u.Hostname())
	if host != "discord.com" && host != "discordapp.com" {
		return "", fmt.Errorf("invalid webhook URL hostname")
	}
	m := webhookPathRe.FindStringSubmatch(u.Path)
	if m == nil {
		return "", fmt.Errorf("invalid webhook URL path format")
	}
	return fmt.Sprintf("https://%s/api/webhooks/%s/%s", host, m[1], m[2]), nil
}

// sendWithRetry ports sendNotificationWithRetry: 4 attempts total, 429 waits
// retry-after, other 4xx fail fast, 5xx/network retry with backoff.
// webhookTransport is a test seam for the discord delivery client
// (nil = http.DefaultTransport).
var webhookTransport http.RoundTripper

func sendWithRetry(ctx context.Context, webhookURL string, payload map[string]any) error {
	safeURL, err := ValidateWebhookURL(webhookURL)
	if err != nil {
		return err
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	client := &http.Client{Timeout: 15 * time.Second, Transport: webhookTransport}
	for attempt := 0; attempt <= maxSendRetries; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, safeURL, bytes.NewReader(body))
		if err != nil {
			return err
		}
		req.Header.Set("Content-Type", "application/json")

		resp, err := client.Do(req)
		if err != nil {
			if attempt < maxSendRetries {
				time.Sleep(time.Duration(1<<uint(attempt)) * time.Second)
				continue
			}
			return fmt.Errorf("network error: %w", err)
		}

		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
		resp.Body.Close()

		if resp.StatusCode == http.StatusTooManyRequests {
			retryAfter, _ := strconv.Atoi(resp.Header.Get("Retry-After"))
			if retryAfter <= 0 {
				retryAfter = 60
			}
			slog.Warn("discord rate limit hit", "waitSeconds", retryAfter)
			if attempt < maxSendRetries {
				select {
				case <-ctx.Done():
					return ctx.Err()
				case <-time.After(time.Duration(retryAfter) * time.Second):
				}
				continue
			}
			return fmt.Errorf("rate limited and max retries exceeded")
		}

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return nil
		}

		errMsg := fmt.Sprintf("HTTP %d: %s", resp.StatusCode, string(respBody))
		if resp.StatusCode >= 400 && resp.StatusCode < 500 {
			return fmt.Errorf("%s", errMsg)
		}

		if attempt < maxSendRetries {
			time.Sleep(time.Duration(1<<uint(attempt)) * time.Second)
			continue
		}
		return fmt.Errorf("%s", errMsg)
	}
	return nil
}
