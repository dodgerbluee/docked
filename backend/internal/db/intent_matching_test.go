package db

import (
	"database/sql"
	"testing"
)

func TestIntentMatcherMirrorsNodeSemantics(t *testing.T) {
	eligible := ContainerRow{
		ContainerName:    "Web-Frontend",
		ImageName:        sql.NullString{String: "ghcr.io/acme/web:2", Valid: true},
		StackName:        sql.NullString{String: "production", Valid: true},
		Registry:         sql.NullString{String: "ghcr.io", Valid: true},
		RunnerID:         sql.NullInt64{Int64: 7, Valid: true},
		CurrentDigest:    sql.NullString{String: "old", Valid: true},
		LatestDigest:     sql.NullString{String: "new", Valid: true},
		RepoDigests:      sql.NullString{String: `["sha256:old"]`, Valid: true},
		SourceInstanceID: sql.NullInt64{},
	}

	if !containerHasUpdate(eligible) {
		t.Fatal("digest change should be update-eligible")
	}
	if !intentIncludes(eligible,
		[]string{"web-*"}, []string{"GHCR.IO/*"}, []string{"runner:7"},
		[]string{"prod?ction"}, []string{"ghcr.*"}) {
		t.Fatal("case-insensitive globs and typed runner source should match")
	}
	if intentIncludes(eligible, nil, nil, []string{"portainer:7"}, nil, nil) {
		t.Fatal("typed source identity must distinguish runner from portainer")
	}
	if !intentExcludes(eligible, []string{"*-frontend"}, nil, nil, nil) {
		t.Fatal("container exclusion glob should match")
	}
	if !intentExcludes(eligible, nil, nil, nil, []string{"GHCR.IO"}) {
		t.Fatal("registry exclusion should be case-insensitive")
	}

	noUpdate := eligible
	noUpdate.RepoDigests.String = `["SHA256:NEW"]`
	if containerHasUpdate(noUpdate) {
		t.Fatal("latest digest already present in multi-arch repoDigests must not be eligible")
	}

	unknown := eligible
	unknown.RepoDigests.Valid = false
	if containerHasUpdate(unknown) {
		t.Fatal("missing repoDigests must avoid Node-incompatible false positives")
	}
}
