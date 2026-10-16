package middleware

import (
	"net/http"
	"testing"
	"time"
)

func TestRateLimiterFixedWindow(t *testing.T) {
	l := NewRateLimiter(3, 50*time.Millisecond, 100)

	for i := 0; i < 3; i++ {
		if !l.Allow("1.2.3.4") {
			t.Fatalf("request %d should be allowed", i+1)
		}
	}
	if l.Allow("1.2.3.4") {
		t.Fatal("4th request within window must be refused")
	}
	// Different key is independent.
	if !l.Allow("5.6.7.8") {
		t.Fatal("other key must have its own budget")
	}
	time.Sleep(60 * time.Millisecond)
	if !l.Allow("1.2.3.4") {
		t.Fatal("window expiry must reset the budget")
	}
}

func TestRateLimiterBoundsKeys(t *testing.T) {
	l := NewRateLimiter(1, time.Hour, 2)
	if !l.Allow("a") || !l.Allow("b") {
		t.Fatal("first two keys must fit")
	}
	if l.Allow("c") {
		t.Fatal("new key beyond maxKeys must be refused (no unbounded growth)")
	}
	// Existing keys keep their (exhausted) slots.
	if l.Allow("a") {
		t.Fatal("exhausted key must stay exhausted")
	}
}

func TestClientKeyFromRequest(t *testing.T) {
	req, _ := http.NewRequest("GET", "http://x/graphql", nil)

	// No forwarding header: peer IP without the ephemeral port, so WS
	// upgrades from one client share a bucket.
	req.RemoteAddr = "203.0.113.7:54321"
	if got := ClientKeyFromRequest(req); got != "203.0.113.7" {
		t.Fatalf("peer key = %q, want 203.0.113.7", got)
	}

	// Rightmost XFF entry wins: everything to its left is client-supplied
	// and spoofable.
	req.Header.Set("X-Forwarded-For", "1.2.3.4, 9.9.9.9, 203.0.113.10")
	if got := ClientKeyFromRequest(req); got != "203.0.113.10" {
		t.Fatalf("xff key = %q, want 203.0.113.10 (rightmost)", got)
	}

	// Single-entry XFF (what the Node proxy writes) is used directly.
	req.Header.Set("X-Forwarded-For", "203.0.113.11")
	if got := ClientKeyFromRequest(req); got != "203.0.113.11" {
		t.Fatalf("single-entry xff key = %q, want 203.0.113.11", got)
	}
}
