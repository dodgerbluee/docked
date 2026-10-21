package db

import (
	"context"
	"database/sql"
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
)

type DeployedImageRow struct {
	ID          int64
	ImageRepo   string
	ImageTag    string
	ImageDigest sql.NullString
	Registry    sql.NullString
	Namespace   sql.NullString
	Repository  sql.NullString
	LastSeen    string
}

// GetUnusedImages returns deployed_images that are not referenced by any container.
func GetUnusedImages(ctx context.Context, database *sql.DB, userID int64) ([]DeployedImageRow, error) {
	q := `SELECT di.id, di.image_repo, di.image_tag, di.image_digest, di.registry, di.namespace, di.repository, di.last_seen
		FROM deployed_images di
		WHERE di.user_id = ?
		AND di.image_repo NOT IN (
			SELECT COALESCE(image_repo, '') FROM containers WHERE user_id = ?
		)
		ORDER BY di.last_seen DESC`
	rows, err := database.QueryContext(ctx, q, userID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []DeployedImageRow
	for rows.Next() {
		var r DeployedImageRow
		if err := rows.Scan(&r.ID, &r.ImageRepo, &r.ImageTag, &r.ImageDigest,
			&r.Registry, &r.Namespace, &r.Repository, &r.LastSeen); err != nil {
			return nil, err
		}
		result = append(result, r)
	}
	return result, rows.Err()
}

// GetContainersMatchingIntent mirrors Node's intent matcher: only containers
// with an available update are eligible; inclusion dimensions are ANDed; each
// dimension supports case-insensitive * and ? globs; sources use typed keys
// ("portainer:<id>" / "runner:<id>"); exclusions are applied last.
func GetContainersMatchingIntent(ctx context.Context, database *sql.DB, userID int64,
	matchContainers, matchImages, matchSources, matchStacks, matchRegistries []string,
	excludeContainers, excludeImages, excludeStacks, excludeRegistries []string,
	limit, offset int) ([]ContainerRow, int, error) {
	rows, err := GetContainers(ctx, database, userID)
	if err != nil {
		return nil, 0, err
	}

	matched := make([]ContainerRow, 0, len(rows))
	for _, row := range rows {
		if !containerHasUpdate(row) ||
			!intentIncludes(row, matchContainers, matchImages, matchSources, matchStacks, matchRegistries) ||
			intentExcludes(row, excludeContainers, excludeImages, excludeStacks, excludeRegistries) {
			continue
		}
		matched = append(matched, row)
	}

	total := len(matched)
	if offset < 0 {
		offset = 0
	}
	if offset >= total {
		return []ContainerRow{}, total, nil
	}
	end := total
	if limit > 0 && offset+limit < end {
		end = offset + limit
	}
	return matched[offset:end], total, nil
}

// ContainerHasUpdate exposes the row-level update check so GraphQL filters can
// evaluate the computed hasUpdate flag consistently with the imageInfo field.
func ContainerHasUpdate(c ContainerRow) bool { return containerHasUpdate(c) }

func containerHasUpdate(c ContainerRow) bool {
	if c.Provider.Valid && strings.EqualFold(c.Provider.String, "github-releases") &&
		c.ImageTag.Valid && c.LatestVersion.Valid {
		normalizeVersion := func(value string) string {
			return strings.ToLower(strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(value, "v"), "V")))
		}
		current := normalizeVersion(c.ImageTag.String)
		latest := normalizeVersion(c.LatestVersion.String)
		return current != "" && latest != "" && current != latest
	}
	if !c.LatestDigest.Valid || !c.CurrentDigest.Valid || !c.RepoDigests.Valid {
		return false
	}
	normalizeDigest := func(value string) string {
		value = strings.TrimSpace(strings.ToLower(value))
		return strings.TrimPrefix(value, "sha256:")
	}
	latest := normalizeDigest(c.LatestDigest.String)
	if latest == "" {
		return false
	}
	var repoDigests []string
	if json.Unmarshal([]byte(c.RepoDigests.String), &repoDigests) != nil || len(repoDigests) == 0 {
		return false
	}
	for _, digest := range repoDigests {
		if normalizeDigest(digest) == latest {
			return false
		}
	}
	return true
}

// intentIncludes ANDs the inclusion criteria. An UNSET criterion (nil, i.e.
// NULL in the DB) constrains nothing; an EXPLICITLY EMPTY list ("[]") matches
// nothing — a user who includes zero containers gets zero matches, not all.
func intentIncludes(c ContainerRow, containers, images, sources, stacks, registries []string) bool {
	if containers != nil && (len(containers) == 0 || !matchesAnyGlob(c.ContainerName, containers)) {
		return false
	}
	if images != nil && (len(images) == 0 || !matchesAnyGlob(c.ImageName.String, images)) {
		return false
	}
	if stacks != nil && (len(stacks) == 0 || !matchesAnyGlob(c.StackName.String, stacks)) {
		return false
	}
	if registries != nil && (len(registries) == 0 || !matchesAnyGlob(c.Registry.String, registries)) {
		return false
	}
	if sources != nil {
		if len(sources) == 0 {
			return false
		}
		key := ""
		if c.SourceInstanceID.Valid {
			key = "portainer:" + strconv.FormatInt(c.SourceInstanceID.Int64, 10)
		} else if c.RunnerID.Valid {
			key = "runner:" + strconv.FormatInt(c.RunnerID.Int64, 10)
		}
		if !containsString(sources, key) {
			return false
		}
	}
	return true
}

func intentExcludes(c ContainerRow, containers, images, stacks, registries []string) bool {
	return matchesAnyGlob(c.ContainerName, containers) ||
		matchesAnyGlob(c.ImageName.String, images) ||
		matchesAnyGlob(c.StackName.String, stacks) ||
		matchesAnyGlob(c.Registry.String, registries)
}

// IntentMatchesInclusion exposes the inclusion half of the intent matcher so
// callers (e.g. previewIntent) can evaluate per-container decisions directly.
func IntentMatchesInclusion(c ContainerRow, containers, images, sources, stacks, registries []string) bool {
	return intentIncludes(c, containers, images, sources, stacks, registries)
}

// IntentExclusionReason mirrors Node's matchingEngine.getExclusionReason:
// returns a human-readable reason when an inclusion-matched container is
// excluded, or "" when it is not excluded.
func IntentExclusionReason(c ContainerRow, containers, images, stacks, registries []string) string {
	if len(containers) > 0 && matchesAnyGlob(c.ContainerName, containers) {
		return "container name excluded"
	}
	if len(images) > 0 && matchesAnyGlob(c.ImageName.String, images) {
		return "image excluded"
	}
	if len(stacks) > 0 && matchesAnyGlob(c.StackName.String, stacks) {
		return "stack excluded"
	}
	if len(registries) > 0 && matchesAnyGlob(c.Registry.String, registries) {
		return "registry excluded"
	}
	return ""
}

func matchesAnyGlob(value string, patterns []string) bool {
	if value == "" || len(patterns) == 0 {
		return false
	}
	for _, pattern := range patterns {
		expr := regexp.QuoteMeta(pattern)
		expr = strings.ReplaceAll(expr, `\*`, ".*")
		expr = strings.ReplaceAll(expr, `\?`, ".")
		if re, err := regexp.Compile("(?i)^" + expr + "$"); err == nil && re.MatchString(value) {
			return true
		}
	}
	return false
}

func containsString(values []string, wanted string) bool {
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
}

func placeholders(n int) string {
	s := ""
	for i := 0; i < n; i++ {
		if i > 0 {
			s += ","
		}
		s += "?"
	}
	return s
}
