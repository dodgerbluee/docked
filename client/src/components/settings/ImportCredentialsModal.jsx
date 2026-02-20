import React from "react";
import PropTypes from "prop-types";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import { useImportCredentialsFlow } from "./ImportCredentialsModal/hooks/useImportCredentialsFlow";
import CredentialsStepManager from "./ImportCredentialsModal/components/CredentialsStepManager";
import styles from "./ImportCredentialsModal.module.css";

/**
 * ImportCredentialsModal Component
 * Collects credentials for imported configuration items that require authentication
 */
const ImportCredentialsModal = React.memo(function ImportCredentialsModal({
  isOpen,
  onClose,
  onConfirm,
  configData,
  loading = false,
}) {
  // Use extracted hook
  const {
    steps,
    currentStep,
    credentials,
    errors,
    validating,
    validationError,
    skippedSteps,
    handleNext,
    handleSkip,
    handleBack,
    handleUnskip,
    handleConfirm,
    handleUpdatePortainerCred,
    handleUpdateDiscordCred,
  } = useImportCredentialsFlow(isOpen, configData, onConfirm);

  if (steps.length === 0) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Import Configuration" size="lg">
        <p>No credentials required for this configuration.</p>
        <div className={styles.actions}>
          <div className={styles.actionSpacer} />
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={handleConfirm}
            disabled={loading || validating}
            className={styles.submitButton}
          >
            {validating ? "Validating..." : loading ? "Importing..." : "Import Configuration"}
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Import Configuration - Credentials" size="lg">
      <div className={styles.stepIndicator}>
        Step {currentStep + 1} of {steps.length}:{" "}
        {steps[currentStep] === "portainer" ? "Portainer Instances" : "Discord Webhooks"}
      </div>
      <CredentialsStepManager
        steps={steps}
        currentStep={currentStep}
        configData={configData}
        credentials={credentials}
        errors={errors}
        onUpdatePortainerCred={handleUpdatePortainerCred}
        onUpdateDiscordCred={handleUpdateDiscordCred}
      />
      {validationError && <Alert variant="error">{validationError}</Alert>}
      {skippedSteps.has(steps[currentStep]) && (
        <Alert variant="warning">
          This configuration will be skipped and not imported.{" "}
          <button
            type="button"
            onClick={handleUnskip}
            className={styles.unskipLink}
            disabled={loading || validating}
          >
            Click to un-skip
          </button>
        </Alert>
      )}
      <div className={styles.actions}>
        {currentStep > 0 && (
          <Button variant="secondary" onClick={handleBack} disabled={loading || validating}>
            Back
          </Button>
        )}
        <div className={styles.actionSpacer} />
        {!skippedSteps.has(steps[currentStep]) && (
          <Button
            variant="ghost"
            onClick={handleSkip}
            disabled={loading || validating}
            className={styles.skipButton}
          >
            Skip
          </Button>
        )}
        <Button variant="secondary" onClick={onClose} disabled={loading || validating}>
          Cancel
        </Button>
        <Button
          variant="outline"
          onClick={handleNext}
          disabled={loading || validating || skippedSteps.has(steps[currentStep])}
          className={styles.submitButton}
        >
          {validating
            ? "Validating..."
            : currentStep < steps.length - 1
              ? "Next"
              : loading
                ? "Importing..."
                : "Import"}
        </Button>
      </div>
    </Modal>
  );
});

ImportCredentialsModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onConfirm: PropTypes.func.isRequired,
  configData: PropTypes.object.isRequired,
  loading: PropTypes.bool,
};

export default ImportCredentialsModal;
