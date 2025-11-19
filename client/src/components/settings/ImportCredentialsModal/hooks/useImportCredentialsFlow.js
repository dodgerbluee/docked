/**
 * Hook for managing import credentials flow
 */

import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../../../utils/api";
import { validateStep } from "../utils/credentialsValidation";
import { validateDiscordWebhookUrl } from "../../../utils/validation";

/**
 * Hook to manage import credentials flow
 * @param {boolean} isOpen - Whether modal is open
 * @param {Object} configData - Configuration data
 * @param {Function} onConfirm - Confirm callback
 * @returns {Object} Flow state and handlers
 */
export const useImportCredentialsFlow = (isOpen, configData, onConfirm) => {
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

  const validateStepCredentials = useCallback(
    (step) => {
      const stepErrors = validateStep(step, credentials);
      setErrors(stepErrors);
      return Object.keys(stepErrors).length === 0;
    },
    [credentials]
  );

  const validatePortainerCredentials = useCallback(async () => {
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
  }, [credentials.portainerInstances, configData]);

  const validateDockerHubCredentials = useCallback(async () => {
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
  }, [credentials.dockerHub]);

  const validateDiscordWebhooks = useCallback(async () => {
    if (!credentials.discordWebhooks || credentials.discordWebhooks.length === 0) {
      return { success: true };
    }

    // Validate webhook URL format using utility
    for (let i = 0; i < credentials.discordWebhooks.length; i++) {
      const cred = credentials.discordWebhooks[i];
      const webhook = configData.discordWebhooks[i];

      const urlError = validateDiscordWebhookUrl(cred.webhookUrl);
      if (urlError) {
        return {
          success: false,
          error: `Discord webhook "${webhook.server_name || `Webhook ${i + 1}`}": ${urlError}`,
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
  }, [credentials.discordWebhooks, configData]);

  const handleNext = useCallback(async () => {
    const currentStepName = steps[currentStep];
    if (!validateStepCredentials(currentStepName)) {
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
          onConfirm(credentials, skippedSteps);
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
  }, [
    currentStep,
    steps,
    validateStepCredentials,
    validatePortainerCredentials,
    validateDockerHubCredentials,
    validateDiscordWebhooks,
    credentials,
    skippedSteps,
    onConfirm,
  ]);

  const handleSkip = useCallback(() => {
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
  }, [currentStep, steps, credentials, skippedSteps, onConfirm]);

  const handleBack = useCallback(() => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
      setValidationError("");
    }
  }, [currentStep]);

  const handleUnskip = useCallback(() => {
    const currentStepName = steps[currentStep];
    setSkippedSteps((prev) => {
      const updated = new Set(prev);
      updated.delete(currentStepName);
      return updated;
    });
    setValidationError("");
  }, [currentStep, steps]);

  const handleConfirm = useCallback(async () => {
    const currentStepName = steps[currentStep];

    // If this step is not skipped, validate it
    if (!skippedSteps.has(currentStepName)) {
      if (!validateStepCredentials(currentStepName)) {
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
  }, [
    currentStep,
    steps,
    skippedSteps,
    validateStepCredentials,
    validatePortainerCredentials,
    validateDockerHubCredentials,
    validateDiscordWebhooks,
    credentials,
    onConfirm,
  ]);

  const handleUpdatePortainerCred = useCallback((index, field, value) => {
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
    const errorKey = `portainer_${index}_${field}`;
    setErrors((prev) => {
      if (prev[errorKey]) {
        const updated = { ...prev };
        delete updated[errorKey];
        return updated;
      }
      return prev;
    });
  }, []);

  const handleUpdateDockerHubCred = useCallback((field, value) => {
    setCredentials((prev) => ({
      ...prev,
      dockerHub: {
        ...prev.dockerHub,
        [field]: value,
      },
    }));
    const errorKey = `dockerhub_${field}`;
    setErrors((prev) => {
      if (prev[errorKey]) {
        const updated = { ...prev };
        delete updated[errorKey];
        return updated;
      }
      return prev;
    });
  }, []);

  const handleUpdateDiscordCred = useCallback((index, field, value) => {
    setCredentials((prev) => {
      const updated = { ...prev };
      updated.discordWebhooks = [...(updated.discordWebhooks || [])];
      updated.discordWebhooks[index] = {
        ...updated.discordWebhooks[index],
        [field]: value,
      };
      return updated;
    });
    const errorKey = `discord_${index}_${field}`;
    setErrors((prev) => {
      if (prev[errorKey]) {
        const updated = { ...prev };
        delete updated[errorKey];
        return updated;
      }
      return prev;
    });
  }, []);

  return {
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
    handleUpdateDockerHubCred,
    handleUpdateDiscordCred,
  };
};

