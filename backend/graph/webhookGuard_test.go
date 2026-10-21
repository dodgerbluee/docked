package graph

// Regression guards for the graph review findings: the Discord webhook
// test/info endpoints must share the notification SSRF guard (whitelisted
// Discord hosts + validated webhook path), maskURL must not panic on URLs
// between 11 and 19 bytes, and pageArgs must clamp negative cursors.

import (
	"testing"

	"github.com/dockedapp/backend/graph/model"
)

func TestDiscordWebhookHelpersRejectNonDiscordURLs(t *testing.T) {
	bad := []string{
		"http://127.0.0.1:8080/private",
		"http://localhost/graphql",
		"https://evil.example.com/api/webhooks/123/token",
		"https://discord.com.evil.example/api/webhooks/123/token",
		"https://evil.com/discord.com/api/webhooks/123/token",
		"https://discord.com/other/path",
		"https://discord.com/api/webhooks/notanid/token",
		"not a url",
	}
	for _, u := range bad {
		if code, _, err := discordWebhookGet(u); err == nil {
			t.Errorf("discordWebhookGet(%q) should fail validation (code=%d)", u, code)
		}
		if code, _, err := discordWebhookPost(u, map[string]any{"content": "x"}); err == nil {
			t.Errorf("discordWebhookPost(%q) should fail validation (code=%d)", u, code)
		}
	}
}

func TestMaskURLShortURLsDoNotPanic(t *testing.T) {
	for _, u := range []string{"1234567890", "12345678901", "https://discord.com", "https://discord.com/api/webhooks/1/tok"} {
		if got := maskURL(u); got == "" {
			t.Errorf("maskURL(%q) returned empty", u)
		}
	}
	if got := maskURL("1234567890"); got != "***" {
		t.Errorf("maskURL short = %q, want ***", got)
	}
}

func TestPageArgsClampsNegativeCursor(t *testing.T) {
	after := "-5"
	if _, offset := pageArgs(nil, &after, 100); offset != 0 {
		t.Errorf("negative after cursor: offset = %d, want 0", offset)
	}
	items := []*model.Container{{ID: "1"}, {ID: "2"}, {ID: "3"}}
	conn := paginateContainers(items, nil, &after)
	if len(conn.Items) != 3 {
		t.Errorf("paginateContainers with negative cursor: got %d items, want 3", len(conn.Items))
	}
}
