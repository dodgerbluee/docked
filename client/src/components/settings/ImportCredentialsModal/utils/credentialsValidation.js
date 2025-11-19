/**
 * Validation utilities for credentials
 */

import { validateRequired, validateDiscordWebhookUrl } from "../../../utils/validation";

/**
 * Validate a step's credentials
 * @param {string} step - Step name ('portainer', 'dockerhub', 'discord')
 * @param {Object} credentials - Credentials object
 * @returns {Object} Errors object with field keys and error messages
 */
export const validateStep = (step, credentials) => {
  const stepErrors = {};

  if (step === "portainer") {
    credentials.portainerInstances?.forEach((cred, index) => {
      if (cred.auth_type === "apikey") {
        const error = validateRequired(cred.apiKey, "API key");
        if (error) stepErrors[`portainer_${index}_apiKey`] = error;
      } else if (cred.auth_type === "password") {
        const usernameError = validateRequired(cred.username, "Username");
        if (usernameError) stepErrors[`portainer_${index}_username`] = usernameError;
        const passwordError = validateRequired(cred.password, "Password");
        if (passwordError) stepErrors[`portainer_${index}_password`] = passwordError;
      }
    });
  } else if (step === "dockerhub") {
    const usernameError = validateRequired(credentials.dockerHub?.username, "Username");
    if (usernameError) stepErrors.dockerhub_username = usernameError;
    const tokenError = validateRequired(credentials.dockerHub?.token, "Token");
    if (tokenError) stepErrors.dockerhub_token = tokenError;
  } else if (step === "discord") {
    credentials.discordWebhooks?.forEach((cred, index) => {
      const error = validateDiscordWebhookUrl(cred.webhookUrl);
      if (error) stepErrors[`discord_${index}_webhookUrl`] = error;
    });
  }

  return stepErrors;
};

