package middleware

import (
	"net"
	"net/http"
	"net/http/httptest"
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

	// Peer IP without the ephemeral port, so WS upgrades from one client
	// share a bucket.
	req.RemoteAddr = "203.0.113.7:54321"
	if got := ClientKeyFromRequest(req); got != "203.0.113.7" {
		t.Fatalf("peer key = %q, want 203.0.113.7", got)
	}

	// XFF is NOT consulted: RealIPFrom has already folded the trusted-proxy
	// view into RemoteAddr; anything left in the header is spoofable.
	req.Header.Set("X-Forwarded-For", "1.2.3.4, 9.9.9.9")
	if got := ClientKeyFromRequest(req); got != "203.0.113.7" {
		t.Fatalf("key = %q, want 203.0.113.7 (header must be ignored)", got)
	}

	// No-port form written by RealIPFrom (bracketed for IPv6) is unwrapped.
	req.RemoteAddr = "[2001:db8::5]:0"
	if got := ClientKeyFromRequest(req); got != "2001:db8::5" {
		t.Fatalf("ipv6 key = %q, want 2001:db8::5", got)
	}
}

func TestRealIPFrom(t *testing.T) {
	trusted := []*net.IPNet{
		{IP: net.ParseIP("127.0.0.0"), Mask: net.CIDRMask(8, 32)},
		{IP: net.ParseIP("10.10.0.0"), Mask: net.CIDRMask(16, 32)},
	}
	serve := func(remoteAddr, xff, realIP string) string {
		var got string
		h := RealIPFrom(trusted)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			got = r.RemoteAddr
		}))
		req, _ := http.NewRequest("GET", "http://x/graphql", nil)
		req.RemoteAddr = remoteAddr
		if xff != "" {
			req.Header.Set("X-Forwarded-For", xff)
		}
		if realIP != "" {
			req.Header.Set("X-Real-IP", realIP)
		}
		h.ServeHTTP(httptest.NewRecorder(), req)
		return got
	}

	// Trusted loopback proxy: rightmost XFF entry wins.
	if got := serve("127.0.0.1:4321", "1.2.3.4, 203.0.113.10", ""); got != "203.0.113.10:0" {
		t.Fatalf("trusted xff = %q, want 203.0.113.10:0", got)
	}
	// Trusted proxy, X-Real-IP fallback.
	if got := serve("10.10.1.2:1", "", "203.0.113.11"); got != "203.0.113.11:0" {
		t.Fatalf("trusted real-ip = %q, want 203.0.113.11:0", got)
	}
	// Untrusted internet peer: forged headers ignored, peer kept.
	if got := serve("198.51.100.9:443", "8.8.8.8", "9.9.9.9"); got != "198.51.100.9:443" {
		t.Fatalf("untrusted = %q, want 198.51.100.9:443 (headers ignored)", got)
	}
	// Trusted peer, garbage XFF: peer kept.
	if got := serve("127.0.0.1:1", "not-an-ip", ""); got != "127.0.0.1:1" {
		t.Fatalf("garbage xff = %q, want 127.0.0.1:1", got)
	}
}
