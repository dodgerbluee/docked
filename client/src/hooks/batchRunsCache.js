/**
 * Shared module-level cache for batch runs by-job-type data.
 *
 * Both useBatchPolling (App-level) and useBatchRuns (SummaryPage) fetch the
 * latest batch runs per job type. This module deduplicates that request:
 *
 * - useBatchPolling calls `fetchLatestRunsByJobType()` which fires the query and
 *   caches both the promise and the resolved data.
 * - useBatchRuns calls the same function on its initial load. If the request is
 *   already in-flight it gets the same promise back; if it already resolved it
 *   gets the cached data immediately.
 */

import { graphqlClient } from "../graphql/client";
import { BATCH_RUNS_QUERY } from "../graphql/queries";
import { registerCacheClear } from "../utils/cacheRegistry";

let _latestRunsByJobType = null;
let _inflight = null;

// Module-level caches hold one user's batch runs; they must not survive
// logout into the next session in the same tab.
export function clearBatchRunsCache() {
  _latestRunsByJobType = null;
  _inflight = null;
}
registerCacheClear(clearBatchRunsCache);

// Convert a graph BatchRun (camelCase, enum names) into the snake_case row
// shape the batch UI components consume.
export function mapGraphRunToRow(run) {
  if (!run) return null;
  return {
    id: Number(run.id),
    status: run.status.toLowerCase(),
    job_type: run.jobType.toLowerCase().replace(/_/g, "-"),
    queued_at: run.queuedAt,
    started_at: run.startedAt,
    completed_at: run.completedAt,
    duration_ms: run.durationMs,
    containers_checked: run.containersChecked,
    containers_updated: run.containersUpdated,
    error_message: run.errorMessage,
    logs: run.logs,
    is_manual: run.isManual,
  };
}

/**
 * Fetch the latest batch run per job type, deduplicating concurrent calls.
 * Returns a promise that resolves to the runs object (or null on error).
 */
export function fetchLatestRunsByJobType() {
  // If we already have an in-flight request, piggy-back on it
  if (_inflight) {
    return _inflight;
  }

  _inflight = graphqlClient
    .query(BATCH_RUNS_QUERY, { first: 50 })
    .toPromise()
    .then((result) => {
      if (!result.error && result.data?.batchRuns?.items) {
        // Items come back newest-first, so the first item per job type wins.
        const runs = {};
        result.data.batchRuns.items.forEach((item) => {
          const jobType = item.jobType.toLowerCase().replace(/_/g, "-");
          if (!runs[jobType]) {
            runs[jobType] = mapGraphRunToRow(item);
          }
        });
        _latestRunsByJobType = runs;
        return runs;
      }
      return _latestRunsByJobType;
    })
    .catch((err) => {
      console.error("Error fetching batch runs by job type:", err);
      return _latestRunsByJobType;
    })
    .finally(() => {
      // Clear the in-flight tracker so subsequent polls make a fresh request
      _inflight = null;
    });

  return _inflight;
}

export function getCachedLatestRunsByJobType() {
  return _latestRunsByJobType;
}

export function setCachedLatestRunsByJobType(runs) {
  _latestRunsByJobType = runs;
}
