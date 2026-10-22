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
	inspect := "sha256:1111"
	listDigest := "sha256:2222"

	if got := pickCurrentDigest(&UpdateInfo{CurrentDigestFull: &inspect}, domain.Container{CurrentDigest: &listDigest}); got == nil || *got != inspect {
		t.Errorf("inspect digest must win, got %v", got)
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
