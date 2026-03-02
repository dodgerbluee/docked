/**
 * Shared module-level cache for batch runs by-job-type data.
 *
 * Both useBatchPolling (App-level) and useBatchRuns (SummaryPage) fetch
 * `batch/runs/latest?byJobType=true`. This module deduplicates that request:
 *
 * - useBatchPolling calls `fetchLatestRunsByJobType()` which fires the XHR and
 *   caches both the promise and the resolved data.
 * - useBatchRuns calls the same function on its initial load. If the request is
 *   already in-flight it gets the same promise back; if it already resolved it
 *   gets the cached data immediately.
 */

import axios from "axios";
import { API_BASE_URL } from "../utils/api";

let _latestRunsByJobType = null;
let _inflight = null;

/**
 * Fetch `batch/runs/latest?byJobType=true`, deduplicating concurrent calls.
 * Returns a promise that resolves to the runs object (or null on error).
 */
export function fetchLatestRunsByJobType() {
  // If we already have an in-flight request, piggy-back on it
  if (_inflight) {
    return _inflight;
  }

  _inflight = axios
    .get(`${API_BASE_URL}/api/batch/runs/latest?byJobType=true`)
    .then((response) => {
      if (response.data.success) {
        const runs = response.data.runs || {};
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
