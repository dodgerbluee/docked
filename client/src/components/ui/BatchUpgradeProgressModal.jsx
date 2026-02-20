import React, { useCallback } from "react";
import PropTypes from "prop-types";
import Modal from "./Modal";
import { useBatchUpgradeProgress } from "./BatchUpgradeProgressModal/hooks/useBatchUpgradeProgress";
import ConfirmStage from "./BatchUpgradeProgressModal/components/ConfirmStage";
import ProgressStage from "./BatchUpgradeProgressModal/components/ProgressStage";
import SuccessStage from "./BatchUpgradeProgressModal/components/SuccessStage";
import ErrorStage from "./BatchUpgradeProgressModal/components/ErrorStage";
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
  showProgressInPage = false,
  onConfirmForBanner,
}) {
  // Use extracted hook (only needed when not showProgressInPage)
  const {
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
  } = useBatchUpgradeProgress(isOpen, containers, onSuccess, onError, onClose);

  const handleClose = useCallback(() => {
    // Only allow closing if not in progress
    if (stage === "confirm" || stage === "success" || stage === "error") {
      onClose();
    }
  }, [stage, onClose]);

  // When showProgressInPage: confirm closes modal and runs upgrades in Updating section (no second page)
  const confirmHandler = useCallback(() => {
    if (showProgressInPage && onConfirmForBanner && containers?.length) {
      onClose();
      onConfirmForBanner(containers);
    } else {
      handleConfirm();
    }
  }, [showProgressInPage, onConfirmForBanner, containers, onClose, handleConfirm]);

  if (!isOpen || !containers || containers.length === 0) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      size="lg"
      showCloseButton={stage !== "progress" && stage !== "confirm"}
      className={styles.modal}
    >
      <div className={styles.content}>
        {stage === "confirm" && (
          <ConfirmStage
            totalCount={totalCount}
            containers={containers}
            onConfirm={confirmHandler}
            onCancel={handleClose}
          />
        )}

        {stage === "progress" && (
          <ProgressStage
            containers={containers}
            containerStates={containerStates}
            steps={steps}
            completedCount={completedCount}
            totalCount={totalCount}
            successCount={successCount}
            errorCount={errorCount}
          />
        )}

        {stage === "success" && (
          <SuccessStage
            containers={containers}
            containerStates={containerStates}
            successCount={successCount}
            errorCount={errorCount}
            onNavigateToLogs={onNavigateToLogs}
          />
        )}

        {stage === "error" && overallError && (
          <ErrorStage
            overallError={overallError}
            onNavigateToLogs={onNavigateToLogs}
            onClose={handleClose}
            onRetry={handleRetry}
          />
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
  showProgressInPage: PropTypes.bool,
  onConfirmForBanner: PropTypes.func,
};

BatchUpgradeProgressModal.displayName = "BatchUpgradeProgressModal";

export default BatchUpgradeProgressModal;
