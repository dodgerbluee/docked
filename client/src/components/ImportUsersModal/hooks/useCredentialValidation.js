import { useCallback } from "react";
import { validateStep } from "../utils/userImportValidators";
import { graphqlClient } from "../../../graphql/client";
import {
  VALIDATE_SOURCE_CREDENTIALS_MUTATION,
  TEST_DISCORD_WEBHOOK_URL_MUTATION,
} from "../../../graphql/queries";

// Step types
const STEP_TYPES = {
  INSTANCE_ADMIN_VERIFICATION: "instance_admin_verification",
  PASSWORD: "password",
  SOURCES: "sources",
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
    const instances = currentUser?.sourceInstances || [];
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

  // Validate credentials with backend (for sources, discord)
  const validateCredentialsStep = useCallback(async () => {
    if (!currentUser) return { success: true };

    const username = currentUser.username;
    const creds = userCredentials[username] || {};

    try {
      if (
        currentStepType === STEP_TYPES.SOURCES &&
        creds.sourceInstances &&
        creds.sourceInstances.length > 0
      ) {
        const instances = currentUser.sourceInstances || [];
        if (instances.length > 0) {
          const validationPromises = creds.sourceInstances.map(async (cred, index) => {
            const instance = instances[index];
            if (!instance) {
              console.error(`[ImportUsersModal] Validation failed: No instance at index ${index}`);
              return { success: false, index, error: "Instance not found" };
            }

            const validateData = {
              url: instance.url,
              authType: cred.auth_type === "apikey" ? "APIKEY" : "PASSWORD",
            };

            if (cred.auth_type === "apikey") {
              validateData.apiKey = cred.apiKey;
            } else {
              validateData.username = cred.username;
              validateData.password = cred.password;
            }

            try {
              const result = await graphqlClient
                .mutation(VALIDATE_SOURCE_CREDENTIALS_MUTATION, { input: validateData })
                .toPromise();
              const valid = !result.error && !!result.data?.validateSourceCredentials?.valid;
              if (!valid) {
                console.error(`[ImportUsersModal] Validation failed for instance:`, {
                  index,
                  instanceName: instance.name,
                  instanceUrl: instance.url,
                  credUrl: cred.url,
                  result: result.error?.message || result.data,
                });
              }
              return {
                success: valid,
                index,
                error: result.error?.message || result.data?.validateSourceCredentials?.message || null,
              };
            } catch (err) {
              console.error(`[ImportUsersModal] Validation error for instance:`, {
                index,
                instanceName: instance.name,
                instanceUrl: instance.url,
                credUrl: cred.url,
                error: err.message,
              });
              return { success: false, index, error: err.message };
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
                const result = await graphqlClient
                  .mutation(TEST_DISCORD_WEBHOOK_URL_MUTATION, { webhookUrl: cred.webhookUrl })
                  .toPromise();
                if (result.error || !result.data?.testDiscordWebhookUrl?.success) {
                  return {
                    success: false,
                    error: `Discord webhook "${webhook.server_name || `Webhook ${i + 1}`}": ${result.error?.message || result.data?.testDiscordWebhookUrl?.message || "Webhook test failed"}`,
                  };
                }
              } catch (error) {
                return {
                  success: false,
                  error: `Discord webhook "${webhook.server_name || `Webhook ${i + 1}`}": ${error.message || "Webhook test failed"}`,
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
  }, [currentUser, currentStepType, userCredentials]);

  return {
    validateCurrentStep,
    validateCredentialsStep,
  };
}
