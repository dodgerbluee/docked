package db

import (
	"context"
	"database/sql"
	"testing"
)

func TestContainerDetailsScopesRecordsAndHistory(t *testing.T) {
	database := newMigratedTestDB(t)
	execOK(t, database, `INSERT INTO users (id, username, password_hash) VALUES (1, 'owner', 'hash'), (2, 'other', 'hash')`)
	execOK(t, database, `INSERT INTO runners (id, user_id, name, url, api_key) VALUES (1, 1, 'one', 'http://one', 'key'), (2, 1, 'two', 'http://two', 'key'), (3, 2, 'other', 'http://other', 'key')`)
	for _, pair := range [][2]int{{1, 1}, {1, 2}, {2, 3}} {
		execOK(t, database, `INSERT INTO containers (user_id, runner_id, container_id, container_name, image_name, image_repo) VALUES (?, ?, 'same-id', 'same-name', 'alpine:latest', 'alpine')`, pair[0], pair[1])
		execOK(t, database, `INSERT INTO upgrade_history (user_id, runner_id, container_id, container_name, old_image, new_image) VALUES (?, ?, 'same-id', 'same-name', 'old', 'new')`, pair[0], pair[1])
	}
	execOK(t, database, `INSERT INTO deployed_images (id, user_id, image_repo, image_tag, image_digest) VALUES (1, 1, 'alpine', 'latest', 'sha256:owner'), (2, 2, 'alpine', 'latest', 'sha256:other')`)
	execOK(t, database, `INSERT INTO registry_image_versions (user_id, registry, repository, image_repo, tag, latest_digest) VALUES (1, 'docker.io', 'alpine', 'alpine', 'latest', 'sha256:new'), (2, 'docker.io', 'alpine', 'alpine', 'latest', 'sha256:private')`)
	row := &ContainerRow{ContainerID: "same-id", ContainerName: "same-name", RunnerID: sql.NullInt64{Int64: 1, Valid: true}, ImageRepo: sql.NullString{String: "alpine", Valid: true}, ImageTag: sql.NullString{String: "latest", Valid: true}, DeployedImageID: sql.NullInt64{Int64: 1, Valid: true}}
	records, err := GetContainerDetailRecords(context.Background(), database, 1, row)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"containerRecords", "allDeployedImages", "allRegistryImageVersions", "upgradeHistory", "allContainersWithSameName"} {
		rows := records[key].([]map[string]any)
		if len(rows) != 1 {
			t.Fatalf("%s: got %d records, want one owner/runner record", key, len(rows))
		}
		if rows[0]["user_id"] != int64(1) {
			t.Fatalf("%s leaked another user's record", key)
		}
	}
	if records["deployedImage"].(map[string]any)["image_digest"] != "sha256:owner" {
		t.Fatal("incorrect deployed image")
	}
}
