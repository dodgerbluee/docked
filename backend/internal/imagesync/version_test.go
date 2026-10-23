package imagesync

import (
	"testing"
)

func sptr(s string) *string { return &s }

// The version row must be written for every CONFIRMED registry observation,
// but a failed lookup surfaces as a non-nil, digest-less placeholder
// (processProviderResult/ensureProvider stamp a provider onto it and the
// caller sets ExistsInRegistry). Writing those placeholders NULLs out a
// previously known latest_digest, so the gate needs a digest or a version.
func TestBuildVersionDataGate(t *testing.T) {
	// Provider-only placeholder from a failed lookup: must not be persisted.
	ph := &UpdateInfo{ExistsInRegistry: true, Provider: "dockerhub", CurrentTag: "1.25", LatestTag: "1.25"}
	if got := buildVersionData(ph, "1.25"); got != nil {
		t.Errorf("digest-less placeholder persisted: %+v", got)
	}

	// Not in registry: nothing to store.
	missing := &UpdateInfo{ExistsInRegistry: false, CurrentTag: "1.25", LatestDigestFull: sptr("sha256:bbb")}
	if got := buildVersionData(missing, "1.25"); got != nil {
		t.Errorf("absent image persisted: %+v", got)
	}

	// Digest success.
	ok := &UpdateInfo{
		ExistsInRegistry: true, Provider: "dockerhub", CurrentTag: "1.25",
		LatestTag: "1.26", LatestDigestFull: sptr("sha256:bbb"),
		LatestPublishDate: sptr("2026-01-02T00:00:00Z"),
	}
	v := buildVersionData(ok, "1.25")
	if v == nil {
		t.Fatal("digest success must be persisted")
	}
	if v.LatestDigest == nil || *v.LatestDigest != "sha256:bbb" {
		t.Errorf("LatestDigest = %v", v.LatestDigest)
	}
	if v.Provider != "dockerhub" {
		t.Errorf("Provider = %q, want dockerhub", v.Provider)
	}
	if v.LatestPublishDate == nil || *v.LatestPublishDate != "2026-01-02T00:00:00Z" {
		t.Errorf("LatestPublishDate = %v", v.LatestPublishDate)
	}
	if v.LatestTag != "1.26" {
		t.Errorf("LatestTag = %q", v.LatestTag)
	}

	// Version-only success (GitHub releases report a version, no digest):
	// still a confirmed observation and must be stored.
	ver := &UpdateInfo{
		ExistsInRegistry: true, Provider: "github", CurrentTag: "v1.0.0",
		LatestTag: "v1.1.0", LatestVersion: sptr("v1.1.0"),
	}
	v2 := buildVersionData(ver, "v1.0.0")
	if v2 == nil {
		t.Fatal("version-only success must be persisted")
	}
	if v2.LatestVersion == nil || *v2.LatestVersion != "v1.1.0" {
		t.Errorf("LatestVersion = %v, want v1.1.0", v2.LatestVersion)
	}

	// A blank latest tag falls back to the container's own tag.
	blank := &UpdateInfo{ExistsInRegistry: true, CurrentTag: "1.25", LatestDigestFull: sptr("sha256:bbb")}
	if v3 := buildVersionData(blank, "1.25"); v3 == nil || v3.LatestTag != "1.25" {
		t.Errorf("blank latest tag must fall back to the current tag, got %+v", v3)
	}
}
