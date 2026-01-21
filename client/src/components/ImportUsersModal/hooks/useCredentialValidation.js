import { useCallback } from "react";
import axios from "axios";
import { API_BASE_URL } from "../../../utils/api";
import { validateStep } from "../utils/userImportValidators";

// Step types
const STEP_TYPES = {
  INSTANCE_ADMIN_VERIFICATION: "instance_admin_verification",
  PASSWORD: "password",
  PORTAINER: "portainer",
  DISCORD: "discord",
};

/**
 * useCredentialValidation Hook
 * Handles validation logic for credential steps
 */
export function useCredentialValidation({
  currentUser,
  currentStepType,
  userPasswords,
  userCredentials,
  userSkippedSteps,
  setUserStepErrors,
  setError,
  setLoading,
}) {
  // Validate current step (client-side)
  const validateCurrentStep = useCallback(() => {
    if (!currentUser) return false;

    const username = currentUser.username;
    const password = userPasswords[username];
    const creds = userCredentials[username] || {};
    const instances = currentUser?.portainerInstances || [];
    const webhooks = currentUser?.discordWebhooks || [];

    const validation = validateStep(currentStepType, creds, password, instances, webhooks);

    if (!validation.valid) {
      setUserStepErrors((prev) => ({
        ...prev,
        [username]: { ...prev[username], ...validation.errors },
      }));
      return false;
    }

    return true;
  }, [currentUser, currentStepType, userPasswords, userCredentials, setUserStepErrors]);

  // Validate credentials with backend (for portainer, discord)
  const validateCredentialsStep = useCallback(async () => {
    if (!currentUser) return { success: true };

    const username = currentUser.username;
    const creds = userCredentials[username] || {};
    const skippedSteps = userSkippedSteps[username] || new Set();

    // Create a separate axios instance for validation requests without auth headers
    const validationAxios = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        "Content-Type": "application/json",
      },
    });
    delete validationAxios.defaults.headers.common["Authorization"];

    try {
      if (
        currentStepType === STEP_TYPES.PORTAINER &&
        creds.portainerInstances &&
        creds.portainerInstances.length > 0
      ) {
        const instances = currentUser.portainerInstances || [];
        if (instances.length > 0) {
          const validationPromises = creds.portainerInstances.map(async (cred, index) => {
            const instance = instances[index];
            if (!instance) {
              console.error(`[ImportUsersModal] Validation failed: No instance at index ${index}`);
              return { success: false, index, error: "Instance not found" };
            }

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
              const response = await validationAxios.post(
                `/api/portainer/instances/validate`,
                validateData
              );
              if (!response.data.success) {
                console.error(`[ImportUsersModal] Validation failed for instance:`, {
                  index,
                  instanceName: instance.name,
                  instanceUrl: instance.url,
                  credUrl: cred.url,
                  response: response.data,
                });
              }
              return { success: response.data.success, index, error: response.data.error || null };
            } catch (err) {
              console.error(`[ImportUsersModal] Validation error for instance:`, {
                index,
                instanceName: instance.name,
                instanceUrl: instance.url,
                credUrl: cred.url,
                error: err.message,
                response: err.response?.data,
              });
              return { success: false, index, error: err.response?.data?.error || err.message };
            }
          });

          const results = await Promise.all(validationPromises);
          const failed = results.find((r) => !r.success);
          if (failed) {
            const failedInstance = instances[failed.index];
            console.error(`[ImportUsersModal] Portainer validation failed:`, {
              index: failed.index,
              instanceName: failedInstance?.name,
              instanceUrl: failedInstance?.url,
              error: failed.error,
            });
            return {
              success: false,
              error: `Portainer instance "${failedInstance?.name || "Unknown"}" (${failedInstance?.url || "no URL"}): ${failed.error || "Authentication failed"}`,
            };
          }
        }
      } else if (
        currentStepType === STEP_TYPES.DISCORD &&
        creds.discordWebhooks &&
        creds.discordWebhooks.length > 0
      ) {
        const webhooks = currentUser.discordWebhooks || [];
        if (webhooks.length > 0) {
          for (let i = 0; i < creds.discordWebhooks.length; i++) {
            const cred = creds.discordWebhooks[i];
            const webhook = webhooks[i];

            // Only validate if webhook URL is provided
            if (cred.webhookUrl) {
              try {
                const response = await validationAxios.post(`/api/discord/test`, {
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
          }
        }
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.error || "Validation failed",
      };
    }
  }, [currentUser, currentStepType, userCredentials, userSkippedSteps]);

  return {
    validateCurrentStep,
    validateCredentialsStep,
  };
}
