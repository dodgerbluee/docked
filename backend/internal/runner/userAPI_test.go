package runner

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/dockedapp/backend/internal/db"
)

// Regression: doRunner must NOT cancel its timeout context when it returns —
// the context has to stay alive while the caller streams the body. A
// defer cancel() in doRunner aborted in-flight bodies with "context canceled"
// (prod: apps/history with megabytes of operation output failed 502 while
// small responses won the buffering race and passed).

func slowBodyStub(delay time.Duration) *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"history":[`)
		if f, ok := w.(http.Flusher); ok {
			f.Flush() // headers + partial body reach the client early
		}
		time.Sleep(delay)
		for i := range 2000 {
			if i > 0 {
				io.WriteString(w, ",")
			}
			fmt.Fprintf(w, `{"i":%d,"pad":"%s"}`, i, strings.Repeat("x", 100))
		}
		io.WriteString(w, `]}`)
	}))
}

func TestFetchJSONSlowLargeBodySurvives(t *testing.T) {
	srv := slowBodyStub(150 * time.Millisecond)
	defer srv.Close()

	rr := db.RunnerRow{URL: srv.URL, APIKey: "k"}
	data, err := FetchJSON(context.Background(), rr, "/apps/history", nil)
	if err != nil {
		t.Fatalf("FetchJSON: %v", err)
	}
	list, _ := data["history"].([]any)
	if len(list) != 2000 {
		t.Fatalf("history length = %d, want 2000", len(list))
	}
}

func TestDoRunnerTimeoutStillCoversBody(t *testing.T) {
	srv := slowBodyStub(400 * time.Millisecond)
	defer srv.Close()

	rr := db.RunnerRow{URL: srv.URL, APIKey: "k"}
	// Headers arrive fast, so doRunner succeeds; the deadline must still kill
	// the stalled body read (matching axios's whole-response timeout).
	resp, err := doRunner(context.Background(), rr, http.MethodGet, "/apps/history", nil, nil, 100*time.Millisecond)
	if err != nil {
		t.Fatalf("doRunner: %v", err)
	}
	defer resp.Body.Close()
	if _, err := io.ReadAll(resp.Body); err == nil {
		t.Fatal("body read should have hit the deadline")
	} else if !strings.Contains(err.Error(), "deadline exceeded") {
		t.Errorf("body read error = %v, want deadline exceeded", err)
	}
}
