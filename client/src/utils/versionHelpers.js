/**
 * Version comparison helpers.
 *
 * Provides semver-aware comparisons so the UI only shows an "update available"
 * badge when the latest version is strictly newer than the running version.
 * A simple !== check would incorrectly flag a downgrade (e.g. running v0.3.5
 * with latest_version cached as v0.3.4) as an available update.
 */

/**
 * Parse a version string like "v0.3.5", "0.3.5", "12.2" or "v12" into
 * [major, minor, patch]. Missing minor/patch components are treated as 0, so
 * "12.2" and "12.2.0" (with or without a leading "v") normalize to the same
 * tuple and are never reported as a mismatch. Returns null for unparseable
 * strings.
 */
function parseVersion(v) {
  if (!v) return null;
  const match = String(v)
    .trim()
    .replace(/^v/i, "")
    .match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
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
  return String(latest).replace(/^v/i, "").trim() !== String(current).replace(/^v/i, "").trim();
}

/**
 * Returns true when two version strings refer to the same version, ignoring
 * cosmetic differences such as a leading "v" or omitted trailing ".0"
 * (e.g. "12.2", "v12.2" and "12.2.0" are all equal). Falls back to a
 * normalized string comparison for non-semver strings.
 */
export function versionsEqual(a, b) {
  if (!a || !b) return false;

  const pa = parseVersion(a);
  const pb = parseVersion(b);

  if (pa && pb) {
    return compareSemver(pa, pb) === 0;
  }

  return String(a).replace(/^v/i, "").trim() === String(b).replace(/^v/i, "").trim();
}
