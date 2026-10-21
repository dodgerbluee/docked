package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
	"github.com/dockedapp/backend/internal/auth"
	"github.com/dockedapp/backend/internal/db"
)

// TestSubscriptionWSTransport verifies the graphql-ws handshake end to end:
// connection-init auth (reject + accept), a live subscription, and event
// delivery through the /internal/events bridge into the hub.
func TestSubscriptionWSTransport(t *testing.T) {
	env := newTestEnv(t, true)
	admin := env.token(t, env.adminID, "admin")

	wsURL := "ws" + strings.TrimPrefix(env.ts.URL, "http") + "/graphql"
	dialOpts := &websocket.DialOptions{Subprotocols: []string{"graphql-transport-ws"}}

	t.Run("invalid token rejected", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		c, _, err := websocket.Dial(ctx, wsURL, dialOpts)
		if err != nil {
			t.Fatalf("dial: %v", err)
		}
		defer c.CloseNow()
		init, _ := json.Marshal(map[string]any{
			"type":    "connection_init",
			"payload": map[string]any{"token": "not-a-jwt"},
		})
		if err := c.Write(ctx, websocket.MessageText, init); err != nil {
			t.Fatalf("write init: %v", err)
		}
		// Either a connection_error frame or a closed connection is acceptable;
		// a connection_ack is not.
		for {
			_, data, err := c.Read(ctx)
			if err != nil {
				return // closed: rejected
			}
			if bytes.Contains(data, []byte(`"connection_ack"`)) {
				t.Fatal("invalid token received connection_ack")
			}
			if bytes.Contains(data, []byte(`"connection_error"`)) || bytes.Contains(data, []byte(`"error"`)) {
				return
			}
		}
	})

	t.Run("subscription receives bridged event", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		c, _, err := websocket.Dial(ctx, wsURL, dialOpts)
		if err != nil {
			t.Fatalf("dial: %v", err)
		}
		defer c.CloseNow()

		init, _ := json.Marshal(map[string]any{
			"type":    "connection_init",
			"payload": map[string]any{"token": admin},
		})
		if err := c.Write(ctx, websocket.MessageText, init); err != nil {
			t.Fatalf("write init: %v", err)
		}
		_, data, err := c.Read(ctx)
		if err != nil || !bytes.Contains(data, []byte(`"connection_ack"`)) {
			t.Fatalf("expected connection_ack, got err=%v data=%s", err, data)
		}

		sub, _ := json.Marshal(map[string]any{
			"id":      "sub1",
			"type":    "subscribe",
			"payload": map[string]any{"query": "subscription { containersUpdated { sourceIds containerCount } }"},
		})
		if err := c.Write(ctx, websocket.MessageText, sub); err != nil {
			t.Fatalf("write subscribe: %v", err)
		}

		// Give the subscribe frame a moment to register before publishing
		// (otherwise the event races past an not-yet-subscribed hub).
		time.Sleep(500 * time.Millisecond)

		// Publish through the cross-process bridge (broadcast audience).
		body, _ := json.Marshal(map[string]any{
			"type":    "containersUpdated",
			"userId":  0,
			"payload": map[string]any{"sourceIds": []string{"7"}, "containerCount": 42},
		})
		req, _ := http.NewRequestWithContext(ctx, http.MethodPost,
			env.ts.URL+"/internal/events", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("X-Internal-Token", testSecret)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("bridge post: %v", err)
		}
		if resp.StatusCode != http.StatusNoContent {
			t.Fatalf("bridge post status: %d", resp.StatusCode)
		}
		resp.Body.Close()

		// Unauthenticated bridge calls must be rejected.
		req2, _ := http.NewRequestWithContext(ctx, http.MethodPost,
			env.ts.URL+"/internal/events", bytes.NewReader(body))
		resp2, err := http.DefaultClient.Do(req2)
		if err != nil {
			t.Fatalf("bridge post (no token): %v", err)
		}
		if resp2.StatusCode != http.StatusUnauthorized {
			t.Fatalf("unauthenticated bridge status: %d", resp2.StatusCode)
		}
		resp2.Body.Close()

		// The subscription must deliver the event.
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			_, data, err := c.Read(ctx)
			if err != nil {
				t.Fatalf("read next: %v", err)
			}
			if bytes.Contains(data, []byte(`"ka"`)) {
				continue // keep-alive
			}
			if bytes.Contains(data, []byte(`"next"`)) {
				if !bytes.Contains(data, []byte(`"containerCount":42`)) {
					t.Fatalf("unexpected payload: %s", data)
				}
				return
			}
			if bytes.Contains(data, []byte(`"error"`)) {
				t.Fatalf("subscription error frame: %s", data)
			}
		}
		t.Fatal("timed out waiting for subscription event")
	})

	// InitFunc only runs at handshake time; the AroundOperations guard must
	// re-validate the connection's token on every operation so a token
	// revoked (or expired) mid-connection cannot start new work.
	t.Run("revoked token rejected on live connection", func(t *testing.T) {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		c, _, err := websocket.Dial(ctx, wsURL, dialOpts)
		if err != nil {
			t.Fatalf("dial: %v", err)
		}
		defer c.CloseNow()

		init, _ := json.Marshal(map[string]any{
			"type":    "connection_init",
			"payload": map[string]any{"token": admin},
		})
		if err := c.Write(ctx, websocket.MessageText, init); err != nil {
			t.Fatalf("write init: %v", err)
		}
		_, data, err := c.Read(ctx)
		if err != nil || !bytes.Contains(data, []byte(`"connection_ack"`)) {
			t.Fatalf("expected connection_ack, got err=%v data=%s", err, data)
		}

		// A subscribe while the session is still valid must be accepted.
		subOK, _ := json.Marshal(map[string]any{
			"id":      "sub-ok",
			"type":    "subscribe",
			"payload": map[string]any{"query": "subscription { containersUpdated { sourceIds containerCount } }"},
		})
		if err := c.Write(ctx, websocket.MessageText, subOK); err != nil {
			t.Fatalf("write subscribe: %v", err)
		}

		// Revoke the connection's access token out from under it.
		uid, exp, err := auth.ValidateTokenClaims(admin, testSecret)
		if err != nil {
			t.Fatalf("validate claims: %v", err)
		}
		if err := db.RevokeToken(ctx, env.database, admin, uid, exp); err != nil {
			t.Fatalf("revoke: %v", err)
		}

		// A new operation on the same (still-open) connection must be rejected.
		subRevoked, _ := json.Marshal(map[string]any{
			"id":      "sub-revoked",
			"type":    "subscribe",
			"payload": map[string]any{"query": "subscription { containersUpdated { sourceIds containerCount } }"},
		})
		if err := c.Write(ctx, websocket.MessageText, subRevoked); err != nil {
			t.Fatalf("write subscribe (revoked): %v", err)
		}

		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			_, data, err := c.Read(ctx)
			if err != nil {
				t.Fatalf("read: %v", err)
			}
			if bytes.Contains(data, []byte(`"ka"`)) {
				continue // keep-alive
			}
			if bytes.Contains(data, []byte(`"sub-revoked"`)) {
				if !bytes.Contains(data, []byte(`"errors"`)) {
					t.Fatalf("revoked-session operation was not rejected: %s", data)
				}
				return
			}
		}
		t.Fatal("timed out waiting for rejection of revoked-session operation")
	})
}
