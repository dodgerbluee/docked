package runner

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dockedapp/backend/internal/db"
)

// Repository-qualified RepoDigests must survive normalization RAW
// ("repo@sha256:..."). Stripping them to bare "sha256:<hash>" destroys the
// only recoverable image identity for sha256-pinned containers, so the scan
// persists the bogus repo "sha256". The stripped form is derived where
// persistence needs it, not at the transport boundary.
func TestFetchContainersKeepsRawRepoDigests(t *testing.T) {
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/containers" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"containers": []map[string]any{{
			"id":          "c1",
			"name":        "/app",
			"image":       "quay.io/example/app:1.0",
			"state":       "running",
			"status":      "Up",
			"repoDigests": []string{"quay.io/example/app@sha256:aaa"},
		}}})
	})
	srv := httptest.NewServer(handler)
	defer srv.Close()

	ctrs, err := FetchContainers(context.Background(), db.RunnerRow{ID: 7, URL: srv.URL, APIKey: "k"})
	if err != nil {
		t.Fatalf("FetchContainers: %v", err)
	}
	if len(ctrs) != 1 {
		t.Fatalf("containers = %d, want 1", len(ctrs))
	}
	c := ctrs[0]
	if len(c.RepoDigests) != 1 || c.RepoDigests[0] != "quay.io/example/app@sha256:aaa" {
		t.Errorf("RepoDigests = %v, want the raw repository-qualified digest", c.RepoDigests)
	}
	if c.CurrentDigest == nil || *c.CurrentDigest != "sha256:aaa" {
		t.Errorf("CurrentDigest = %v, want sha256:aaa", c.CurrentDigest)
	}
}

// A bare "sha256:<id>" list entry (no repository prefix) must still yield a
// usable CurrentDigest, and must never masquerade as a repo digest.
func TestFetchContainersBareImageIDDigest(t *testing.T) {
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"containers": []map[string]any{{
			"id":          "c1",
			"name":        "/pinned",
			"image":       "sha256:beef",
			"state":       "running",
			"repoDigests": []string{"sha256:cafe"},
		}}})
	})
	srv := httptest.NewServer(handler)
	defer srv.Close()

	ctrs, err := FetchContainers(context.Background(), db.RunnerRow{ID: 7, URL: srv.URL, APIKey: "k"})
	if err != nil {
		t.Fatalf("FetchContainers: %v", err)
	}
	c := ctrs[0]
	if c.CurrentDigest == nil || *c.CurrentDigest != "sha256:cafe" {
		t.Errorf("CurrentDigest = %v, want sha256:cafe", c.CurrentDigest)
	}
}

// The upgrade pipeline honors the Swarm namespace label as a stack identity;
// the list normalization must use the same fallback so live rows and
// recreated rows agree on stack_name.
func TestFetchContainersStackSwarmLabelFallback(t *testing.T) {
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"containers": []map[string]any{{
			"id":     "c1",
			"name":   "/swarmy",
			"image":  "nginx:1.25",
			"state":  "running",
			"labels": map[string]string{"com.docker.stack.namespace": "mystack"},
		}}})
	})
	srv := httptest.NewServer(handler)
	defer srv.Close()

	ctrs, err := FetchContainers(context.Background(), db.RunnerRow{ID: 7, URL: srv.URL, APIKey: "k"})
	if err != nil {
		t.Fatalf("FetchContainers: %v", err)
	}
	c := ctrs[0]
	if c.StackName == nil || *c.StackName != "mystack" {
		t.Errorf("StackName = %v, want mystack (com.docker.stack.namespace fallback)", c.StackName)
	}
}
