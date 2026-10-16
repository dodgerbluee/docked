/**
 * Convert a graph Runner (camelCase) into the snake_case row shape the
 * runner UI components consume (same fields the REST GET /api/runners
 * returned, minus api_key).
 */
export function mapGraphRunner(runner) {
  if (!runner) return null;
  return {
    id: Number(runner.id),
    name: runner.name,
    url: runner.url,
    enabled: runner.enabled ? 1 : 0,
    version: runner.version,
    latest_version: runner.latestVersion,
    version_checked_at: runner.versionCheckedAt,
    docker_enabled: runner.dockerEnabled ? 1 : 0,
    last_seen: runner.lastHeartbeat,
    docker_status: runner.healthStatus,
    docker_status_since: runner.dockerStatusSince,
    created_at: runner.createdAt,
    updated_at: runner.updatedAt,
  };
}
