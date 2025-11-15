import React, { useState, useEffect, useCallback, useMemo } from "react";
import PropTypes from "prop-types";
import { CheckCircle2, Loader2, AlertCircle, Wifi } from "lucide-react";
import axios from "axios";
import Modal from "./Modal";
import Button from "./Button";
import { API_BASE_URL } from "../../utils/api";
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
}) {
  const [stage, setStage] = useState("confirm"); // 'confirm' | 'progress' | 'reconnecting' | 'success' | 'error'
  const [currentStep, setCurrentStep] = useState(0);
  const [errorMessage, setErrorMessage] = useState(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

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

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen && stage === "confirm") {
      setCurrentStep(0);
      setErrorMessage(null);
    } else if (!isOpen) {
      // Reset to confirm stage when modal closes
      setTimeout(() => {
        setStage("confirm");
        setCurrentStep(0);
        setErrorMessage(null);
      }, 300); // Wait for close animation
    }
  }, [isOpen, stage]);

  const handleConfirm = useCallback(async () => {
    setStage("progress");
    setCurrentStep(0);
    setReconnectAttempts(0);

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
        setCurrentStep(stepIndex);

        // Wait for the step duration, but if API completes, move faster
        const stepStartTime = Date.now();
        await new Promise((resolve) => {
          const checkInterval = setInterval(() => {
            const elapsed = Date.now() - stepStartTime;
            // Use ref to avoid closure warning
            if (apiCompletedRef.current || elapsed >= stepDuration) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 100);
        });
      }

      // Wait for API to complete (if not already done) and check for errors
      await apiCompletion;

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
          setStage("reconnecting");
          setCurrentStep(steps.length - 1); // Show final step

          // Poll for upgrade completion
          const maxWaitTime = 120000; // 2 minutes max
          const pollInterval = 3000; // Check every 3 seconds
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
            // Upgrade completed! Show success
            setStage("success");
            if (onSuccess) {
              onSuccess();
            }
            setTimeout(() => {
              onClose();
            }, 2000);
            return;
          } else {
            // Timeout - show error but suggest manual refresh
            setErrorMessage(
              "Upgrade may have completed, but we couldn't verify. Please refresh the page to check."
            );
            setStage("error");
            return;
          }
        }
      }

      // If there was an error (and not handled above), throw it
      if (apiError) {
        throw apiError;
      }

      // Small delay to show final step completion
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Show success state
      setStage("success");

      // Call success callback if provided
      if (onSuccess) {
        onSuccess();
      }

      // Auto-close after showing success for 2 seconds
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (error) {
      setErrorMessage(error.response?.data?.error || error.message || "Unknown error occurred");
      setStage("error");
    }
  }, [onConfirm, onSuccess, onClose, steps, container, containerName]);

  const handleClose = useCallback(() => {
    // Only allow closing if not in progress or reconnecting (unless it's an error)
    if (stage === "confirm" || stage === "success" || stage === "error") {
      onClose();
    }
  }, [stage, onClose]);

  const handleRetry = useCallback(() => {
    setStage("confirm");
    setCurrentStep(0);
    setErrorMessage(null);
  }, []);

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      size="md"
      showCloseButton={stage !== "progress" && stage !== "reconnecting"}
      className={styles.modal}
    >
      <div className={styles.content}>
        {/* Confirmation Stage */}
        {stage === "confirm" && (
          <div className={styles.confirmStage}>
            <div className={styles.iconContainer}>
              <AlertCircle size={48} className={styles.warningIcon} />
            </div>
            <h3 className={styles.title}>Upgrade Container?</h3>
            <p className={styles.message}>
              Are you sure you want to upgrade <strong>{containerName}</strong>?
            </p>
            {container &&
            (containerName?.toLowerCase().includes("nginx-proxy-manager") ||
              containerName?.toLowerCase().includes("npm") ||
              container.image?.toLowerCase().includes("nginx-proxy-manager")) ? (
              <div className={styles.nginxWarning}>
                <p className={styles.warning}>
                  <strong>⚠️ Important:</strong> Upgrading nginx-proxy-manager will temporarily make
                  this UI unavailable. The upgrade will complete in the background using IP
                  addresses. The page will automatically reconnect and verify completion - no
                  refresh needed.
                </p>
              </div>
            ) : (
              <p className={styles.warning}>
                The container will be stopped, removed, and recreated with the latest image. This
                may cause a brief service interruption.
              </p>
            )}
            <div className={styles.actions}>
              <Button variant="outline" onClick={handleClose} className={styles.cancelButton}>
                Cancel
              </Button>
              <Button variant="primary" onClick={handleConfirm} className={styles.confirmButton}>
                Yes, Upgrade
              </Button>
            </div>
          </div>
        )}

        {/* Progress Stage */}
        {stage === "progress" && (
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
                        <div className={styles.stepDot} />
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
        {stage === "reconnecting" && (
          <div className={styles.reconnectingStage}>
            <div className={styles.progressIconContainer}>
              <Wifi size={48} className={styles.reconnectingIcon} />
            </div>
            <h3 className={styles.title}>Reconnecting...</h3>
            <p className={styles.message}>
              The UI connection was lost during the upgrade. We're automatically reconnecting and
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
                        <div className={styles.stepDot} />
                      )}
                    </div>
                    <span className={styles.stepLabel}>{step.label}</span>
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
            <h3 className={styles.title}>Upgrade Complete!</h3>
            <p className={styles.message}>
              <strong>{containerName}</strong> has been successfully upgraded.
            </p>
          </div>
        )}

        {/* Error Stage */}
        {stage === "error" && (
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
};

UpgradeProgressModal.displayName = "UpgradeProgressModal";

export default UpgradeProgressModal;
