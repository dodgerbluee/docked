import React, { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import { CheckCircle2, Loader2, AlertCircle } from "lucide-react";
import Modal from "./Modal";
import Button from "./Button";
import styles from "./UpgradeProgressModal.module.css";

/**
 * UpgradeProgressModal Component
 * Shows confirmation dialog, progress updates, and success state for container upgrades
 */
const UpgradeProgressModal = React.memo(function UpgradeProgressModal({
  isOpen,
  onClose,
  containerName,
  onConfirm,
  onSuccess,
  onError,
}) {
  const [stage, setStage] = useState("confirm"); // 'confirm' | 'progress' | 'success' | 'error'
  const [currentStep, setCurrentStep] = useState(0);
  const [errorMessage, setErrorMessage] = useState(null);

  const steps = [
    { label: "Stopping container...", duration: 2000 },
    { label: "Pulling latest image...", duration: 5000 },
    { label: "Removing old container...", duration: 1500 },
    { label: "Creating new container...", duration: 2000 },
    { label: "Starting container...", duration: 2000 },
    { label: "Waiting for container to be ready...", duration: 10000 },
  ];

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

    try {
      // Start the upgrade process - call the API immediately
      const upgradePromise = onConfirm();

      // Track API completion status
      let apiCompleted = false;
      let apiError = null;
      
      // Monitor API completion
      const apiCompletion = upgradePromise
        .then(() => {
          apiCompleted = true;
        })
        .catch((error) => {
          apiCompleted = true;
          apiError = error;
        });

      // Show progress steps
      for (let i = 0; i < steps.length; i++) {
        setCurrentStep(i);
        
        // Wait for the step duration, but if API completes, move faster
        const stepStartTime = Date.now();
        await new Promise((resolve) => {
          const checkInterval = setInterval(() => {
            const elapsed = Date.now() - stepStartTime;
            if (apiCompleted || elapsed >= steps[i].duration) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 100);
        });
      }

      // Wait for API to complete (if not already done) and check for errors
      await apiCompletion;
      
      // If there was an error, throw it
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
  }, [onConfirm, onSuccess, onClose, steps]);

  const handleClose = useCallback(() => {
    // Only allow closing if not in progress (unless it's an error)
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
            <h3 className={styles.title}>Upgrade Container?</h3>
            <p className={styles.message}>
              Are you sure you want to upgrade <strong>{containerName}</strong>?
            </p>
            <p className={styles.warning}>
              The container will be stopped, removed, and recreated with the latest image. This may
              cause a brief service interruption.
            </p>
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
  onConfirm: PropTypes.func.isRequired,
  onSuccess: PropTypes.func,
  onError: PropTypes.func,
};

UpgradeProgressModal.displayName = "UpgradeProgressModal";

export default UpgradeProgressModal;

