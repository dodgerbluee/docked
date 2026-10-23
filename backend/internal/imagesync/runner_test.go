package imagesync

import (
	"testing"

	"github.com/dockedapp/backend/internal/domain"
)

// Tag-based containers have no digest in the inspect doc; the runner list
// shape's RepoDigests-derived CurrentDigest must be persisted instead of nil,
// otherwise containerHasUpdate rejects the row and the update notification is
// suppressed forever.
func TestPickCurrentDigestFallsBackToContainer(t *testing.T) {
	stored := "sha256:1111"
	listDigest := "sha256:2222"

	// The stored baseline (info.CurrentDigestFull) is the WEAKEST signal: it
	// comes from a previous scan and goes stale the moment the container is
	// recreated on a newer image. The live container digest must win.
	if got := pickCurrentDigest(&UpdateInfo{CurrentDigestFull: &stored}, domain.Container{CurrentDigest: &listDigest}); got == nil || *got != listDigest {
		t.Errorf("live container digest must beat the stored baseline, got %v", got)
	}
	if got := pickCurrentDigest(&UpdateInfo{}, domain.Container{CurrentDigest: &listDigest}); got == nil || *got != listDigest {
		t.Errorf("must fall back to the container's list digest, got %v", got)
	}
	empty := ""
	if got := pickCurrentDigest(&UpdateInfo{}, domain.Container{CurrentDigest: &empty}); got != nil {
		t.Errorf("empty fallback must stay nil, got %q", *got)
	}
	if got := pickCurrentDigest(&UpdateInfo{}, domain.Container{}); got != nil {
		t.Errorf("no digest anywhere must stay nil, got %q", *got)
	}
}

// The inspect document's own repo digest is the freshest observation and must
// beat both the list shape and the stored baseline.
func TestPickCurrentDigestPrefersInspectDocument(t *testing.T) {
	inspect := "sha256:inspect"
	listDigest := "sha256:list"
	stored := "sha256:stored"

	info := &UpdateInfo{InspectDigest: &inspect, CurrentDigestFull: &stored}
	if got := pickCurrentDigest(info, domain.Container{CurrentDigest: &listDigest}); got == nil || *got != inspect {
		t.Errorf("inspect digest must win, got %v", got)
	}
}

// Only the stored baseline is left when the container reports nothing.
func TestPickCurrentDigestFallsBackToStored(t *testing.T) {
	stored := "sha256:stored"
	if got := pickCurrentDigest(&UpdateInfo{CurrentDigestFull: &stored}, domain.Container{}); got == nil || *got != stored {
		t.Errorf("expected stored digest fallback, got %v", got)
	}
}

// A repository-qualified digest is the only form that can be re-parsed into an
// image reference. A bare "sha256:<image ID>" (what Docker reports for an image
// pulled by ID) carries no repository, and accepting it makes SplitRepoTag
// invent the bogus repo "sha256".
func TestFirstRepoDigestRejectsBareImageID(t *testing.T) {
	cases := []struct {
		name string
		in   []string
		want string
	}{
		{"bare id", []string{"sha256:8e4e2a1b"}, ""},
		{"bare id first", []string{"sha256:8e4e2a1b", "nginx@sha256:aaa"}, "nginx@sha256:aaa"},
		{"empty", nil, ""},
		{"no digest", []string{"nginx:latest"}, ""},
	}
	for _, tc := range cases {
		var arr []any
		for _, s := range tc.in {
			arr = append(arr, s)
		}
		details := map[string]any{"RepoDigests": arr}
		if got := firstRepoDigest(details, tc.in); got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
	}
	if got := firstRepoDigest(nil, []string{"registry:5000/x@sha256:aaa"}); got != "registry:5000/x@sha256:aaa" {
		t.Errorf("repo-qualified digest: got %q", got)
	}
}

// The docked.original_image label is stamped by the upgrade pipeline on
// recreated dependents; it is the authoritative recovery source when the
// inspect document carries no repo digests.
func TestOriginalImageReferenceFromLabel(t *testing.T) {
	details := map[string]any{
		"Config": map[string]any{
			"Image":  "sha256:beef",
			"Labels": map[string]any{"docked.original_image": "quay.io/example/app@sha256:aaa"},
		},
	}
	got := originalImageReference(details)
	if got != "quay.io/example/app@sha256:aaa" {
		t.Errorf("originalImageReference = %q, want the labelled reference", got)
	}
	if got := originalImageReference(map[string]any{"Config": map[string]any{"Image": "nginx:1.25"}}); got != "" {
		t.Errorf("no label must yield no reference, got %q", got)
	}
	if got := originalImageReference(nil); got != "" {
		t.Errorf("nil inspect must yield no reference, got %q", got)
	}
}
