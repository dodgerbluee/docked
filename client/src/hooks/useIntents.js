/**
 * Custom hook for Intents functionality
 * Manages state and operations for automated upgrade intents
 * Uses GraphQL for CRUD, execution, dry-run, detail, and preview operations.
 */

import { useState, useEffect, useCallback } from "react";
import { graphqlClient } from "../graphql/client";
import {
  INTENTS_QUERY,
  CREATE_INTENT_MUTATION,
  UPDATE_INTENT_MUTATION,
  DELETE_INTENT_MUTATION,
  TRIGGER_INTENT_MUTATION,
  INTENT_EXECUTIONS_QUERY,
  INTENT_EXECUTION_QUERY,
  INTENT_PREVIEW_QUERY,
  DRY_RUN_INTENT_MUTATION,
} from "../graphql/queries";
import { SHORT_SUCCESS_MESSAGE_DURATION } from "../constants/intents";

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
    sourceInstanceId: row.source_instance_id,
    runnerId: row.runner_id,
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
    isAuthenticated !== undefined ? isAuthenticated : !!localStorage.getItem("authToken");
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

  // Fetch all intents via GraphQL
  const fetchIntents = useCallback(
    async (showLoading = false) => {
      if (!hasAuth || !effectiveToken) return;
      try {
        if (showLoading) setIsLoading(true);
        const result = await graphqlClient.query(INTENTS_QUERY).toPromise();
        // urql reports transport/GraphQL errors on the result, it does not
        // throw: without this a failed fetch looked like "no intents".
        if (result.error) throw new Error(result.error.message);
        if (result.data?.intents) {
          setIntents(result.data.intents);
          setHasLoadedOnce(true);
        }
      } catch (err) {
        console.error("Error fetching intents:", err);
        // Report it even for background refreshes: a silent failure leaves
        // the user looking at a stale (or empty) list with no explanation.
        setError(err.message || "Failed to fetch intents");
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

  // Create a new intent via GraphQL
  const handleCreateIntent = useCallback(
    async (intentData) => {
      try {
        const result = await graphqlClient
          .mutation(CREATE_INTENT_MUTATION, { input: intentData })
          .toPromise();
        if (result.error) {
          return { success: false, error: result.error.message };
        }
        await fetchIntents(false);
        return { success: true, intent: result.data.createIntent };
      } catch (err) {
        return { success: false, error: err.message || "Failed to create intent" };
      }
    },
    [fetchIntents]
  );

  // Update an existing intent via GraphQL
  const handleUpdateIntent = useCallback(
    async (id, intentData) => {
      try {
        const result = await graphqlClient
          .mutation(UPDATE_INTENT_MUTATION, { id, input: intentData })
          .toPromise();
        if (result.error) {
          return { success: false, error: result.error.message };
        }
        await fetchIntents(false);
        return { success: true, intent: result.data.updateIntent };
      } catch (err) {
        return { success: false, error: err.message || "Failed to update intent" };
      }
    },
    [fetchIntents]
  );

  // Delete an intent via GraphQL
  const handleDeleteIntent = useCallback(
    (id, name) => {
      return new Promise((resolve, reject) => {
        let isResolved = false;

        const handleConfirm = async () => {
          if (isResolved) return;
          isResolved = true;

          try {
            const result = await graphqlClient.mutation(DELETE_INTENT_MUTATION, { id }).toPromise();
            if (result.error) throw new Error(result.error.message);
            // The payload carries its own verdict; without this a refused
            // delete closed the dialog and announced success.
            if (!result.data?.deleteIntent?.success) {
              throw new Error(result.data?.deleteIntent?.message || "Failed to delete intent");
            }

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
          } catch (err) {
            const error = err.message || "Failed to delete intent";
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

  // Toggle an intent enabled/disabled via GraphQL updateIntent
  const handleToggleIntent = useCallback(
    async (id) => {
      try {
        const current = intents.find((i) => i.id === id);
        const result = await graphqlClient
          .mutation(UPDATE_INTENT_MUTATION, {
            id,
            input: { enabled: current ? !current.enabled : true },
          })
          .toPromise();
        if (result.error) {
          setError(result.error.message);
          return { success: false, error: result.error.message };
        }
        await fetchIntents(false);
        return { success: true };
      } catch (err) {
        const errorMsg = err.message || "Failed to toggle intent";
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

  // Execute an intent manually (GraphQL triggerIntent)
  const handleExecuteIntent = useCallback(
    async (id) => {
      try {
        const result = await graphqlClient.mutation(TRIGGER_INTENT_MUTATION, { id }).toPromise();
        if (result.error) throw new Error(result.error.message);
        const execution = result.data?.triggerIntent;
        if (execution) {
          await fetchIntents(false);
          // The mutation only queues the run - the row it answers with is
          // normally PENDING or RUNNING, and a FAILED row used to carry the
          // same "executed successfully" toast. Announce what actually happened.
          if (execution.status === "FAILED") {
            const errorMsg = execution.errorMessage || "Intent execution failed";
            setError(errorMsg);
            return { success: false, error: errorMsg, execution };
          }
          const message =
            execution.status === "COMPLETED"
              ? "Intent executed successfully"
              : execution.status === "PARTIAL"
                ? "Intent finished, but some containers failed"
                : "Intent execution started";
          setSuccess(message);
          setTimeout(() => setSuccess(""), SHORT_SUCCESS_MESSAGE_DURATION);
          return { success: true, execution };
        }
        return { success: false, error: "Failed to execute intent" };
      } catch (err) {
        const errorMsg = err.message || "Failed to execute intent";
        setError(errorMsg);
        return { success: false, error: errorMsg };
      }
    },
    [fetchIntents]
  );

  // Dry-run an intent (GraphQL)
  const handleDryRunIntent = useCallback(async (id) => {
    try {
      const result = await graphqlClient.mutation(DRY_RUN_INTENT_MUTATION, { id }).toPromise();
      if (!result.error && result.data?.dryRunIntent) {
        const exec = result.data.dryRunIntent;
        return {
          success: true,
          execution: {
            executionId: Number(exec.id),
            status: exec.status?.toLowerCase(),
            containersMatched: exec.containersMatched,
            containersUpgraded: exec.containersUpgraded,
            containersFailed: exec.containersFailed,
            containersSkipped: exec.containersSkipped,
            durationMs: exec.durationMs,
          },
        };
      }
      const errorMsg = result.error?.message || "Failed to dry run intent";
      // urql never rejects, so this is the normal failure path: without
      // publishing it, the Dry Run button just stops spinning.
      setError(errorMsg);
      return { success: false, error: errorMsg };
    } catch (err) {
      const errorMsg = err.message || "Failed to dry run intent";
      setError(errorMsg);
      return { success: false, error: errorMsg };
    }
  }, []);

  // Fetch execution history for an intent (GraphQL)
  const fetchExecutions = useCallback(async (intentId, limit = 50) => {
    try {
      const result = await graphqlClient
        .query(INTENT_EXECUTIONS_QUERY, { intentId, first: limit })
        .toPromise();
      if (result.error) throw new Error(result.error.message);
      if (result.data?.intentExecutions) {
        return {
          success: true,
          executions: (result.data.intentExecutions.items || []).map((row) => ({
            id: row.id,
            intentId: row.intentId,
            status: row.status?.toLowerCase(),
            triggerType: row.triggerType?.toLowerCase(),
            containersMatched: row.containersMatched,
            containersUpgraded: row.containersUpgraded,
            containersFailed: row.containersFailed,
            containersSkipped: row.containersSkipped,
            errorMessage: row.errorMessage,
            startedAt: row.startedAt,
            completedAt: row.completedAt,
            durationMs: row.durationMs,
            intentName: row.intent?.name,
          })),
        };
      }
      return { success: false, error: "Failed to fetch executions" };
    } catch (err) {
      return { success: false, error: err.message || "Failed to fetch executions" };
    }
  }, []);

  // Fetch intent preview (GraphQL)
  const fetchIntentPreview = useCallback(async (intentId) => {
    try {
      const result = await graphqlClient
        .query(INTENT_PREVIEW_QUERY, { id: String(intentId) })
        .toPromise();
      if (result.error) throw new Error(result.error.message);
      const preview = result.data?.previewIntent;
      if (!preview) throw new Error("Failed to fetch preview");
      // Map to the shape the preview/matches tabs consume.
      return {
        success: true,
        currentMatches: preview.currentMatches || [],
        excludedContainers: preview.excludedContainers || [],
        nextExecutionPreview: { containers: preview.nextExecutionPreview || [] },
      };
    } catch (err) {
      throw new Error(err.message || "Failed to fetch preview", { cause: err });
    }
  }, []);

  // Fetch recent executions across all intents (GraphQL)
  const fetchRecentExecutions = useCallback(async (limit = 20) => {
    try {
      const result = await graphqlClient
        .query(INTENT_EXECUTIONS_QUERY, { first: limit })
        .toPromise();
      if (result.error) throw new Error(result.error.message);
      if (result.data?.intentExecutions) {
        return {
          success: true,
          executions: (result.data.intentExecutions.items || []).map((row) => ({
            id: row.id,
            intentId: row.intentId,
            status: row.status?.toLowerCase(),
            triggerType: row.triggerType?.toLowerCase(),
            containersMatched: row.containersMatched,
            containersUpgraded: row.containersUpgraded,
            containersFailed: row.containersFailed,
            containersSkipped: row.containersSkipped,
            errorMessage: row.errorMessage,
            startedAt: row.startedAt,
            completedAt: row.completedAt,
            durationMs: row.durationMs,
            intentName: row.intent?.name,
          })),
        };
      }
      return { success: false, error: "Failed to fetch recent executions" };
    } catch (err) {
      return {
        success: false,
        error: err.message || "Failed to fetch recent executions",
      };
    }
  }, []);

  // Fetch execution detail with per-container results (GraphQL)
  const fetchExecutionDetail = useCallback(async (executionId) => {
    try {
      const result = await graphqlClient
        .query(INTENT_EXECUTION_QUERY, { id: executionId })
        .toPromise();
      if (!result.error && result.data?.intentExecution) {
        const exec = result.data.intentExecution;
        return {
          success: true,
          execution: transformExecution({
            id: Number(exec.id),
            intent_id: Number(exec.intentId),
            status: exec.status?.toLowerCase(),
            trigger_type: exec.triggerType?.toLowerCase(),
            containers_matched: exec.containersMatched,
            containers_upgraded: exec.containersUpgraded,
            containers_failed: exec.containersFailed,
            containers_skipped: exec.containersSkipped,
            error_message: exec.errorMessage,
            started_at: exec.startedAt,
            completed_at: exec.completedAt,
            duration_ms: exec.durationMs,
            intent_name: exec.intent?.name,
          }),
          containers: (exec.containers?.items || []).map((c) =>
            transformExecutionContainer({
              id: Number(c.id),
              execution_id: Number(c.executionId),
              container_id: c.dockerContainerId,
              container_name: c.containerName,
              image_name: c.imageName,
              source_instance_id: c.sourceInstanceId ? Number(c.sourceInstanceId) : null,
              runner_id: c.runnerId ? Number(c.runnerId) : null,
              status: c.status?.toLowerCase(),
              old_image: c.oldImage,
              new_image: c.newImage,
              old_digest: c.oldDigest,
              new_digest: c.newDigest,
              error_message: c.errorMessage,
              duration_ms: c.durationMs,
              created_at: c.createdAt,
            })
          ),
        };
      }
      return { success: false, error: "Failed to fetch execution detail" };
    } catch (err) {
      return {
        success: false,
        error: err.response?.data?.error || err.message || "Failed to fetch execution detail",
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
    fetchIntentPreview,
    // Setters
    setIntents,
    setError,
    setSuccess,
    setEditingIntentData,
    setShowCreateModal,
    setConfirmDialog,
  };
}
