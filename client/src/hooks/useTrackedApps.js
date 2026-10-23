/**
 * Custom hook for Tracked Apps functionality
 * Manages state and operations for tracked Docker images and GitHub repositories
 */

import { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import { parseUTCTimestamp } from "../utils/formatters";
import { graphqlClient } from "../graphql/client";
import {
  TRACKED_APPS_QUERY,
  CHECK_TRACKED_APP_UPDATE_MUTATION,
  CHECK_TRACKED_APP_UPDATES_MUTATION,
  CLEAR_TRACKED_APP_CACHE_MUTATION,
  DELETE_TRACKED_APP_MUTATION,
  UPDATE_TRACKED_APP_MUTATION,
  CREATE_BATCH_RUN_MUTATION,
  UPDATE_BATCH_RUN_MUTATION,
} from "../graphql/queries";
import {
  // SUCCESS_MESSAGE_DURATION is not currently used but kept for potential future use
  SHORT_SUCCESS_MESSAGE_DURATION,
} from "../constants/trackedApps";
import { registerCacheClear, getSessionGeneration, isSessionStale } from "../utils/cacheRegistry";

// Module-level cache – survives unmount/remount so the TrackedAppsPage tab
// renders instantly on re-navigation. The App.jsx instance populates this on
// first load; subsequent hook instances initialise from cache without API calls.
let cachedTrackedApps = null;
let cachedLastScanTime = null;

// Module-level caches hold one user's tracked apps; they must not survive
// logout into the next session in the same tab.
export function clearTrackedAppsCache() {
  cachedTrackedApps = null;
  cachedLastScanTime = null;
}
registerCacheClear(clearTrackedAppsCache);

/** Maps GraphQL camelCase TrackedApp to the snake_case shape UI components expect. */
function mapTrackedApp(a) {
  return {
    id: a.id,
    name: a.name,
    image_name: a.imageName,
    github_repo: a.githubRepo,
    source_type: a.sourceType?.toLowerCase(),
    current_version: a.currentVersion,
    current_digest: a.currentDigest,
    latest_version: a.latestVersion,
    latest_digest: a.latestDigest,
    has_update: a.hasUpdate,
    // TrackedAppCard reads these two in camelCase (it is the only component
    // that shows a release date); not selecting them made "Released" always
    // render "Not available".
    currentVersionPublishDate: a.currentVersionPublishDate,
    latestVersionPublishDate: a.latestVersionPublishDate,
    last_checked: a.lastChecked,
    created_at: a.createdAt,
    updated_at: a.updatedAt,
  };
}

/**
 * Custom hook for managing tracked apps
 * @param {boolean} [isAuthenticated] - Whether user is authenticated (optional, will check axios defaults if not provided)
 * @param {string} [authToken] - Authentication token (optional, will check axios defaults if not provided)
 * @returns {Object} Tracked apps state and handlers
 */
export function useTrackedApps(isAuthenticated, authToken) {
  // If not provided, check if we have auth via axios defaults or localStorage
  const hasAuth =
    isAuthenticated !== undefined
      ? isAuthenticated
      : !!(axios.defaults.headers.common["Authorization"] || localStorage.getItem("authToken"));
  const effectiveToken = authToken !== undefined ? authToken : localStorage.getItem("authToken");
  const [trackedApps, setTrackedApps] = useState(cachedTrackedApps || []);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(cachedTrackedApps !== null); // Track if we've loaded data at least once
  const [trackedAppError, setTrackedAppError] = useState("");
  const [trackedAppSuccess, setTrackedAppSuccess] = useState("");
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [lastScanTime, setLastScanTime] = useState(cachedLastScanTime);
  const mountedRef = useRef(true);
  const [editingTrackedAppData, setEditingTrackedAppData] = useState(null);
  const [showAddTrackedAppModal, setShowAddTrackedAppModal] = useState(false);
  const [clearingGitHubCache, setClearingGitHubCache] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: null,
    variant: "danger",
  });

  const fetchTrackedApps = useCallback(
    async (showLoading = false) => {
      if (!hasAuth || !effectiveToken) {
        return;
      }
      const gen = getSessionGeneration();
      try {
        // Only show loading state if explicitly requested (e.g., user clicks "Check for Updates")
        // Don't show loading on initial mount - just populate data when it arrives
        if (showLoading) {
          setIsLoading(true);
        }
        const result = await graphqlClient.query(TRACKED_APPS_QUERY).toPromise();
        if (result.error) throw new Error(result.error.message);
        // Logout mid-flight: this response belongs to the dead session
        // (possibly another user's apps); never repopulate state or cache.
        if (isSessionStale(gen)) return;
        if (result.data?.trackedApps && mountedRef.current) {
          const apps = (result.data.trackedApps || []).map(mapTrackedApp);

          // Sort alphabetically by name
          const sortedApps = apps.sort((a, b) => {
            const nameA = (a.name || "").toLowerCase();
            const nameB = (b.name || "").toLowerCase();
            return nameA.localeCompare(nameB);
          });

          cachedTrackedApps = sortedApps;
          setTrackedApps(sortedApps);
          setHasLoadedOnce(true); // Mark that we've loaded data at least once

          // Set last scan time from the most recent last_checked
          if (apps.length > 0) {
            const mostRecentCheck = apps
              .map((img) => img.last_checked)
              .filter(Boolean)
              .sort((a, b) => {
                const dateA = parseUTCTimestamp(a);
                const dateB = parseUTCTimestamp(b);
                return dateB.getTime() - dateA.getTime();
              })[0];
            if (mostRecentCheck) {
              // Parse as UTC timestamp (database stores in UTC without timezone info)
              const scanTime = parseUTCTimestamp(mostRecentCheck);
              cachedLastScanTime = scanTime;
              setLastScanTime(scanTime);
            }
          }
        }
      } catch (err) {
        if (isSessionStale(gen)) return;
        console.error("Error fetching tracked apps:", err);
      } finally {
        if (mountedRef.current && !isSessionStale(gen)) {
          setIsLoading(false);
        }
      }
    },
    [hasAuth, effectiveToken]
  );

  // Fetch tracked apps on mount. Every instance fetches for itself: the module
  // cache only seeds useState at mount time, so an instance that mounts while
  // another instance's request is still in flight would otherwise never receive
  // a result. urql deduplicates identical in-flight queries on one client, so
  // the extra call costs nothing (a module boolean is not state sync).
  const initialFetchDoneRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    if (hasAuth && effectiveToken && !initialFetchDoneRef.current) {
      initialFetchDoneRef.current = true;
      fetchTrackedApps();
    }
    // Reset on logout so re-login triggers a fresh fetch
    if (!hasAuth) {
      initialFetchDoneRef.current = false;
      cachedTrackedApps = null;
      cachedLastScanTime = null;
    }
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasAuth, effectiveToken]);

  const handleTrackedAppModalSuccess = useCallback(
    async (appId) => {
      const gen = getSessionGeneration();
      // If we have an app ID, check the version first, then refresh once
      if (appId) {
        try {
          await graphqlClient
            .mutation(CHECK_TRACKED_APP_UPDATE_MUTATION, { id: appId })
            .toPromise();
        } catch (err) {
          // Silently fail - version check is not critical, just a nice-to-have
          console.error("Error checking version for tracked app:", err);
        }
        if (isSessionStale(gen)) return; // logout mid-flight: no follow-up request
      }

      // Single refresh after all mutations are done
      await fetchTrackedApps(false);
    },
    [fetchTrackedApps]
  );

  const handleDeleteTrackedApp = useCallback(
    (id) => {
      return new Promise((resolve, reject) => {
        let isResolved = false;

        const handleConfirm = async () => {
          if (isResolved) return;
          isResolved = true;

          try {
            const result = await graphqlClient
              .mutation(DELETE_TRACKED_APP_MUTATION, { id })
              .toPromise();
            if (!result.error && result.data?.deleteTrackedApp?.success) {
              await fetchTrackedApps(false); // Silent refresh after delete
              setConfirmDialog({
                isOpen: false,
                title: "",
                message: "",
                onConfirm: null,
                onClose: null,
                variant: "danger",
              });
              resolve();
            } else {
              const error =
                result.error?.message ||
                result.data?.deleteTrackedApp?.message ||
                "Failed to delete tracked app";
              setTrackedAppError(error);
              setConfirmDialog({
                isOpen: false,
                title: "",
                message: "",
                onConfirm: null,
                onClose: null,
                variant: "danger",
              });
              reject(new Error(error));
            }
          } catch (err) {
            const error = err.response?.data?.error || "Failed to delete tracked app";
            setTrackedAppError(error);
            setConfirmDialog({
              isOpen: false,
              title: "",
              message: "",
              onConfirm: null,
              onClose: null,
            });
            reject(new Error(error));
          }
        };

        const handleCancel = () => {
          if (isResolved) return;
          isResolved = true;
          setConfirmDialog({
            isOpen: false,
            title: "",
            message: "",
            onConfirm: null,
            onClose: null,
          });
          reject(new Error("Deletion cancelled"));
        };

        setConfirmDialog({
          isOpen: true,
          title: "Delete Tracked App",
          message: "Are you sure you want to remove this tracked app?",
          onConfirm: handleConfirm,
          onClose: handleCancel,
        });
      });
    },
    [fetchTrackedApps]
  );

  const handleUpgradeTrackedApp = useCallback(
    (id, latestVersion, appName) => {
      return new Promise((resolve, reject) => {
        let isResolved = false;

        const handleConfirm = async () => {
          if (isResolved) return;
          isResolved = true;

          try {
            const result = await graphqlClient
              .mutation(UPDATE_TRACKED_APP_MUTATION, {
                id,
                input: { currentVersion: latestVersion, isUpgrade: true }, // explicit upgrade
              })
              .toPromise();
            if (!result.error && result.data?.updateTrackedApp) {
              await fetchTrackedApps(false); // Silent refresh after upgrade
              setConfirmDialog({
                isOpen: false,
                title: "",
                message: "",
                onConfirm: null,
                onClose: null,
                variant: "danger",
              });
              resolve();
            } else {
              const error = result.error?.message || "Failed to update current version";
              setTrackedAppError(error);
              setConfirmDialog({
                isOpen: false,
                title: "",
                message: "",
                onConfirm: null,
                onClose: null,
                variant: "danger",
              });
              reject(new Error(error));
            }
          } catch (err) {
            const error = err.message || "Failed to update current version";
            setTrackedAppError(error);
            setConfirmDialog({
              isOpen: false,
              title: "",
              message: "",
              onConfirm: null,
              onClose: null,
            });
            reject(new Error(error));
          }
        };

        const handleCancel = () => {
          if (isResolved) return;
          isResolved = true;
          setConfirmDialog({
            isOpen: false,
            title: "",
            message: "",
            onConfirm: null,
            onClose: null,
          });
          reject(new Error("Upgrade cancelled"));
        };

        const displayName = appName || "this tracked app";
        setConfirmDialog({
          isOpen: true,
          title: "Mark as Upgraded?",
          message: `Are you sure you want to mark ${displayName} as upgraded to version ${latestVersion}?`,
          onConfirm: handleConfirm,
          onClose: handleCancel,
          variant: "success", // Use green success variant like upgrade modal
        });
      });
    },
    [fetchTrackedApps, setConfirmDialog]
  );

  const handleEditTrackedApp = useCallback((app) => {
    setEditingTrackedAppData(app);
    setShowAddTrackedAppModal(true);
  }, []);

  const handleCheckTrackedAppsUpdates = useCallback(async () => {
    const gen = getSessionGeneration();
    setCheckingUpdates(true);
    setTrackedAppError("");
    try {
      const result = await graphqlClient.mutation(CHECK_TRACKED_APP_UPDATES_MUTATION).toPromise();
      // Logout mid-flight: stop the chain, the next mutation would run under
      // whoever is signed in now.
      if (isSessionStale(gen)) return;
      if (!result.error && result.data?.checkTrackedAppUpdates?.success) {
        await fetchTrackedApps({ showRefreshing: true });
        if (isSessionStale(gen)) return;
        setLastScanTime(new Date());
        // Set success briefly to trigger checkmark, then clear immediately
        setTrackedAppSuccess("success");
        setTimeout(() => setTrackedAppSuccess(""), 100);
      }
    } catch (err) {
      if (isSessionStale(gen)) return;
      setTrackedAppError(err.message || "Failed to check for updates");
    } finally {
      if (!isSessionStale(gen)) setCheckingUpdates(false);
    }
  }, [fetchTrackedApps]);

  // Batch handler for tracked apps updates check
  const handleBatchTrackedAppsCheck = useCallback(async () => {
    // Captured before the first mutation: every step of this chain must be
    // abandoned if the session ends, or a dead session's batch run gets
    // driven under the current user's credentials.
    const gen = getSessionGeneration();
    let runId = null;
    const logs = [];

    const log = (message) => {
      const timestamp = new Date().toISOString();
      const logEntry = `[${timestamp}] ${message}`;
      logs.push(logEntry);
      console.log(logEntry);
    };

    try {
      // Create batch run record
      log("Starting tracked apps batch check process...");
      const runResult = await graphqlClient
        .mutation(CREATE_BATCH_RUN_MUTATION, { jobType: "TRACKED_APPS_CHECK" })
        .toPromise();
      if (isSessionStale(gen)) return;
      if (runResult.error || !runResult.data?.createBatchRun?.id) {
        throw new Error(runResult.error?.message || "Failed to create batch run");
      }
      runId = runResult.data.createBatchRun.id;
      log(`Batch run ${runId} created`);

      setCheckingUpdates(true);
      log("🔄 Checking for tracked app updates...");

      // Start the check operation
      log("Initiating tracked apps update check...");
      const result = await graphqlClient.mutation(CHECK_TRACKED_APP_UPDATES_MUTATION).toPromise();
      if (isSessionStale(gen)) return;

      if (!result.error && result.data?.checkTrackedAppUpdates?.success) {
        log("Tracked apps check completed successfully");

        // Fetch updated tracked apps to get accurate counts and update UI in one call
        await fetchTrackedApps(false);
        if (isSessionStale(gen)) return;
        const updatedApps = cachedTrackedApps || [];
        const appsChecked = updatedApps.length;
        const appsWithUpdates = updatedApps.filter((app) => Boolean(app.hasUpdate)).length;
        log(`Processed ${appsChecked} tracked apps, ${appsWithUpdates} with updates available`);

        setLastScanTime(new Date());

        // Update batch run as completed
        if (runId) {
          await graphqlClient
            .mutation(UPDATE_BATCH_RUN_MUTATION, {
              id: runId,
              status: "COMPLETED",
              containersChecked: appsChecked,
              containersUpdated: appsWithUpdates,
              logs: logs.join("\n"),
            })
            .toPromise();
          if (isSessionStale(gen)) return;
          log(`Batch run ${runId} marked as completed`);
        }
      } else {
        throw new Error(result.error?.message || "Failed to check tracked apps");
      }
    } catch (err) {
      let errorMessage =
        err.response?.data?.error ||
        err.response?.data?.message ||
        err.message ||
        "Failed to check tracked apps";
      log(`❌ Error: ${errorMessage}`);
      console.error("Error checking tracked apps:", err);

      // Update batch run as failed
      if (runId && !isSessionStale(gen)) {
        try {
          await graphqlClient
            .mutation(UPDATE_BATCH_RUN_MUTATION, {
              id: runId,
              status: "FAILED",
              errorMessage,
              logs: logs.join("\n"),
            })
            .toPromise();
          log(`Batch run ${runId} marked as failed`);
        } catch (updateErr) {
          console.error("Error updating batch run:", updateErr);
        }
      }
    } finally {
      if (!isSessionStale(gen)) setCheckingUpdates(false);
      log("Tracked apps batch check process finished (success or failure)");
    }
  }, [fetchTrackedApps]);

  const handleClearGitHubCache = useCallback(() => {
    setConfirmDialog({
      isOpen: true,
      title: "Clear Latest Version Data",
      message:
        "Are you sure you want to clear the latest version data for all tracked apps? This will reset the 'Latest' version information and force fresh data to be fetched on the next check.",
      onConfirm: async () => {
        try {
          setClearingGitHubCache(true);
          setTrackedAppError(null);

          const result = await graphqlClient.mutation(CLEAR_TRACKED_APP_CACHE_MUTATION).toPromise();

          if (!result.error && result.data?.clearTrackedAppCache?.success) {
            const message =
              result.data.clearTrackedAppCache.message ||
              "Latest version data cleared successfully";
            setTrackedAppSuccess(message);
            setTimeout(() => setTrackedAppSuccess(""), SHORT_SUCCESS_MESSAGE_DURATION);

            // Refresh tracked apps to show updated data
            await fetchTrackedApps(false); // Silent refresh after cache clear
          } else {
            setTrackedAppError("Failed to clear latest version data");
          }
        } catch (err) {
          const errorMessage = err.message || "Failed to clear latest version data";
          setTrackedAppError(errorMessage);
          console.error("Error clearing latest version data:", err);
        } finally {
          setClearingGitHubCache(false);
          setConfirmDialog({ isOpen: false, title: "", message: "", onConfirm: null });
        }
      },
    });
  }, [fetchTrackedApps]);

  return {
    // State
    trackedApps,
    isLoading,
    hasLoadedOnce,
    trackedAppError,
    trackedAppSuccess,
    checkingUpdates,
    lastScanTime,
    editingTrackedAppData,
    showAddTrackedAppModal,
    clearingGitHubCache,
    // Actions
    fetchTrackedApps,
    handleTrackedAppModalSuccess,
    handleDeleteTrackedApp,
    handleUpgradeTrackedApp,
    handleEditTrackedApp,
    handleCheckTrackedAppsUpdates,
    handleBatchTrackedAppsCheck,
    handleClearGitHubCache,
    // Setters
    setTrackedApps,
    setTrackedAppError,
    setTrackedAppSuccess,
    setEditingTrackedAppData,
    setShowAddTrackedAppModal,
    confirmDialog,
    setConfirmDialog,
  };
}
