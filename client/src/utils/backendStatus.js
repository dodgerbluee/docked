/**
 * Shared backend-reachability tracker.
 *
 * When polling hooks (useBatchRuns, useBatchPolling) keep firing into a dead
 * backend they create an avalanche of ERR_CONNECTION_REFUSED errors in the
 * console and waste CPU/network resources.
 *
 * This module provides:
 * - `markBackendDown()` / `markBackendUp()` – called by any code that detects
 *   a network-level failure or a successful response.
 * - `isBackendUp()` – cheap check that polling hooks call before firing a
 *   request. When the backend is down they skip the request entirely.
 * - A built-in recovery probe: when the backend is marked down, the module
 *   starts a lightweight health check (GET /api/version) every
 *   RECOVERY_PROBE_INTERVAL_MS. Once the backend responds, it marks it as up
 *   again so polling resumes automatically.
 *
 * The module also installs a global axios response interceptor so *any*
 * request that fails with a network error automatically marks the backend as
 * down (and any successful response marks it as up).
 */

import axios from "axios";
import { API_BASE_URL } from "./api";

// ─── State ────────────────────────────────────────────────────────────────────
let _isUp = true;
let _recoveryTimer = null;
const RECOVERY_PROBE_INTERVAL_MS = 30_000; // 30 seconds

// ─── Public API ───────────────────────────────────────────────────────────────

export function isBackendUp() {
  return _isUp;
}

export function markBackendDown() {
  if (!_isUp) return; // already down – don't re-log / re-start timer
  _isUp = false;
  console.warn("[backendStatus] Backend marked as unreachable – polling paused.");
  _startRecoveryProbe();
}

export function markBackendUp() {
  if (_isUp) return; // already up
  _isUp = true;
  _stopRecoveryProbe();
  console.info("[backendStatus] Backend is reachable again – polling resumed.");
}

// ─── Recovery probe ───────────────────────────────────────────────────────────

function _startRecoveryProbe() {
  if (_recoveryTimer) return; // already probing
  _recoveryTimer = setInterval(async () => {
    try {
      await axios.get(`${API_BASE_URL}/api/version`, { timeout: 5000 });
      // If we get here the backend responded – interceptor will call markBackendUp()
    } catch {
      // Still down – do nothing, the interval will retry.
    }
  }, RECOVERY_PROBE_INTERVAL_MS);
}

function _stopRecoveryProbe() {
  if (_recoveryTimer) {
    clearInterval(_recoveryTimer);
    _recoveryTimer = null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns true when an axios error represents a network-level failure
 * (connection refused, timeout, DNS failure, etc.) as opposed to an HTTP error
 * response from the server (4xx, 5xx).
 */
function _isNetworkError(error) {
  // Axios sets error.response only when the server actually responded.
  // No response means the request never reached the server.
  if (error.response) return false;

  return (
    error.code === "ERR_NETWORK" ||
    error.code === "ECONNREFUSED" ||
    error.code === "ECONNRESET" ||
    error.code === "ETIMEDOUT" ||
    error.code === "ECONNABORTED" ||
    error.message === "Network Error"
  );
}

// ─── Global axios interceptor ─────────────────────────────────────────────────
// Installed once when this module is first imported.  It piggy-backs on every
// axios request to keep _isUp in sync with reality without any per-hook wiring.

axios.interceptors.response.use(
  // On success – backend is clearly reachable
  (response) => {
    if (!_isUp) markBackendUp();
    return response;
  },
  // On error – check if it's a network failure
  (error) => {
    if (_isNetworkError(error)) {
      markBackendDown();
    } else if (error.response) {
      // Server responded (even with 4xx/5xx) → backend is reachable
      if (!_isUp) markBackendUp();
    }
    return Promise.reject(error);
  }
);
