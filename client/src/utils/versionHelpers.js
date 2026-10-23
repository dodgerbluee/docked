/**
 * Version comparison helpers.
 *
 * Provides semver-aware comparisons so the UI only shows an "update available"
 * badge when the latest version is strictly newer than the running version.
 * A simple !== check would incorrectly flag a downgrade (e.g. running v0.3.5
 * with latest_version cached as v0.3.4) as an available update.
 */

/**
 * Parse a version string into its numeric core and its trailing suffix.
 *
 * The core is every leading dot-separated number, so "12.2", "v12.2.0" and
 * "1.2.3.4" all parse; the suffix is whatever follows it ("-rc.1", "+build").
 * Trailing components are not assumed to stop at three: an earlier parser
 * truncated at major.minor.patch, which made "1.2.3.1" and "1.2.3.2" look
 * identical and hid a real update. Returns null for unparseable strings.
 */
function parseVersion(v) {
  if (!v) return null;
  const s = String(v).trim().replace(/^v/i, "");
  const match = s.match(/^(\d+(?:\.\d+)*)(.*)$/);
  if (!match) return null;
  return { core: match[1].split(".").map(Number), suffix: match[2] };
}

/** Compares numeric cores, treating a missing component as 0. */
function compareCore(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

/**
 * Splits a suffix into semver prerelease identifiers, or returns null when the
 * suffix is not something the semver rules can order. Build metadata ("+xyz")
 * carries no precedence and is ignored, matching semver.
 */
function prereleaseOf(suffix) {
  if (suffix === "") return [];
  if (suffix.startsWith("+")) return [];
  if (!suffix.startsWith("-")) return null;
  const ids = suffix.slice(1).split(".");
  return ids.every((id) => /^[0-9A-Za-z-]+$/.test(id)) ? ids : null;
}

/**
 * Orders two suffixes for versions whose numeric cores are equal.
 * Returns 1 / -1 / 0, or null when the pair cannot be ordered by the
 * semver prerelease rules and the caller should fall back to text.
 */
function compareSuffix(a, b) {
  if (a === b) return 0;
  const pa = prereleaseOf(a);
  const pb = prereleaseOf(b);
  if (pa === null || pb === null) return null;

  // A plain release outranks any prerelease of the same core, which is the
  // case the old truncating parser got wrong for "1.2.3-rc.1" vs "1.2.3".
  if (pa.length === 0 && pb.length === 0) return 0;
  if (pa.length === 0) return 1;
  if (pb.length === 0) return -1;

  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i];
    const y = pb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) return Number(x) > Number(y) ? 1 : -1;
    // Numeric identifiers always sort below alphanumeric ones.
    if (xNum) return -1;
    if (yNum) return 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

/** Compares two parsed versions. Returns 1 if a > b, -1 if a < b, 0 if equal. */
function compareParsed(a, b) {
  const core = compareCore(a.core, b.core);
  if (core !== 0) return core;
  return compareSuffix(a.suffix, b.suffix);
}

function normalize(v) {
  return String(v).replace(/^v/i, "").trim();
}

/**
 * Returns true only when `latest` is a strictly higher version than `current`.
 * Falls back to a simple string inequality if either value is not valid semver,
 * preserving existing behaviour for non-semver version strings.
 */
export function hasVersionUpdate(current, latest) {
  if (!current || !latest) return false;

  const cur = parseVersion(current);
  const lat = parseVersion(latest);

  if (cur && lat) {
    const cmp = compareParsed(lat, cur);
    if (cmp !== null) return cmp > 0;
  }

  // Fallback: non-semver strings — treat any difference as an update
  return normalize(latest) !== normalize(current);
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
    const cmp = compareParsed(pa, pb);
    if (cmp !== null) return cmp === 0;
  }

  return normalize(a) === normalize(b);
}
