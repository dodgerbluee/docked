/**
 * Central cache registry for module-level caches.
 * Modules register their clear functions here so they can all be
 * flushed on logout without creating import dependency issues
 * (e.g., importing a lazy-loaded page from useAuth would break code-splitting).
 */

const clearFns = [];

// Session generation: bumped on every flush. Async fetches capture it before
// firing and drop their completion if it changed — the response belongs to a
// dead session (possibly another user's data) and must not repopulate state
// or module caches. mountedRef alone cannot tell a dead session apart.
let _generation = 0;

/** Current session generation; capture before any authenticated fetch. */
export function getSessionGeneration() {
  return _generation;
}

/** True when the captured generation no longer matches the live session. */
export function isSessionStale(generation) {
  return generation !== _generation;
}

/** Register a cache-clearing function. Called at module load time. */
export function registerCacheClear(fn) {
  clearFns.push(fn);
}

/** Flush every registered module-level cache (call on logout). */
export function clearAllCaches() {
  _generation += 1;
  for (const fn of clearFns) {
    fn();
  }
}
