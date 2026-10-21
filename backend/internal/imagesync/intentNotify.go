// Intent execution Discord notification — port of discordService's
// sendIntentExecutionNotification / formatIntentExecutionNotification.
// Unlike container/tracked notifications, intent notifications are sent to
// the FIRST enabled webhook only and carry no dedup.
package imagesync

import (
	"context"
	"database/sql"
	"fmt"
	"log/slog"
	"math"
	"strings"
	"time"

	"github.com/dockedapp/backend/internal/db"
)

// IntentNotifyContainer is one per-container result line (Node's
// containerResults entry as consumed by buildContainerField).
type IntentNotifyContainer struct {
	ContainerName string
	Status        string // upgraded | failed | skipped | dry_run
	ImageName     string
	OldImage      *string
	NewImage      *string
	ErrorMessage  *string
}

// IntentExecutionNotify is the notification payload input (Node's
// sendIntentExecutionNotification arguments flattened into a struct).
type IntentExecutionNotify struct {
	IntentName         string
	Status             string // completed | partial | failed
	TriggerType        string
	DurationMs         int64
	ContainersMatched  int
	ContainersUpgraded int
	ContainersFailed   int
	ContainersSkipped  int
	ContainerResults   []IntentNotifyContainer
}

// intent notification embed colors (Node's colorMap).
const (
	intentColorCompleted = 3066993
	intentColorPartial   = 16776960
	intentColorDefault   = 15158332
)

// SendIntentExecutionNotification delivers the intent-complete embed to the
// user's first enabled webhook (Node parity: webhooks[0] only).
func SendIntentExecutionNotification(ctx context.Context, database *sql.DB, userID int64, data IntentExecutionNotify) {
	webhooks, err := db.GetEnabledDiscordWebhooks(ctx, database, userID)
	if err != nil || len(webhooks) == 0 {
		if err != nil {
			slog.Debug("error loading discord webhooks for intent notification", "error", err)
		}
		return
	}

	payload := formatIntentExecutionNotification(data)
	if err := sendWithRetry(ctx, webhooks[0].WebhookURL, payload); err != nil {
		slog.Error("failed to send intent notification", "intentName", data.IntentName, "error", err)
		return
	}
	slog.Info("intent execution notification sent", "intentName", data.IntentName, "status", data.Status)
}

// formatIntentExecutionNotification ports formatIntentExecutionNotification.
func formatIntentExecutionNotification(data IntentExecutionNotify) map[string]any {
	color := intentColorDefault
	switch data.Status {
	case "completed":
		color = intentColorCompleted
	case "partial":
		color = intentColorPartial
	}

	fields := []map[string]any{
		{"name": "Trigger", "value": data.TriggerType, "inline": true},
		{"name": "Status", "value": capitalizeFirst(data.Status), "inline": true},
		{"name": "Duration", "value": formatDurationSeconds(data.DurationMs), "inline": true},
		{
			"name": "Containers",
			"value": fmt.Sprintf("%d matched · %d upgraded · %d failed · %d skipped",
				data.ContainersMatched, data.ContainersUpgraded, data.ContainersFailed, data.ContainersSkipped),
			"inline": false,
		},
	}
	if f := buildContainerField(data.ContainerResults, "upgraded"); f != nil {
		fields = append(fields, *f)
	}
	if f := buildContainerField(data.ContainerResults, "failed"); f != nil {
		fields = append(fields, *f)
	}

	return map[string]any{
		"embeds": []any{map[string]any{
			"title":       "🤖 Intent Execution Complete",
			"description": fmt.Sprintf("Intent **%s** has finished executing.", data.IntentName),
			"color":       color,
			"fields":      fields,
			"timestamp":   time.Now().UTC().Format(time.RFC3339),
			"footer":      map[string]string{"text": "Docked System"},
		}},
	}
}

// buildContainerField ports buildContainerField: one embed field listing the
// upgraded or failed container lines, or nil when the filter matches nothing.
func buildContainerField(results []IntentNotifyContainer, filterStatus string) *map[string]any {
	var items []IntentNotifyContainer
	for _, c := range results {
		if c.Status == filterStatus {
			items = append(items, c)
		}
	}
	if len(items) == 0 {
		return nil
	}
	icon := "❌"
	if filterStatus == "upgraded" {
		icon = "✅"
	}

	lines := make([]string, 0, len(items))
	for _, c := range items {
		name := c.ContainerName
		if filterStatus == "upgraded" && c.OldImage != nil && c.NewImage != nil &&
			*c.OldImage != "" && *c.NewImage != "" && *c.OldImage != *c.NewImage {
			lines = append(lines, icon+" **"+name+"**\u2003"+*c.OldImage+" → "+*c.NewImage)
			continue
		}
		if filterStatus == "failed" {
			snippet := ""
			if c.ErrorMessage != nil && *c.ErrorMessage != "" {
				snippet = ": " + truncateRunes(*c.ErrorMessage, 80)
			}
			lines = append(lines, icon+" **"+name+"**"+snippet)
			continue
		}
		img := c.ImageName
		if img == "" {
			img = "unknown"
		}
		lines = append(lines, icon+" **"+name+"** ("+img+")")
	}

	label := capitalizeFirst(filterStatus)
	value := truncateFieldLines(lines)
	field := map[string]any{"name": fmt.Sprintf("%s (%d)", label, len(items)), "value": value, "inline": false}
	return &field
}

// truncateFieldLines ports truncateFieldLines: joins lines until maxLength
// (1024) minus a 30-char budget would be exceeded, then appends a
// "_...and N more_" line.
func truncateFieldLines(lines []string) string {
	const maxLength = 1024
	var kept []string
	current := 0
	for _, line := range lines {
		if current+len(line)+1 > maxLength-30 {
			remaining := len(lines) - len(kept)
			kept = append(kept, fmt.Sprintf("_...and %d more_", remaining))
			break
		}
		kept = append(kept, line)
		current += len(line) + 1
	}
	return strings.Join(kept, "\n")
}

// formatDurationSeconds ports `Math.round(ms/1000) + 's'`.
func formatDurationSeconds(ms int64) string {
	return fmt.Sprintf("%ds", int64(math.Round(float64(ms)/1000)))
}

func capitalizeFirst(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

// truncateRunes slices to max UTF-8 runes (JS slice counts UTF-16 units;
// rune-based is the safe approximation for error snippets).
func truncateRunes(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max])
}
