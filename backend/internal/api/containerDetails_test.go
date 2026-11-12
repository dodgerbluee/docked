package api

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestContainerDetailsGraphQLDigestsAndOwnership(t *testing.T) {
	env := newTestEnv(t, true)
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := env.database.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`ALTER TABLE deployed_images ADD COLUMN last_seen TEXT`)
	exec(`INSERT INTO runners (id, user_id, name, url, api_key, enabled) VALUES (91, ?, 'host-one', 'http://unused', 'private-key', 0), (92, ?, 'host-two', 'http://unused', 'private-key', 0)`, env.adminID, env.adminID)
	oldDigest, newDigest := "sha256:"+strings.Repeat("a", 64), "sha256:"+strings.Repeat("b", 64)
	exec(`INSERT INTO deployed_images (id,user_id,image_repo,image_tag,image_digest,repo_digests) VALUES (90,?,'nginx','latest',?,?)`, env.adminID, oldDigest, `["nginx@`+oldDigest+`"]`)
	exec(`INSERT INTO registry_image_versions (user_id,image_repo,tag,latest_digest) VALUES (?,'nginx','latest',?)`, env.adminID, newDigest)
	exec(`INSERT INTO containers (user_id,runner_id,container_id,container_name,image_name,image_repo,deployed_image_id) VALUES (?,91,'shared-id','web','nginx:latest','nginx',90), (?,92,'shared-id','different-host','nginx:latest','nginx',90)`, env.adminID, env.adminID)
	q := `query($runner: ID!){ containerDetails(containerId:"shared-id", runnerId:$runner) }`
	admin := env.token(t, env.adminID, "admin")
	r := env.gql(t, admin, q, map[string]any{"runner": "91"})
	if len(r.Errors) != 0 {
		t.Fatalf("details: %+v", r.Errors)
	}
	var details struct {
		CurrentDigest string         `json:"currentDigest"`
		LatestDigest  string         `json:"latestDigest"`
		Container     map[string]any `json:"container"`
	}
	if err := json.Unmarshal(r.Data["containerDetails"], &details); err != nil {
		t.Fatal(err)
	}
	if details.CurrentDigest != oldDigest || details.LatestDigest != newDigest || details.Container["container_name"] != "web" {
		t.Fatalf("wrong details: %+v", details)
	}
	if strings.Contains(string(r.Data["containerDetails"]), "private-key") {
		t.Fatal("runner key leaked")
	}
	r = env.gql(t, admin, q, map[string]any{"runner": "92"})
	if err := json.Unmarshal(r.Data["containerDetails"], &details); err != nil {
		t.Fatal(err)
	}
	if details.Container["container_name"] != "different-host" {
		t.Fatal("runner collision resolved to wrong container")
	}
	member := env.token(t, env.memberID, "member")
	r = env.gql(t, member, q, map[string]any{"runner": "91"})
	if len(r.Errors) != 0 || string(r.Data["containerDetails"]) != "null" {
		t.Fatalf("foreign runner disclosed: %+v", r)
	}
	r = env.gql(t, "", q, map[string]any{"runner": "91"})
	if !r.hasErrorContaining("authentication required") {
		t.Fatal("unauthenticated details accepted")
	}
}
