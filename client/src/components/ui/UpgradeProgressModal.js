import React, { useState, useEffect, useCallback, useMemo } from "react";
import PropTypes from "prop-types";
import { CheckCircle2, Loader2, AlertCircle, Wifi, Square } from "lucide-react";
import axios from "axios";
import Modal from "./Modal";
import Button from "./Button";
import { API_BASE_URL } from "../../utils/api";
import { MODAL_STAGES } from "../../constants/modalStages";
import { TIMING } from "../../constants/timing";
import styles from "./UpgradeProgressModal.module.css";

/**
 * UpgradeProgressModal Component
 * Shows confirmation dialog, progress updates, and success state for container upgrades
 */
const UpgradeProgressModal = React.memo(function UpgradeProgressModal({
  isOpen,
  onClose,
  containerName,
  container,
  onConfirm,
  onSuccess,
  onError,
  onNavigateToLogs,
  showProgressInPage = false,
  onConfirmForBanner,
}) {
  const [stage, setStage] = useState(MODAL_STAGES.CONFIRM);
  const [currentStep, setCurrentStep] = useState(0);
  const [errorMessage, setErrorMessage] = useState(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  const steps = useMemo(() => {
    // For tunnel containers (providesNetwork) - show all steps including dependent container handling
    if (container?.providesNetwork) {
      return [
        {
          label: "Stopping dependent containers...",
          duration: TIMING.STEP_DURATION_START_DEPENDENTS,
        },
        {
          label: "Removing dependent containers...",
          duration: TIMING.STEP_DURATION_START_DEPENDENTS,
        },
        { label: "Waiting for cleanup...", duration: TIMING.STEP_DURATION_CLEANUP },
        { label: "Stopping tunnel container...", duration: TIMING.STEP_DURATION_STOP },
        { label: "Pulling latest image...", duration: TIMING.STEP_DURATION_PULL },
        { label: "Removing old tunnel container...", duration: TIMING.STEP_DURATION_REMOVE },
        { label: "Creating new tunnel container...", duration: TIMING.STEP_DURATION_CREATE },
        { label: "Starting tunnel container...", duration: TIMING.STEP_DURATION_START },
        { label: "Waiting for tunnel to be ready...", duration: TIMING.STEP_DURATION_WAIT_NETWORK },
        { label: "Recreating dependent containers...", duration: TIMING.STEP_DURATION_RECREATE },
        {
          label: "Starting dependent containers...",
          duration: TIMING.STEP_DURATION_START_DEPENDENTS,
        },
      ];
    }

    // For dependent containers (usesNetworkMode) - show steps including network wait
    if (container?.usesNetworkMode) {
      return [
        { label: "Stopping container...", duration: TIMING.STEP_DURATION_STOP },
        { label: "Pulling latest image...", duration: TIMING.STEP_DURATION_PULL },
        { label: "Removing old container...", duration: TIMING.STEP_DURATION_REMOVE },
        {
          label: "Waiting for network container to be ready...",
          duration: TIMING.STEP_DURATION_WAIT_NETWORK,
        },
        { label: "Creating new container...", duration: TIMING.STEP_DURATION_CREATE },
        { label: "Starting container...", duration: TIMING.STEP_DURATION_START },
        {
          label: "Waiting for container to be ready...",
          duration: TIMING.STEP_DURATION_WAIT_READY_SHORT,
        },
      ];
    }

    // Default steps for regular containers
    return [
      { label: "Stopping container...", duration: TIMING.STEP_DURATION_STOP },
      { label: "Pulling latest image...", duration: TIMING.STEP_DURATION_PULL },
      { label: "Removing old container...", duration: TIMING.STEP_DURATION_REMOVE },
      { label: "Creating new container...", duration: TIMING.STEP_DURATION_CREATE },
      { label: "Starting container...", duration: TIMING.STEP_DURATION_START },
      { label: "Waiting for container to be ready...", duration: TIMING.STEP_DURATION_WAIT_READY },
    ];
  }, [container]);

  // Reset state when modal opens/closes or container changes
  useEffect(() => {
    if (isOpen) {
      // When modal opens, always reset to confirm stage
      setStage(MODAL_STAGES.CONFIRM);
      setCurrentStep(0);
      setErrorMessage(null);
      setReconnectAttempts(0);
    } else if (!isOpen) {
      // Reset to confirm stage when modal closes (but keep it quick for reopening)
      setStage(MODAL_STAGES.CONFIRM);
      setCurrentStep(0);
      setErrorMessage(null);
      setReconnectAttempts(0);
    }
  }, [isOpen, container]);

  const handleConfirm = useCallback(async () => {
    setStage(MODAL_STAGES.PROGRESS);
    setCurrentStep(0);
    setReconnectAttempts(0);

    // Small delay to ensure initial render with checkboxes visible
    await new Promise((resolve) => setTimeout(resolve, TIMING.INITIAL_RENDER_DELAY));

    // Detect if this is nginx-proxy-manager
    const isNginx =
      container &&
      (containerName?.toLowerCase().includes("nginx-proxy-manager") ||
        containerName?.toLowerCase().includes("npm") ||
        container.image?.toLowerCase().includes("nginx-proxy-manager"));

    try {
      // Start the upgrade process - call the API immediately
      const upgradePromise = onConfirm();

      // Track API completion status using a ref to avoid closure issues
      const apiCompletedRef = { current: false };
      let apiError = null;

      // Monitor API completion
      const apiCompletion = upgradePromise
        .then(() => {
          apiCompletedRef.current = true;
        })
        .catch((error) => {
          apiCompletedRef.current = true;
          apiError = error;
        });

      // Show progress steps
      for (let i = 0; i < steps.length; i++) {
        const stepIndex = i;
        const stepDuration = steps[stepIndex].duration;
        const minStepDuration = TIMING.MIN_STEP_DURATION;
        setCurrentStep(stepIndex);

        // Wait for the step duration, ensuring minimum visibility time
        // Always show each step for at least minStepDuration, even if API completes early
        const stepStartTime = Date.now();
        await new Promise((resolve) => {
          const checkInterval = setInterval(() => {
            const elapsed = Date.now() - stepStartTime;
            // Always wait for minimum duration first
            if (elapsed < minStepDuration) {
              return; // Keep waiting
            }
            // After minimum duration, check if we should move on
            // Move on if: API completed OR we've exceeded the step duration
            if (apiCompletedRef.current || elapsed >= stepDuration) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 100);
        });
      }

      // Ensure we're on the final step
      setCurrentStep(steps.length - 1);

      // Wait for API to complete (if not already done) and check for errors
      await apiCompletion;

      // Small delay to show final step completion before success overlay
      await new Promise((resolve) => setTimeout(resolve, TIMING.FINAL_STEP_DELAY));

      // If there was an error and it's nginx, try to reconnect
      if (apiError && isNginx) {
        const isNetworkError =
          apiError.code === "ECONNREFUSED" ||
          apiError.code === "ETIMEDOUT" ||
          apiError.code === "ERR_NETWORK" ||
          apiError.message?.includes("Network Error") ||
          apiError.message?.includes("Failed to fetch") ||
          !apiError.response; // No response means network issue

        if (isNetworkError) {
          // Enter reconnecting state
          setStage(MODAL_STAGES.RECONNECTING);
          setCurrentStep(steps.length - 1); // Show final step

          // Poll for upgrade completion
          const maxWaitTime = TIMING.RECONNECT_MAX_WAIT;
          const pollInterval = TIMING.RECONNECT_POLL_INTERVAL;
          const startTime = Date.now();
          let upgradeCompleted = false;
          let attempts = 0;

          while (Date.now() - startTime < maxWaitTime && !upgradeCompleted) {
            await new Promise((resolve) => setTimeout(resolve, pollInterval));
            attempts++;
            setReconnectAttempts(attempts);

            try {
              // Try to fetch containers - if this succeeds, nginx is back up
              const response = await axios.get(`${API_BASE_URL}/api/containers?portainerOnly=true`);

              // Handle both grouped and flat response formats
              let containers = [];
              if (response.data?.grouped && response.data?.containers) {
                containers = response.data.containers;
              } else if (Array.isArray(response.data)) {
                containers = response.data;
              } else if (Array.isArray(response.data?.containers)) {
                containers = response.data.containers;
              }

              // Check if the container still exists by name (upgrade completed)
              // After upgrade, container ID changes, so we match by name
              const upgradedContainer = containers.find(
                (c) => c.name === containerName || c.name === container?.name
              );

              // If container exists, upgrade likely completed (nginx is back up)
              // We don't check hasUpdate because the cache might not be updated yet
              if (upgradedContainer) {
                upgradeCompleted = true;
                break;
              }
            } catch (pollError) {
              // Still can't connect, continue polling
              continue;
            }
          }

          if (upgradeCompleted) {
            // Upgrade completed! Call success callback and close immediately
            if (onSuccess) {
              onSuccess();
            }
            onClose();
            return;
          } else {
            // Timeout - show error but suggest manual refresh
            setErrorMessage(
              "Upgrade may have completed, but we couldn't verify. Please refresh the page to check."
            );
            setStage(MODAL_STAGES.ERROR);
            return;
          }
        }
      }

      // If there was an error (and not handled above), throw it
      if (apiError) {
        throw apiError;
      }

      // Call success callback and close modal immediately
      if (onSuccess) {
        onSuccess();
      }
      onClose();
    } catch (error) {
      setErrorMessage(error.response?.data?.error || error.message || "Unknown error occurred");
      setStage(MODAL_STAGES.ERROR);
    }
  }, [onConfirm, onSuccess, onClose, steps, container, containerName]);

  const handleClose = useCallback(() => {
    // Allow closing at any time - user can click outside to continue working
    onClose();
  }, [onClose]);

  const handleRetry = useCallback(() => {
    setStage(MODAL_STAGES.CONFIRM);
    setCurrentStep(0);
    setErrorMessage(null);
  }, []);

  if (!isOpen) return null;

  // Use larger modal size when we show warning messages or tunnel steps
  const hasWarning =
    container &&
    (container?.providesNetwork ||
      container?.usesNetworkMode ||
      containerName?.toLowerCase().includes("nginx-proxy-manager") ||
      containerName?.toLowerCase().includes("npm") ||
      container.image?.toLowerCase().includes("nginx-proxy-manager"));
  const modalSize = hasWarning || container?.providesNetwork ? "lg" : "md";

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      size={modalSize}
      showCloseButton={stage !== MODAL_STAGES.CONFIRM}
      title={stage !== MODAL_STAGES.CONFIRM ? undefined : ""}
      className={styles.modal}
      nonBlocking={stage !== MODAL_STAGES.CONFIRM}
    >
      <div className={styles.content}>
        {/* Confirmation Stage */}
        {stage === MODAL_STAGES.CONFIRM && (
          <div className={styles.confirmStage}>
            <div className={styles.iconContainer}>
              <AlertCircle size={48} className={styles.warningIcon} />
            </div>
            <h3 className={styles.title}>Upgrade Container?</h3>
            {container &&
            (containerName?.toLowerCase().includes("nginx-proxy-manager") ||
              containerName?.toLowerCase().includes("npm") ||
              container.image?.toLowerCase().includes("nginx-proxy-manager")) ? (
              <div className={styles.networkWarning}>
                <p className={styles.warningHeader}>⚠️ Warning:</p>
                <p className={styles.warning}>
                  If this nginx-proxy-manager instance handles URL or DNS resolution for Docked or
                  your Portainer instances, the upgrade can fail after the old container is removed
                  and may require manual recovery. Do not upgrade if that applies to your setup.
                </p>
              </div>
            ) : container?.providesNetwork ? (
              <div className={styles.networkWarning}>
                <p className={styles.warningHeader}>⚠️ Warning:</p>
                <p className={styles.warning}>
                  This container provides network access for other containers (network_mode). After
                  upgrading, all containers that depend on this network will be recreated to
                  reconnect to the new network container and ensure proper network connectivity for
                  all dependent services.
                </p>
              </div>
            ) : container?.usesNetworkMode ? (
              <div className={styles.networkWarning}>
                <p className={styles.warningHeader}>⚠️ Warning:</p>
                <p className={styles.warning}>
                  This container uses a shared network configuration (network_mode). The network
                  container and all containers using the same network will be restarted to ensure
                  proper reconnection after the upgrade.
                </p>
              </div>
            ) : (
              container && (
                <div className={styles.infoNotice}>
                  <p className={styles.infoNoticeText}>
                    The container will be stopped, removed, and recreated with the latest image.
                    This may cause a brief service interruption.
                  </p>
                </div>
              )
            )}
            <p className={styles.message}>
              Are you sure you want to upgrade <strong>{containerName}</strong>?
            </p>
            <div className={styles.actions}>
              <Button variant="outline" onClick={handleClose} className={styles.cancelButton}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  if (showProgressInPage && onConfirmForBanner && container) {
                    onClose();
                    onConfirmForBanner(container);
                  } else {
                    handleConfirm();
                  }
                }}
                className={styles.confirmButton}
              >
                Yes, Upgrade
              </Button>
            </div>
          </div>
        )}

        {/* Progress Stage */}
        {stage === MODAL_STAGES.PROGRESS && (
          <div className={styles.progressStage}>
            <div className={styles.progressIconContainer}>
              <Loader2 size={48} className={styles.spinner} />
            </div>
            <h3 className={styles.title}>Upgrading Container</h3>
            <p className={styles.containerName}>{containerName}</p>
            <div className={styles.stepsContainer}>
              {steps.map((step, index) => {
                const isActive = index === currentStep;
                const isCompleted = index < currentStep;
                const isPending = index > currentStep;

                return (
                  <div
                    key={index}
                    className={`${styles.step} ${isActive ? styles.stepActive : ""} ${
                      isCompleted ? styles.stepCompleted : ""
                    } ${isPending ? styles.stepPending : ""}`}
                  >
                    <div className={styles.stepIcon}>
                      {isCompleted ? (
                        <CheckCircle2 size={20} className={styles.checkIcon} />
                      ) : isActive ? (
                        <Loader2 size={20} className={styles.stepSpinner} />
                      ) : (
                        <Square size={20} className={styles.checkboxIcon} />
                      )}
                    </div>
                    <span className={styles.stepLabel}>{step.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Reconnecting Stage */}
        {stage === MODAL_STAGES.RECONNECTING && (
          <div className={styles.reconnectingStage}>
            <div className={styles.progressIconContainer}>
              <Wifi size={48} className={styles.reconnectingIcon} />
            </div>
            <h3 className={styles.title}>Reconnecting...</h3>
            <p className={styles.message}>
              The UI connection was lost during the upgrade. We{'\''}re automatically reconnecting and
              verifying the upgrade completed.
            </p>
            <div className={styles.reconnectingInfo}>
              <p className={styles.reconnectingAttempts}>
                Attempt {reconnectAttempts}... Please wait.
              </p>
            </div>
            <div className={styles.stepsContainer}>
              {steps.map((step, index) => {
                const isCompleted = index <= currentStep;

                return (
                  <div
                    key={index}
                    className={`${styles.step} ${isCompleted ? styles.stepCompleted : styles.stepPending}`}
                  >
                    <div className={styles.stepIcon}>
                      {isCompleted ? (
                        <CheckCircle2 size={20} className={styles.checkIcon} />
                      ) : (
                        <Square size={20} className={styles.checkboxIcon} />
                      )}
                    </div>
                    <span className={styles.stepLabel}>{step.label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Error Stage */}
        {stage === MODAL_STAGES.ERROR && (
          <div className={styles.errorStage}>
            <div className={styles.iconContainer}>
              <AlertCircle size={48} className={styles.errorIcon} />
            </div>
            <h3 className={styles.title}>Upgrade Failed</h3>
            <p className={styles.message}>
              Failed to upgrade <strong>{containerName}</strong>
            </p>
            <div className={styles.errorMessage}>{errorMessage}</div>
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

UpgradeProgressModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  containerName: PropTypes.string.isRequired,
  container: PropTypes.object,
  onConfirm: PropTypes.func.isRequired,
  onSuccess: PropTypes.func,
  onError: PropTypes.func,
  onNavigateToLogs: PropTypes.func,
  showProgressInPage: PropTypes.bool,
  onConfirmForBanner: PropTypes.func,
};

UpgradeProgressModal.displayName = "UpgradeProgressModal";

export default UpgradeProgressModal;
