import { useCallback } from "react";
import { validateStep } from "../utils/userImportValidators";
import { graphqlClient } from "../../../graphql/client";
import { getSessionGeneration, isSessionStale } from "../../../utils/cacheRegistry";
import { TEST_DISCORD_WEBHOOK_URL_MUTATION } from "../../../graphql/queries";

// Step types
const STEP_TYPES = {
  INSTANCE_ADMIN_VERIFICATION: "instance_admin_verification",
  PASSWORD: "password",
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
    const webhooks = currentUser?.discordWebhooks || [];

    const validation = validateStep(currentStepType, creds, password, webhooks);

    if (!validation.valid) {
      setUserStepErrors((prev) => ({
        ...prev,
        [username]: { ...prev[username], ...validation.errors },
      }));
      return false;
    }

    return true;
  }, [currentUser, currentStepType, userPasswords, userCredentials, setUserStepErrors]);

  // Validate credentials with backend (for discord)
  const validateCredentialsStep = useCallback(async () => {
    if (!currentUser) return { success: true };

    const username = currentUser.username;
    const creds = userCredentials[username] || {};

    try {
      if (
        currentStepType === STEP_TYPES.DISCORD &&
        creds.discordWebhooks &&
        creds.discordWebhooks.length > 0
      ) {
        const webhooks = currentUser.discordWebhooks || [];
        if (webhooks.length > 0) {
          // Each test mutation runs on the CURRENT client (it re-reads the
          // token at call time), so a session change partway through the loop
          // must stop the remaining tests: they would run with the new
          // session's credentials.
          const generation = getSessionGeneration();
          for (let i = 0; i < creds.discordWebhooks.length; i++) {
            const cred = creds.discordWebhooks[i];
            const webhook = webhooks[i];

            // Only validate if webhook URL is provided
            if (cred.webhookUrl) {
              if (isSessionStale(generation)) {
                return { success: false, error: "Session ended. Please log in again." };
              }
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
