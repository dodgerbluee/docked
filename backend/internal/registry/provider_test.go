package registry

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/go-containerregistry/pkg/v1/remote"
)

// fakeRegistry serves just enough of the Docker Registry v2 API for
// remote.Get: a /v2/ ping and manifest fetches.
func fakeRegistry(t *testing.T, manifest []byte, status int) *httptest.Server {
	t.Helper()
	return httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/v2/":
			w.WriteHeader(http.StatusOK)
			fmt.Fprint(w, "{}")
		case strings.HasPrefix(r.URL.Path, "/v2/library/test/manifests/"):
			if status != http.StatusOK {
				w.WriteHeader(status)
				fmt.Fprint(w, `{"errors":[{"code":"MANIFEST_UNKNOWN"}]}`)
				return
			}
			sum := sha256.Sum256(manifest)
			w.Header().Set("Content-Type", "application/vnd.oci.image.index.v1+json")
			w.Header().Set("Docker-Content-Digest", "sha256:"+hex.EncodeToString(sum[:]))
			w.WriteHeader(http.StatusOK)
			w.Write(manifest)
		default:
			http.NotFound(w, r)
		}
	}))
}

func TestFetchIndexDigest(t *testing.T) {
	manifest := []byte(`{"schemaVersion":2,"mediaType":"application/vnd.oci.image.index.v1+json","manifests":[]}`)
	sum := sha256.Sum256(manifest)
	want := "sha256:" + hex.EncodeToString(sum[:])

	srv := fakeRegistry(t, manifest, http.StatusOK)
	defer srv.Close()

	ref := strings.TrimPrefix(srv.URL, "https://") + "/library/test:latest"
	got, err := fetchIndexDigest(context.Background(), ref, remote.WithTransport(srv.Client().Transport))
	if err != nil {
		t.Fatalf("fetchIndexDigest: %v", err)
	}
	if *got != want {
		t.Errorf("digest = %q, want %q", *got, want)
	}
}

func TestFetchIndexDigestNotFound(t *testing.T) {
	srv := fakeRegistry(t, nil, http.StatusNotFound)
	defer srv.Close()

	ref := strings.TrimPrefix(srv.URL, "https://") + "/library/test:latest"
	_, err := fetchIndexDigest(context.Background(), ref, remote.WithTransport(srv.Client().Transport))
	if err == nil {
		t.Fatal("expected error for 404")
	}
	var hsErr *HTTPStatusError
	if !errors.As(err, &hsErr) {
		t.Fatalf("expected HTTPStatusError, got %T: %v", err, err)
	}
	if hsErr.StatusCode != http.StatusNotFound {
		t.Errorf("StatusCode = %d, want 404", hsErr.StatusCode)
	}
}

// Credential-scoped caches: two different tokens must fingerprint differently
// (the GitLab digest cache key embeds this, so one user's private-image result
// is never served to another user's credentialless check).
func TestTokenFingerprint(t *testing.T) {
	if TokenFingerprint("") != "anon" {
		t.Error("empty token must fingerprint as anon")
	}
	a, b := TokenFingerprint("token-a"), TokenFingerprint("token-b")
	if a == b || a == "anon" || b == "anon" {
		t.Errorf("fingerprints must differ per credential: %q vs %q", a, b)
	}
	if TokenFingerprint("token-a") != a {
		t.Error("fingerprint must be deterministic")
	}
}
