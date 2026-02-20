/**
 * Custom hook for Intents functionality
 * Manages state and operations for automated upgrade intents
 */

import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../utils/api";
import { SHORT_SUCCESS_MESSAGE_DURATION } from "../constants/intents";

/**
 * Transform a snake_case intent row from the API to camelCase for frontend consumption.
 * @param {Object} row - API intent object with snake_case keys
 * @returns {Object} - Intent with camelCase keys
 */
function transformIntent(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    enabled: Boolean(row.enabled),
    matchContainers: row.match_containers || [],
    matchImages: row.match_images || [],
    matchInstances: row.match_instances || [],
    matchStacks: row.match_stacks || [],
    matchRegistries: row.match_registries || [],
    scheduleType: row.schedule_type,
    scheduleCron: row.schedule_cron,
    dryRun: Boolean(row.dry_run),
    lastEvaluatedAt: row.last_evaluated_at,
    lastExecutionId: row.last_execution_id,
    lastExecutionStatus: row.last_execution_status || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Transform a snake_case execution row from the API to camelCase.
 * @param {Object} row - API execution object
 * @returns {Object} - Execution with camelCase keys
 */
function transformExecution(row) {
  if (!row) return null;
  return {
    id: row.id,
    intentId: row.intent_id,
    userId: row.user_id,
    status: row.status,
    triggerType: row.trigger_type,
    containersMatched: row.containers_matched,
    containersUpgraded: row.containers_upgraded,
    containersFailed: row.containers_failed,
    containersSkipped: row.containers_skipped,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    // Join fields from recent executions query
    intentName: row.intent_name,
  };
}

/**
 * Transform a snake_case execution container row from the API to camelCase.
 * @param {Object} row - API execution container object
 * @returns {Object} - Execution container with camelCase keys
 */
function transformExecutionContainer(row) {
  if (!row) return null;
  return {
    id: row.id,
    executionId: row.execution_id,
    containerId: row.container_id,
    containerName: row.container_name,
    imageName: row.image_name,
    portainerInstanceId: row.portainer_instance_id,
    status: row.status,
    oldImage: row.old_image,
    newImage: row.new_image,
    oldDigest: row.old_digest,
    newDigest: row.new_digest,
    errorMessage: row.error_message,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  };
}

/**
 * Custom hook for managing intents
 * @param {boolean} [isAuthenticated] - Whether user is authenticated
 * @param {string} [authToken] - Authentication token
 * @returns {Object} Intents state and handlers
 */
export function useIntents(isAuthenticated, authToken) {
  const hasAuth =
    isAuthenticated !== undefined
      ? isAuthenticated
      : !!(axios.defaults.headers.common["Authorization"] || localStorage.getItem("authToken"));
  const effectiveToken = authToken !== undefined ? authToken : localStorage.getItem("authToken");

  const [intents, setIntents] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [editingIntentData, setEditingIntentData] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: null,
    onClose: null,
    variant: "danger",
  });

  // Fetch all intents
  const fetchIntents = useCallback(
    async (showLoading = false) => {
      if (!hasAuth || !effectiveToken) return;
      try {
        if (showLoading) setIsLoading(true);
        const response = await axios.get(`${API_BASE_URL}/api/intents`);
        if (response.data.success) {
          const transformed = (response.data.intents || []).map(transformIntent);
          setIntents(transformed);
          setHasLoadedOnce(true);
        }
      } catch (err) {
        console.error("Error fetching intents:", err);
        if (showLoading) {
          setError(err.response?.data?.error || "Failed to fetch intents");
        }
      } finally {
        setIsLoading(false);
      }
    },
    [hasAuth, effectiveToken]
  );

  // Fetch intents on mount
  useEffect(() => {
    if (hasAuth && effectiveToken) {
      fetchIntents();
    }
  }, [hasAuth, effectiveToken, fetchIntents]);

  // Create a new intent
  const handleCreateIntent = useCallback(
    async (intentData) => {
      try {
        const response = await axios.post(`${API_BASE_URL}/api/intents`, intentData);
        if (response.data.success) {
          await fetchIntents(false);
          return { success: true, intent: response.data.intent };
        }
        return { success: false, error: response.data.error || "Failed to create intent" };
      } catch (err) {
        const errorMsg = err.response?.data?.error || "Failed to create intent";
        return { success: false, error: errorMsg };
      }
    },
    [fetchIntents]
  );

  // Update an existing intent
  const handleUpdateIntent = useCallback(
    async (id, intentData) => {
      try {
        const response = await axios.put(`${API_BASE_URL}/api/intents/${id}`, intentData);
        if (response.data.success) {
          await fetchIntents(false);
          return { success: true, intent: response.data.intent };
        }
        return { success: false, error: response.data.error || "Failed to update intent" };
      } catch (err) {
        const errorMsg = err.response?.data?.error || "Failed to update intent";
        return { success: false, error: errorMsg };
      }
    },
    [fetchIntents]
  );

  // Delete an intent
  const handleDeleteIntent = useCallback(
    (id, name) => {
      return new Promise((resolve, reject) => {
        let isResolved = false;

        const handleConfirm = async () => {
          if (isResolved) return;
          isResolved = true;

          try {
            const response = await axios.delete(`${API_BASE_URL}/api/intents/${id}`);
            if (response.data.success) {
              await fetchIntents(false);
              setConfirmDialog({
                isOpen: false,
                title: "",
                message: "",
                onConfirm: null,
                onClose: null,
                variant: "danger",
              });
              setSuccess("Intent deleted successfully");
              setTimeout(() => setSuccess(""), SHORT_SUCCESS_MESSAGE_DURATION);
              resolve();
            } else {
              const error = response.data.error || "Failed to delete intent";
              setError(error);
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
            const error = err.response?.data?.error || "Failed to delete intent";
            setError(error);
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

        const displayName = name || "this intent";
        setConfirmDialog({
          isOpen: true,
          title: "Delete Intent",
          message: `Are you sure you want to delete "${displayName}"? This action cannot be undone.`,
          onConfirm: handleConfirm,
          onClose: handleCancel,
          variant: "danger",
        });
      });
    },
    [fetchIntents]
  );

  // Toggle an intent enabled/disabled
  const handleToggleIntent = useCallback(
    async (id) => {
      try {
        // Find current intent to send the inverted enabled state
        const current = intents.find((i) => i.id === id);
        const response = await axios.post(`${API_BASE_URL}/api/intents/${id}/toggle`, {
          enabled: current ? !current.enabled : true,
        });
        if (response.data.success) {
          await fetchIntents(false);
          return { success: true };
        }
        return { success: false, error: response.data.error || "Failed to toggle intent" };
      } catch (err) {
        const errorMsg = err.response?.data?.error || "Failed to toggle intent";
        setError(errorMsg);
        return { success: false, error: errorMsg };
      }
    },
    [intents, fetchIntents]
  );

  // Edit an intent (open modal with existing data)
  const handleEditIntent = useCallback((intent) => {
    setEditingIntentData(intent);
    setShowCreateModal(true);
  }, []);

  // Handle modal success (after create or edit)
  const handleModalSuccess = useCallback(async () => {
    await fetchIntents(false);
  }, [fetchIntents]);

  // Execute an intent manually
  const handleExecuteIntent = useCallback(
    async (id) => {
      try {
        const response = await axios.post(`${API_BASE_URL}/api/intents/${id}/execute`);
        if (response.data.success) {
          await fetchIntents(false);
          setSuccess("Intent executed successfully");
          setTimeout(() => setSuccess(""), SHORT_SUCCESS_MESSAGE_DURATION);
          return { success: true, execution: response.data.execution };
        }
        return { success: false, error: response.data.error || "Failed to execute intent" };
      } catch (err) {
        const errorMsg = err.response?.data?.error || "Failed to execute intent";
        setError(errorMsg);
        return { success: false, error: errorMsg };
      }
    },
    [fetchIntents]
  );

  // Dry-run an intent
  const handleDryRunIntent = useCallback(async (id) => {
    try {
      const response = await axios.post(`${API_BASE_URL}/api/intents/${id}/dry-run`);
      if (response.data.success) {
        return { success: true, execution: response.data.execution };
      }
      return { success: false, error: response.data.error || "Failed to dry run intent" };
    } catch (err) {
      const errorMsg = err.response?.data?.error || "Failed to dry run intent";
      setError(errorMsg);
      return { success: false, error: errorMsg };
    }
  }, []);

  // Fetch execution history for an intent
  const fetchExecutions = useCallback(async (intentId, limit = 50) => {
    try {
      const response = await axios.get(
        `${API_BASE_URL}/api/intents/${intentId}/executions?limit=${limit}`
      );
      if (response.data.success) {
        return {
          success: true,
          executions: (response.data.executions || []).map(transformExecution),
        };
      }
      return { success: false, error: "Failed to fetch executions" };
    } catch (err) {
      return { success: false, error: err.response?.data?.error || "Failed to fetch executions" };
    }
  }, []);

  // Fetch recent executions across all intents
  const fetchRecentExecutions = useCallback(async (limit = 20) => {
    try {
      const response = await axios.get(
        `${API_BASE_URL}/api/intents/executions/recent?limit=${limit}`
      );
      if (response.data.success) {
        return {
          success: true,
          executions: (response.data.executions || []).map(transformExecution),
        };
      }
      return { success: false, error: "Failed to fetch recent executions" };
    } catch (err) {
      return {
        success: false,
        error: err.response?.data?.error || "Failed to fetch recent executions",
      };
    }
  }, []);

  // Fetch execution detail with per-container results
  const fetchExecutionDetail = useCallback(async (executionId) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/intents/executions/${executionId}`);
      if (response.data.success) {
        return {
          success: true,
          execution: transformExecution(response.data.execution),
          containers: (response.data.containers || []).map(transformExecutionContainer),
        };
      }
      return { success: false, error: "Failed to fetch execution detail" };
    } catch (err) {
      return {
        success: false,
        error: err.response?.data?.error || "Failed to fetch execution detail",
      };
    }
  }, []);

  return {
    // State
    intents,
    isLoading,
    hasLoadedOnce,
    error,
    success,
    editingIntentData,
    showCreateModal,
    confirmDialog,
    // CRUD Actions
    fetchIntents,
    handleCreateIntent,
    handleUpdateIntent,
    handleDeleteIntent,
    handleToggleIntent,
    handleEditIntent,
    handleModalSuccess,
    // Execution Actions
    handleExecuteIntent,
    handleDryRunIntent,
    fetchExecutions,
    fetchRecentExecutions,
    fetchExecutionDetail,
    // Setters
    setIntents,
    setError,
    setSuccess,
    setEditingIntentData,
    setShowCreateModal,
    setConfirmDialog,
  };
}
