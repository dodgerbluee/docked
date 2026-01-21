/**
 * Custom hook for Tracked Apps functionality
 * Manages state and operations for tracked Docker images and GitHub repositories
 */

import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { parseUTCTimestamp } from "../utils/formatters";
import { API_BASE_URL } from "../utils/api";
import {
  // SUCCESS_MESSAGE_DURATION is not currently used but kept for potential future use
  SHORT_SUCCESS_MESSAGE_DURATION,
  DATABASE_UPDATE_DELAY,
} from "../constants/trackedApps";

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
  const [trackedApps, setTrackedApps] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false); // Track if we've loaded data at least once
  const [trackedAppError, setTrackedAppError] = useState("");
  const [trackedAppSuccess, setTrackedAppSuccess] = useState("");
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [lastScanTime, setLastScanTime] = useState(null);
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

  const fetchTrackedApps = useCallback(async (showLoading = false) => {
    if (!hasAuth || !effectiveToken) {
      return;
    }
    try {
      // Only show loading state if explicitly requested (e.g., user clicks "Check for Updates")
      // Don't show loading on initial mount - just populate data when it arrives
      if (showLoading) {
        setIsLoading(true);
      }
      const response = await axios.get(`${API_BASE_URL}/api/tracked-apps`);
      if (response.data.success) {
        const apps = response.data.images || [];

        // Sort alphabetically by name
        const sortedApps = apps.sort((a, b) => {
          const nameA = (a.name || "").toLowerCase();
          const nameB = (b.name || "").toLowerCase();
          return nameA.localeCompare(nameB);
        });

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
            setLastScanTime(parseUTCTimestamp(mostRecentCheck));
          }
        }
      }
    } catch (err) {
      console.error("Error fetching tracked apps:", err);
    } finally {
      setIsLoading(false);
    }
  }, [hasAuth, effectiveToken]);

  // Fetch tracked apps on mount (only if authenticated)
  useEffect(() => {
    if (hasAuth && effectiveToken) {
      fetchTrackedApps();
    }
  }, [hasAuth, effectiveToken, fetchTrackedApps]);

  const handleTrackedAppModalSuccess = useCallback(
    async (appId) => {
      await fetchTrackedApps(false); // Silent refresh after add/edit

      // If we have an app ID, check the version for that specific app
      if (appId) {
        try {
          await axios.post(`${API_BASE_URL}/api/tracked-apps/${appId}/check-update`);
          // Refresh tracked apps after version check to get updated version info
          await fetchTrackedApps(false); // Silent refresh after version check
        } catch (err) {
          // Silently fail - version check is not critical, just a nice-to-have
          console.error("Error checking version for tracked app:", err);
        }
      }

      // No success message for add/edit - modal closing is sufficient feedback
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
            const response = await axios.delete(`${API_BASE_URL}/api/tracked-apps/${id}`);
            if (response.data.success) {
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
              const error = response.data.error || "Failed to delete tracked app";
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
            const response = await axios.put(`${API_BASE_URL}/api/tracked-apps/${id}`, {
              current_version: latestVersion,
              isUpgrade: true, // Flag to indicate this is an explicit upgrade
            });
            if (response.data.success) {
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
              const error = response.data.error || "Failed to update current version";
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
            const error = err.response?.data?.error || "Failed to update current version";
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
    setCheckingUpdates(true);
    setTrackedAppError("");
    try {
      const response = await axios.post(`${API_BASE_URL}/api/tracked-apps/check-updates`);
      if (response.data.success) {
        // Wait a moment for database updates to complete before fetching
        await new Promise((resolve) => setTimeout(resolve, 500));
        await fetchTrackedApps({ showRefreshing: true });
        setLastScanTime(new Date());
        // Set success briefly to trigger checkmark, then clear immediately
        setTrackedAppSuccess("success");
        setTimeout(() => setTrackedAppSuccess(""), 100);
      }
    } catch (err) {
      setTrackedAppError(err.response?.data?.error || "Failed to check for updates");
    } finally {
      setCheckingUpdates(false);
    }
  }, [fetchTrackedApps]);

  // Batch handler for tracked apps updates check
  const handleBatchTrackedAppsCheck = useCallback(async () => {
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
      const runResponse = await axios.post(`${API_BASE_URL}/api/batch/runs`, {
        status: "running",
        jobType: "tracked-apps-check",
      });
      runId = runResponse.data.runId;
      log(`Batch run ${runId} created`);

      setCheckingUpdates(true);
      log("🔄 Checking for tracked app updates...");

      // Start the check operation
      log("Initiating tracked apps update check...");
      const response = await axios.post(
        `${API_BASE_URL}/api/tracked-apps/check-updates`,
        {},
        {
          timeout: 300000, // 5 minute timeout
        }
      );

      if (response.data.success) {
        log("Tracked apps check completed successfully");

        // Wait a moment for database updates to complete
        await new Promise((resolve) => setTimeout(resolve, DATABASE_UPDATE_DELAY));

        // Fetch updated tracked apps to get accurate counts
        const updatedResponse = await axios.get(`${API_BASE_URL}/api/tracked-apps`);
        if (!updatedResponse.data.success) {
          throw new Error("Failed to fetch updated tracked apps");
        }
        const updatedApps = updatedResponse.data.images || [];
        const appsChecked = updatedApps.length;
        const appsWithUpdates = updatedApps.filter((app) => Boolean(app.has_update)).length;
        log(`Processed ${appsChecked} tracked apps, ${appsWithUpdates} with updates available`);

        // Update UI state
        await fetchTrackedApps(false); // Silent refresh after batch check
        setLastScanTime(new Date());

        // Update batch run as completed
        if (runId) {
          await axios.put(`${API_BASE_URL}/api/batch/runs/${runId}`, {
            status: "completed",
            containersChecked: appsChecked,
            containersUpdated: appsWithUpdates,
            logs: logs.join("\n"),
          });
          log(`Batch run ${runId} marked as completed`);
        }
      } else {
        throw new Error(response.data.error || "Failed to check tracked apps");
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
      if (runId) {
        try {
          await axios.put(`${API_BASE_URL}/api/batch/runs/${runId}`, {
            status: "failed",
            errorMessage,
            logs: logs.join("\n"),
          });
          log(`Batch run ${runId} marked as failed`);
        } catch (updateErr) {
          console.error("Error updating batch run:", updateErr);
        }
      }
    } finally {
      setCheckingUpdates(false);
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
          console.log("🗑️ Clearing latest version data for tracked apps...");

          const response = await axios.delete(`${API_BASE_URL}/api/tracked-apps/cache`);

          if (response.data && response.data.success) {
            console.log("✅ Latest version data cleared successfully");
            const message = response.data.message || "Latest version data cleared successfully";
            setTrackedAppSuccess(message);
            setTimeout(() => setTrackedAppSuccess(""), SHORT_SUCCESS_MESSAGE_DURATION);

            // Refresh tracked apps to show updated data
            await fetchTrackedApps(false); // Silent refresh after cache clear
          } else {
            setTrackedAppError("Failed to clear latest version data");
          }
        } catch (err) {
          const errorMessage =
            err.response?.data?.error ||
            err.response?.data?.message ||
            err.message ||
            "Failed to clear latest version data";
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
