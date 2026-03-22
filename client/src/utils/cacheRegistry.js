/**
 * Central cache registry for module-level caches.
 * Modules register their clear functions here so they can all be
 * flushed on logout without creating import dependency issues
 * (e.g., importing a lazy-loaded page from useAuth would break code-splitting).
 */

const clearFns = [];

/** Register a cache-clearing function. Called at module load time. */
export function registerCacheClear(fn) {
  clearFns.push(fn);
}

/** Flush every registered module-level cache (call on logout). */
export function clearAllCaches() {
  for (const fn of clearFns) {
    fn();
  }
}
