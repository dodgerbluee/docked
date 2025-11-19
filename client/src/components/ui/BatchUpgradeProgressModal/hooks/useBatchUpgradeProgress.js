/**
 * Hook for managing batch upgrade progress state and logic
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import axios from "axios";
import { API_BASE_URL } from "../../../../utils/api";

/**
 * Hook to manage batch upgrade progress
 * @param {boolean} isOpen - Whether modal is open
 * @param {Array} containers - Containers to upgrade
 * @param {Function} onSuccess - Success callback
 * @param {Function} onError - Error callback
 * @param {Function} onClose - Close callback
 * @returns {Object} Progress state and handlers
 */
export const useBatchUpgradeProgress = (isOpen, containers, onSuccess, onError, onClose) => {
  const [stage, setStage] = useState("confirm"); // 'confirm' | 'progress' | 'success' | 'error'
  const [containerStates, setContainerStates] = useState({});
  const [overallError, setOverallError] = useState(null);

  const steps = useMemo(
    () => [
      { label: "Stopping container...", duration: 2000 },
      { label: "Pulling latest image...", duration: 5000 },
      { label: "Removing old container...", duration: 1500 },
      { label: "Creating new container...", duration: 2000 },
      { label: "Starting container...", duration: 2000 },
      { label: "Waiting for container to be ready...", duration: 10000 },
    ],
    []
  );

  // Initialize container states
  useEffect(() => {
    if (isOpen && containers && containers.length > 0) {
      const initialStates = {};
      containers.forEach((container) => {
        initialStates[container.id] = {
          status: "pending", // 'pending' | 'upgrading' | 'success' | 'error'
          error: null,
          currentStep: 0,
        };
      });
      setContainerStates(initialStates);
      setOverallError(null);
    } else if (!isOpen) {
      // Reset when modal closes
      setTimeout(() => {
        setStage("confirm");
        setContainerStates({});
        setOverallError(null);
      }, 300);
    }
  }, [isOpen, containers]);

  const handleConfirm = useCallback(async () => {
    setStage("progress");

    // Initialize all containers as upgrading
    setContainerStates((prev) => {
      const updated = { ...prev };
      Object.keys(updated).forEach((id) => {
        updated[id] = {
          ...updated[id],
          status: "upgrading",
          currentStep: 0,
        };
      });
      return updated;
    });

    try {
      // Make individual upgrade calls for each container concurrently
      // This allows us to track each container's real progress independently
      const upgradePromises = containers.map(async (container) => {
        const startTime = Date.now();
        let apiCompleted = false;

        // Start the actual API call
        const apiCall = axios
          .post(`${API_BASE_URL}/api/containers/${container.id}/upgrade`, {
            endpointId: container.endpointId,
            imageName: container.image,
            portainerUrl: container.portainerUrl,
          })
          .then((result) => {
            apiCompleted = true;
            return result;
          })
          .catch((error) => {
            apiCompleted = true;
            throw error;
          });

        // Progress simulation tied to the actual API call duration
        // Each container progresses independently - steps advance as time passes
        // When API completes, progress immediately finishes
        const progressSimulation = async () => {
          const totalEstimatedTime = steps.reduce((sum, step) => sum + step.duration, 0);

          for (let i = 0; i < steps.length; i++) {
            // Update to current step
            setContainerStates((prev) => ({
              ...prev,
              [container.id]: {
                ...prev[container.id],
                currentStep: i,
              },
            }));

            // Calculate step duration as proportion of total estimated time
            const stepProportion = steps[i].duration / totalEstimatedTime;
            const stepDuration = stepProportion * totalEstimatedTime;

            // Wait for this step duration, checking periodically if API completed
            const stepStart = Date.now();
            while (Date.now() - stepStart < stepDuration) {
              if (apiCompleted) {
                // API finished - jump to final step
                setContainerStates((prev) => ({
                  ...prev,
                  [container.id]: {
                    ...prev[container.id],
                    currentStep: steps.length - 1,
                  },
                }));
                return; // Exit simulation
              }
              await new Promise((resolve) => setTimeout(resolve, 100));
            }
          }

          // If we've gone through all steps but API hasn't completed yet,
          // wait for it and then mark as complete
          while (!apiCompleted) {
            await new Promise((resolve) => setTimeout(resolve, 100));
          }

          setContainerStates((prev) => ({
            ...prev,
            [container.id]: {
              ...prev[container.id],
              currentStep: steps.length - 1,
            },
          }));
        };

        // Run both in parallel - progress will naturally sync with API completion
        await Promise.all([apiCall.catch(() => {}), progressSimulation()]);

        const endTime = Date.now();
        const actualDuration = endTime - startTime;

        // Get the API result (or handle error)
        let apiResult;
        try {
          apiResult = await apiCall;
        } catch (error) {
          return {
            containerId: container.id,
            success: false,
            result: null,
            error: error.response?.data?.error || error.message || "Unknown error occurred",
            duration: actualDuration,
          };
        }

        return {
          containerId: container.id,
          success: apiResult.data?.success || false,
          result: apiResult.data,
          error: null,
          duration: actualDuration,
        };
      });

      // Wait for all upgrades to complete
      const results = await Promise.allSettled(upgradePromises);

      // Process results and update states
      const successfulIds = new Set();
      const errorMap = new Map();
      const allResults = [];

      results.forEach((settledResult, index) => {
        const container = containers[index];
        if (settledResult.status === "fulfilled") {
          const result = settledResult.value;
          if (result.success) {
            successfulIds.add(result.containerId);
            allResults.push(result.result);
          } else {
            errorMap.set(result.containerId, result.error || "Upgrade failed");
          }
        } else {
          const error =
            settledResult.reason?.response?.data?.error ||
            settledResult.reason?.message ||
            "Unknown error occurred";
          errorMap.set(container.id, error);
        }
      });

      // Update container states based on results
      setContainerStates((prev) => {
        const updated = { ...prev };
        Object.keys(updated).forEach((id) => {
          if (successfulIds.has(id)) {
            updated[id] = {
              ...updated[id],
              status: "success",
              currentStep: steps.length - 1,
            };
          } else if (errorMap.has(id)) {
            updated[id] = {
              ...updated[id],
              status: "error",
              error: errorMap.get(id),
            };
          }
        });
        return updated;
      });

      // Small delay to show final states
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Create response object similar to batch upgrade format
      const response = {
        data: {
          success: errorMap.size === 0,
          results: allResults,
          errors: Array.from(errorMap.entries()).map(([containerId, error]) => ({
            containerId,
            error,
          })),
        },
      };

      // Determine overall stage based on results
      const allSuccessful = errorMap.size === 0;
      const hasErrors = errorMap.size > 0;

      if (allSuccessful) {
        setStage("success");
        if (onSuccess) {
          onSuccess(response);
        }
        // Auto-close after 3 seconds
        setTimeout(() => {
          onClose();
        }, 3000);
      } else if (hasErrors) {
        // Show success stage but with error indicators
        setStage("success");
        if (onSuccess) {
          onSuccess(response);
        }
        // Auto-close after 4 seconds to allow viewing errors
        setTimeout(() => {
          onClose();
        }, 4000);
      }
    } catch (error) {
      setOverallError(error.response?.data?.error || error.message || "Unknown error occurred");
      setStage("error");
      if (onError) {
        onError(error);
      }
    }
  }, [containers, onSuccess, onError, onClose, steps]);

  const handleRetry = useCallback(() => {
    setStage("confirm");
    setContainerStates({});
    setOverallError(null);
  }, []);

  // Calculate summary counts
  const completedCount = Object.values(containerStates).filter(
    (state) => state.status === "success" || state.status === "error"
  ).length;
  const successCount = Object.values(containerStates).filter(
    (state) => state.status === "success"
  ).length;
  const errorCount = Object.values(containerStates).filter(
    (state) => state.status === "error"
  ).length;
  const totalCount = containers?.length || 0;

  return {
    stage,
    containerStates,
    overallError,
    steps,
    completedCount,
    successCount,
    errorCount,
    totalCount,
    handleConfirm,
    handleRetry,
    setStage,
  };
};

