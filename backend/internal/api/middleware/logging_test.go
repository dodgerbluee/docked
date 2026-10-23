package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// The runner SSE handlers clear the server-wide WriteTimeout through
// http.NewResponseController. A ResponseWriter wrapper that does not implement
// Unwrap makes that call fail with "feature not supported", so the wrapper
// silently reintroduces the 30s ceiling on every log/event stream.
func TestLoggerAllowsResponseControllerDeadlines(t *testing.T) {
	var deadlineErr error
	handler := Logger(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		deadlineErr = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(30 * time.Second))
	}))

	srv := httptest.NewServer(handler)
	defer srv.Close()

	resp, err := http.Get(srv.URL)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	defer resp.Body.Close()

	if deadlineErr != nil {
		t.Errorf("SetWriteDeadline through the logger wrapper: %v", deadlineErr)
	}
}
