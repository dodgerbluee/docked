import React, { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import { CheckCircle2, Loader2, AlertCircle, XCircle } from "lucide-react";
import axios from "axios";
import Modal from "./Modal";
import Button from "./Button";
import { API_BASE_URL } from "../../utils/api";
import styles from "./BatchUpgradeProgressModal.module.css";

/**
 * BatchUpgradeProgressModal Component
 * Shows confirmation, progress updates, and results for batch container upgrades
 */
const BatchUpgradeProgressModal = React.memo(function BatchUpgradeProgressModal({
  isOpen,
  onClose,
  containers,
  onConfirm,
  onSuccess,
  onError,
  onNavigateToLogs,
}) {
  const [stage, setStage] = useState("confirm"); // 'confirm' | 'progress' | 'success' | 'error'
  const [containerStates, setContainerStates] = useState({});
  const [overallError, setOverallError] = useState(null);

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

  const steps = [
    { label: "Stopping container...", duration: 2000 },
    { label: "Pulling latest image...", duration: 5000 },
    { label: "Removing old container...", duration: 1500 },
    { label: "Creating new container...", duration: 2000 },
    { label: "Starting container...", duration: 2000 },
    { label: "Waiting for container to be ready...", duration: 10000 },
  ];

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
        let apiError = null;

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
            apiError = error;
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

  const handleClose = useCallback(() => {
    // Only allow closing if not in progress
    if (stage === "confirm" || stage === "success" || stage === "error") {
      onClose();
    }
  }, [stage, onClose]);

  const handleRetry = useCallback(() => {
    setStage("confirm");
    setContainerStates({});
    setOverallError(null);
  }, []);

  if (!isOpen || !containers || containers.length === 0) return null;

  const completedCount = Object.values(containerStates).filter(
    (state) => state.status === "success" || state.status === "error"
  ).length;
  const successCount = Object.values(containerStates).filter(
    (state) => state.status === "success"
  ).length;
  const errorCount = Object.values(containerStates).filter(
    (state) => state.status === "error"
  ).length;
  const totalCount = containers.length;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      size="lg"
      showCloseButton={stage !== "progress"}
      className={styles.modal}
    >
      <div className={styles.content}>
        {/* Confirmation Stage */}
        {stage === "confirm" && (
          <div className={styles.confirmStage}>
            <div className={styles.iconContainer}>
              <AlertCircle size={48} className={styles.warningIcon} />
            </div>
            <h3 className={styles.title}>
              Upgrade {totalCount} Container{totalCount !== 1 ? "s" : ""}?
            </h3>
            <p className={styles.message}>
              Are you sure you want to upgrade{" "}
              <strong>
                {totalCount} selected container{totalCount !== 1 ? "s" : ""}
              </strong>
              ?
            </p>
            <p className={styles.warning}>
              Each container will be stopped, removed, and recreated with the latest image. This may
              cause brief service interruptions. Containers will be upgraded concurrently.
            </p>
            <div className={styles.containerList}>
              <div className={styles.containerGrid}>
                {containers.slice(0, 8).map((container) => (
                  <div key={container.id} className={styles.containerBadge}>
                    <span className={styles.containerBadgeName}>{container.name}</span>
                  </div>
                ))}
              </div>
              {containers.length > 8 && (
                <div className={styles.containerMore}>
                  +{containers.length - 8} more container{containers.length - 8 !== 1 ? "s" : ""}
                </div>
              )}
            </div>
            <div className={styles.actions}>
              <Button variant="outline" onClick={handleClose} className={styles.cancelButton}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleConfirm} className={styles.confirmButton}>
                Yes, Upgrade All
              </Button>
            </div>
          </div>
        )}

        {/* Progress Stage */}
        {stage === "progress" && (
          <div className={styles.progressStage}>
            <div className={styles.progressHeader}>
              <div className={styles.progressIconContainer}>
                <Loader2 size={32} className={styles.spinner} />
              </div>
              <div className={styles.progressInfo}>
                <h3 className={styles.title}>Upgrading Containers</h3>
                <p className={styles.progressText}>
                  {completedCount} of {totalCount} completed
                  {successCount > 0 && ` • ${successCount} successful`}
                  {errorCount > 0 && ` • ${errorCount} failed`}
                </p>
              </div>
            </div>
            <div className={styles.containersList}>
              {containers.map((container) => {
                const containerState = containerStates[container.id] || {
                  status: "pending",
                  currentStep: 0,
                };
                const isActive = containerState.status === "upgrading";
                const isCompleted = containerState.status === "success";
                const isError = containerState.status === "error";
                const isPending = containerState.status === "pending";

                return (
                  <div
                    key={container.id}
                    className={`${styles.containerProgressItem} ${
                      isActive ? styles.containerActive : ""
                    } ${isCompleted ? styles.containerCompleted : ""} ${
                      isError ? styles.containerError : ""
                    } ${isPending ? styles.containerPending : ""}`}
                  >
                    <div className={styles.containerProgressHeader}>
                      <div className={styles.containerStatusIcon}>
                        {isCompleted ? (
                          <CheckCircle2 size={20} className={styles.checkIcon} />
                        ) : isError ? (
                          <XCircle size={20} className={styles.errorIcon} />
                        ) : isActive ? (
                          <Loader2 size={20} className={styles.stepSpinner} />
                        ) : (
                          <div className={styles.stepDot} />
                        )}
                      </div>
                      <span className={styles.containerName}>{container.name}</span>
                    </div>
                    {isActive && containerState.currentStep !== undefined && (
                      <div className={styles.containerStep}>
                        {steps[containerState.currentStep]?.label || "Processing..."}
                      </div>
                    )}
                    {isError && containerState.error && (
                      <div className={styles.containerErrorText}>{containerState.error}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Success Stage */}
        {stage === "success" && (
          <div className={styles.successStage}>
            <div className={styles.iconContainer}>
              <CheckCircle2 size={64} className={styles.successIcon} />
            </div>
            <h3 className={styles.title}>
              {errorCount === 0 ? "All Upgrades Complete!" : "Upgrades Completed with Errors"}
            </h3>
            <p className={styles.message}>
              {successCount > 0 && (
                <>
                  <strong>{successCount}</strong> container{successCount !== 1 ? "s" : ""} upgraded
                  successfully.
                </>
              )}
              {errorCount > 0 && (
                <>
                  <br />
                  <strong>{errorCount}</strong> container{errorCount !== 1 ? "s" : ""} failed to
                  upgrade.
                </>
              )}
            </p>
            {errorCount > 0 && (
              <>
                <div className={styles.errorList}>
                  {containers
                    .filter((c) => containerStates[c.id]?.status === "error")
                    .map((container) => (
                      <div key={container.id} className={styles.errorItem}>
                        <XCircle size={16} className={styles.errorIconSmall} />
                        <span className={styles.errorItemName}>{container.name}</span>
                        <span className={styles.errorItemMessage}>
                          {containerStates[container.id]?.error || "Unknown error"}
                        </span>
                      </div>
                    ))}
                </div>
                {onNavigateToLogs && (
                  <div className={styles.actions}>
                    <Button
                      variant="outline"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onNavigateToLogs();
                      }}
                      className={styles.viewLogsButton}
                    >
                      View Logs
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Error Stage */}
        {stage === "error" && overallError && (
          <div className={styles.errorStage}>
            <div className={styles.iconContainer}>
              <AlertCircle size={48} className={styles.errorIcon} />
            </div>
            <h3 className={styles.title}>Batch Upgrade Failed</h3>
            <p className={styles.message}>Failed to start batch upgrade</p>
            <div className={styles.errorMessage}>{overallError}</div>
            <div className={styles.actions}>
              {onNavigateToLogs && (
                <Button
                  variant="outline"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onNavigateToLogs();
                  }}
                  className={styles.viewLogsButton}
                >
                  View Logs
                </Button>
              )}
              <Button variant="outline" onClick={handleClose} className={styles.cancelButton}>
                Close
              </Button>
              <Button variant="primary" onClick={handleRetry} className={styles.retryButton}>
                Try Again
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
});

BatchUpgradeProgressModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  containers: PropTypes.arrayOf(PropTypes.object).isRequired,
  onConfirm: PropTypes.func.isRequired,
  onSuccess: PropTypes.func,
  onError: PropTypes.func,
  onNavigateToLogs: PropTypes.func,
};

BatchUpgradeProgressModal.displayName = "BatchUpgradeProgressModal";

export default BatchUpgradeProgressModal;
