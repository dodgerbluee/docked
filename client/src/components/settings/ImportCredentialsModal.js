import React, { useState, useEffect } from "react";
import PropTypes from "prop-types";
import { Package, Lock } from "lucide-react";
import axios from "axios";
import { API_BASE_URL } from "../../utils/api";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import Input from "../ui/Input";
import ToggleButton from "../ui/ToggleButton";
import Alert from "../ui/Alert";
import styles from "./ImportCredentialsModal.module.css";

const AUTH_TYPE_OPTIONS = [
  {
    value: "apikey",
    label: "API Key",
    icon: Package,
  },
  {
    value: "password",
    label: "Username / Password",
    icon: Lock,
  },
];

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
  const [credentials, setCredentials] = useState({});
  const [errors, setErrors] = useState({});
  const [currentStep, setCurrentStep] = useState(0);
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [skippedSteps, setSkippedSteps] = useState(new Set());

  // Determine what credentials are needed
  const needsPortainerCreds =
    configData?.portainerInstances && configData.portainerInstances.length > 0;
  const needsDockerHubCreds = configData?.dockerHubCredentials !== null;
  const needsDiscordCreds = configData?.discordWebhooks && configData.discordWebhooks.length > 0;

  const steps = [];
  if (needsPortainerCreds) steps.push("portainer");
  if (needsDockerHubCreds) steps.push("dockerhub");
  if (needsDiscordCreds) steps.push("discord");

  useEffect(() => {
    if (isOpen) {
      // Initialize credentials structure
      const initCreds = {};
      if (needsPortainerCreds) {
        initCreds.portainerInstances = configData.portainerInstances.map((instance) => ({
          url: instance.url,
          name: instance.name,
          auth_type: instance.auth_type || "apikey",
          username: "",
          password: "",
          apiKey: "",
        }));
      }
      if (needsDockerHubCreds) {
        initCreds.dockerHub = {
          username: "",
          token: "",
        };
      }
      if (needsDiscordCreds) {
        initCreds.discordWebhooks = configData.discordWebhooks.map((webhook) => ({
          id: webhook.id,
          serverName: webhook.server_name,
          webhookUrl: "",
        }));
      }
      setCredentials(initCreds);
      setCurrentStep(0);
      setErrors({});
      setSkippedSteps(new Set());
      setValidationError("");
    }
  }, [isOpen, configData, needsPortainerCreds, needsDockerHubCreds, needsDiscordCreds]);

  const validateStep = (step) => {
    const stepErrors = {};

    if (step === "portainer") {
      credentials.portainerInstances?.forEach((cred, index) => {
        if (cred.auth_type === "apikey") {
          if (!cred.apiKey?.trim()) {
            stepErrors[`portainer_${index}_apiKey`] = "API key is required";
          }
        } else if (cred.auth_type === "password") {
          if (!cred.username?.trim()) {
            stepErrors[`portainer_${index}_username`] = "Username is required";
          }
          if (!cred.password?.trim()) {
            stepErrors[`portainer_${index}_password`] = "Password is required";
          }
        }
      });
    } else if (step === "dockerhub") {
      if (!credentials.dockerHub?.username?.trim()) {
        stepErrors.dockerhub_username = "Username is required";
      }
      if (!credentials.dockerHub?.token?.trim()) {
        stepErrors.dockerhub_token = "Token is required";
      }
    } else if (step === "discord") {
      credentials.discordWebhooks?.forEach((cred, index) => {
        if (!cred.webhookUrl?.trim()) {
          stepErrors[`discord_${index}_webhookUrl`] = "Webhook URL is required";
        }
      });
    }

    setErrors(stepErrors);
    return Object.keys(stepErrors).length === 0;
  };

  const validatePortainerCredentials = async () => {
    if (!credentials.portainerInstances || credentials.portainerInstances.length === 0) {
      return { success: true };
    }

    const validationPromises = credentials.portainerInstances.map(async (cred, index) => {
      const instance = configData.portainerInstances[index];
      const validateData = {
        url: instance.url,
        authType: cred.auth_type,
      };

      if (cred.auth_type === "apikey") {
        validateData.apiKey = cred.apiKey;
      } else {
        validateData.username = cred.username;
        validateData.password = cred.password;
      }

      try {
        const response = await axios.post(
          `${API_BASE_URL}/api/portainer/instances/validate`,
          validateData
        );
        return { success: response.data.success, index, error: null };
      } catch (error) {
        return {
          success: false,
          index,
          error: error.response?.data?.error || "Authentication failed",
        };
      }
    });

    const results = await Promise.all(validationPromises);
    const failed = results.find((r) => !r.success);
    if (failed) {
      return {
        success: false,
        error: `Portainer instance "${configData.portainerInstances[failed.index].name}": ${failed.error}`,
      };
    }
    return { success: true };
  };

  const validateDockerHubCredentials = async () => {
    if (!credentials.dockerHub) {
      return { success: true };
    }

    try {
      const response = await axios.post(`${API_BASE_URL}/api/docker-hub/credentials/validate`, {
        username: credentials.dockerHub.username,
        token: credentials.dockerHub.token,
      });
      return { success: response.data.success, error: null };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.error || "Docker Hub authentication failed",
      };
    }
  };

  const validateDiscordWebhooks = async () => {
    if (!credentials.discordWebhooks || credentials.discordWebhooks.length === 0) {
      return { success: true };
    }

    // Validate webhook URL format
    const webhookPattern =
      /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/;

    for (let i = 0; i < credentials.discordWebhooks.length; i++) {
      const cred = credentials.discordWebhooks[i];
      const webhook = configData.discordWebhooks[i];

      if (!webhookPattern.test(cred.webhookUrl?.trim() || "")) {
        return {
          success: false,
          error: `Discord webhook "${webhook.server_name || `Webhook ${i + 1}`}": Invalid webhook URL format. Expected: https://discord.com/api/webhooks/{id}/{token}`,
        };
      }

      // Optionally test the webhook
      try {
        const response = await axios.post(`${API_BASE_URL}/api/discord/test`, {
          webhookUrl: cred.webhookUrl,
        });
        if (!response.data.success) {
          return {
            success: false,
            error: `Discord webhook "${webhook.server_name || `Webhook ${i + 1}`}": ${response.data.error || "Webhook test failed"}`,
          };
        }
      } catch (error) {
        return {
          success: false,
          error: `Discord webhook "${webhook.server_name || `Webhook ${i + 1}`}": ${error.response?.data?.error || "Webhook test failed"}`,
        };
      }
    }

    return { success: true };
  };

  const handleSkip = () => {
    const currentStepName = steps[currentStep];
    setSkippedSteps((prev) => new Set([...prev, currentStepName]));
    setValidationError("");

    // Move to next step or confirm if last step
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      // If last step, proceed with import (skipped steps won't be imported)
      onConfirm(credentials, new Set([...skippedSteps, currentStepName]));
    }
  };

  const handleNext = async () => {
    const currentStepName = steps[currentStep];
    if (!validateStep(currentStepName)) {
      return;
    }

    setValidating(true);
    setValidationError("");

    try {
      let validationResult;
      if (currentStepName === "portainer") {
        validationResult = await validatePortainerCredentials();
      } else if (currentStepName === "dockerhub") {
        validationResult = await validateDockerHubCredentials();
      } else if (currentStepName === "discord") {
        validationResult = await validateDiscordWebhooks();
      } else {
        validationResult = { success: true };
      }

      if (validationResult.success) {
        if (currentStep < steps.length - 1) {
          setCurrentStep(currentStep + 1);
        } else {
          handleConfirm();
        }
      } else {
        setValidationError(validationResult.error || "Validation failed");
      }
    } catch (error) {
      console.error("Validation error:", error);
      setValidationError("An error occurred during validation. Please try again.");
    } finally {
      setValidating(false);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
      setValidationError("");
    }
  };

  const handleUnskip = () => {
    const currentStepName = steps[currentStep];
    setSkippedSteps((prev) => {
      const updated = new Set(prev);
      updated.delete(currentStepName);
      return updated;
    });
    setValidationError("");
  };

  const handleConfirm = async () => {
    const currentStepName = steps[currentStep];

    // If this step is not skipped, validate it
    if (!skippedSteps.has(currentStepName)) {
      if (!validateStep(currentStepName)) {
        return;
      }

      // Validate the final step if there are steps
      if (steps.length > 0) {
        setValidating(true);
        setValidationError("");

        try {
          let validationResult;
          if (currentStepName === "portainer") {
            validationResult = await validatePortainerCredentials();
          } else if (currentStepName === "dockerhub") {
            validationResult = await validateDockerHubCredentials();
          } else if (currentStepName === "discord") {
            validationResult = await validateDiscordWebhooks();
          } else {
            validationResult = { success: true };
          }

          if (validationResult.success) {
            onConfirm(credentials, skippedSteps);
          } else {
            setValidationError(validationResult.error || "Validation failed");
          }
        } catch (error) {
          console.error("Validation error:", error);
          setValidationError("An error occurred during validation. Please try again.");
        } finally {
          setValidating(false);
        }
      } else {
        onConfirm(credentials, skippedSteps);
      }
    } else {
      // Step is skipped, proceed without validation
      onConfirm(credentials, skippedSteps);
    }
  };

  const updatePortainerCred = (index, field, value) => {
    setCredentials((prev) => {
      const updated = { ...prev };
      updated.portainerInstances = [...(updated.portainerInstances || [])];
      updated.portainerInstances[index] = {
        ...updated.portainerInstances[index],
        [field]: value,
      };
      return updated;
    });
    // Clear error for this field
    if (errors[`portainer_${index}_${field}`]) {
      setErrors((prev) => {
        const updated = { ...prev };
        delete updated[`portainer_${index}_${field}`];
        return updated;
      });
    }
  };

  const updateDockerHubCred = (field, value) => {
    setCredentials((prev) => ({
      ...prev,
      dockerHub: {
        ...prev.dockerHub,
        [field]: value,
      },
    }));
    if (errors[`dockerhub_${field}`]) {
      setErrors((prev) => {
        const updated = { ...prev };
        delete updated[`dockerhub_${field}`];
        return updated;
      });
    }
  };

  const updateDiscordCred = (index, field, value) => {
    setCredentials((prev) => {
      const updated = { ...prev };
      updated.discordWebhooks = [...(updated.discordWebhooks || [])];
      updated.discordWebhooks[index] = {
        ...updated.discordWebhooks[index],
        [field]: value,
      };
      return updated;
    });
    if (errors[`discord_${index}_${field}`]) {
      setErrors((prev) => {
        const updated = { ...prev };
        delete updated[`discord_${index}_${field}`];
        return updated;
      });
    }
  };

  const renderPortainerStep = () => {
    if (!needsPortainerCreds) return null;

    return (
      <div className={styles.stepContent}>
        <p className={styles.stepDescription}>
          Enter credentials for each Portainer instance. These were not included in the export for
          security reasons.
        </p>
        {credentials.portainerInstances?.map((cred, index) => {
          const instance = configData.portainerInstances[index];
          return (
            <div key={index} className={styles.credentialGroup}>
              <h4 className={styles.instanceTitle}>{instance.name}</h4>
              <p className={styles.instanceUrl}>{instance.url}</p>
              <div className={styles.formGroup}>
                <label className={styles.label}>Authentication Method</label>
                <ToggleButton
                  options={AUTH_TYPE_OPTIONS}
                  value={cred.auth_type}
                  onChange={(value) => updatePortainerCred(index, "auth_type", value)}
                  className={styles.authToggle}
                />
              </div>
              {cred.auth_type === "apikey" ? (
                <Input
                  type="password"
                  label="API Key"
                  value={cred.apiKey}
                  onChange={(e) => updatePortainerCred(index, "apiKey", e.target.value)}
                  error={errors[`portainer_${index}_apiKey`]}
                />
              ) : (
                <div className={styles.passwordFields}>
                  <Input
                    type="text"
                    label="Username"
                    value={cred.username}
                    onChange={(e) => updatePortainerCred(index, "username", e.target.value)}
                    error={errors[`portainer_${index}_username`]}
                  />
                  <Input
                    type="password"
                    label="Password"
                    value={cred.password}
                    onChange={(e) => updatePortainerCred(index, "password", e.target.value)}
                    error={errors[`portainer_${index}_password`]}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderDockerHubStep = () => {
    if (!needsDockerHubCreds) return null;

    return (
      <div className={styles.stepContent}>
        <p className={styles.stepDescription}>
          Enter your Docker Hub credentials. These were not included in the export for security
          reasons.
        </p>
        <Input
          type="text"
          label="Docker Hub Username"
          value={credentials.dockerHub?.username || ""}
          onChange={(e) => updateDockerHubCred("username", e.target.value)}
          error={errors.dockerhub_username}
        />
        <Input
          type="password"
          label="Docker Hub Personal Access Token"
          value={credentials.dockerHub?.token || ""}
          onChange={(e) => updateDockerHubCred("token", e.target.value)}
          error={errors.dockerhub_token}
        />
      </div>
    );
  };

  const renderDiscordStep = () => {
    if (!needsDiscordCreds) return null;

    return (
      <div className={styles.stepContent}>
        <p className={styles.stepDescription}>
          Enter webhook URLs for each Discord webhook. These were not included in the export for
          security reasons.
        </p>
        {credentials.discordWebhooks?.map((cred, index) => {
          const webhook = configData.discordWebhooks[index];
          return (
            <div key={index} className={styles.credentialGroup}>
              <h4 className={styles.instanceTitle}>
                {webhook.server_name || `Webhook ${index + 1}`}
              </h4>
              {webhook.channel_name && (
                <p className={styles.instanceUrl}>Channel: {webhook.channel_name}</p>
              )}
              <Input
                type="text"
                label="Webhook URL"
                value={cred.webhookUrl}
                onChange={(e) => updateDiscordCred(index, "webhookUrl", e.target.value)}
                error={errors[`discord_${index}_webhookUrl`]}
                placeholder="https://discord.com/api/webhooks/..."
              />
            </div>
          );
        })}
      </div>
    );
  };

  const renderCurrentStep = () => {
    if (steps.length === 0) return null;
    const stepName = steps[currentStep];

    switch (stepName) {
      case "portainer":
        return renderPortainerStep();
      case "dockerhub":
        return renderDockerHubStep();
      case "discord":
        return renderDiscordStep();
      default:
        return null;
    }
  };

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
        {steps[currentStep] === "portainer"
          ? "Portainer Instances"
          : steps[currentStep] === "dockerhub"
            ? "Docker Hub"
            : "Discord Webhooks"}
      </div>
      {renderCurrentStep()}
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
