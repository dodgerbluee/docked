package graph

import (
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRunnerUpgradeRequiresSuccessfulDoneEvent(t *testing.T) {
	tests := []struct {
		name    string
		stream  string
		wantErr string
	}{
		{name: "success", stream: "event: start\ndata: {}\n\nevent: done\ndata: {\"exitCode\":0}\n\n"},
		{name: "nonzero exit", stream: "event: error\ndata: {\"message\":\"pull failed\"}\n\nevent: done\ndata: {\"exitCode\":1}\n\n", wantErr: "pull failed"},
		{name: "error then eof", stream: "event: error\ndata: {\"message\":\"connection lost\"}\n\n", wantErr: "connection lost"},
		{name: "missing done", stream: "event: log\ndata: working\n\n", wantErr: "without a done event"},
		{name: "done missing exit code", stream: "event: done\ndata: {}\n\n", wantErr: "missing exitCode"},
		{name: "done null exit code", stream: "event: done\ndata: {\"exitCode\":null}\n\n", wantErr: "missing exitCode"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodPost {
					t.Errorf("method = %s, want POST", r.Method)
				}
				if r.URL.EscapedPath() != "/containers/abc%2Fdef/upgrade" {
					t.Errorf("path = %s, want escaped container path", r.URL.EscapedPath())
				}
				if r.Header.Get("Authorization") != "Bearer secret" {
					t.Errorf("authorization header missing")
				}
				body, _ := io.ReadAll(r.Body)
				if len(body) != 0 {
					t.Errorf("body = %q, want empty", body)
				}
				w.Header().Set("Content-Type", "text/event-stream")
				fmt.Fprint(w, tt.stream)
			}))
			defer server.Close()

			err := runnerUpgrade(server.URL, "secret", "abc/def")
			if tt.wantErr == "" && err != nil {
				t.Fatalf("runnerUpgrade() error = %v", err)
			}
			if tt.wantErr != "" && (err == nil || !strings.Contains(err.Error(), tt.wantErr)) {
				t.Fatalf("runnerUpgrade() error = %v, want containing %q", err, tt.wantErr)
			}
		})
	}
}
