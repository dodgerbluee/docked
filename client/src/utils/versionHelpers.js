/**
 * Version comparison helpers.
 *
 * Provides semver-aware comparisons so the UI only shows an "update available"
 * badge when the latest version is strictly newer than the running version.
 * A simple !== check would incorrectly flag a downgrade (e.g. running v0.3.5
 * with latest_version cached as v0.3.4) as an available update.
 */

/**
 * Parse a version string like "v0.3.5" or "0.3.5" into [major, minor, patch].
 * Returns null for unparseable strings.
 */
function parseVersion(v) {
  if (!v) return null;
  const match = String(v)
    .trim()
    .replace(/^v/, "")
    .match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Compare two semver tuples.
 * Returns  1 if a > b,
 *         -1 if a < b,
 *          0 if equal.
 */
function compareSemver(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return 1;
    if (a[i] < b[i]) return -1;
  }
  return 0;
}

/**
 * Returns true only when `latest` is a strictly higher semver than `current`.
 * Falls back to a simple string inequality if either value is not valid semver,
 * preserving existing behaviour for non-semver version strings.
 */
export function hasVersionUpdate(current, latest) {
  if (!current || !latest) return false;

  const cur = parseVersion(current);
  const lat = parseVersion(latest);

  if (cur && lat) {
    return compareSemver(lat, cur) > 0;
  }

  // Fallback: non-semver strings — treat any difference as an update
  return String(latest).replace(/^v/, "").trim() !== String(current).replace(/^v/, "").trim();
}
