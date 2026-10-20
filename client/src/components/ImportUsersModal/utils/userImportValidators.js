/**
 * User Import Validators
 * Validation utilities for user import process
 */

import { validateDiscordWebhookUrl } from "../../../utils/validation";

/**
 * Validate password step
 */
export function validatePasswordStep(password) {
  if (!password || password.length < 8) {
    return { valid: false, error: "Password must be at least 8 characters long" };
  }
  return { valid: true };
}

/**
 * Validate Discord webhooks step
 */
export function validateDiscordStep(credentials, webhooks) {
  const errors = {};

  if (webhooks.length > 0) {
    const discordWebhooks = credentials?.discordWebhooks || [];
    discordWebhooks.forEach((cred, index) => {
      const urlError = validateDiscordWebhookUrl(cred.webhookUrl);
      if (urlError) {
        errors[`discord_${index}_webhookUrl`] = urlError;
      }
    });
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Validate current step based on step type
 */
export function validateStep(stepType, credentials, password, webhooks) {
  switch (stepType) {
    case "password":
      return validatePasswordStep(password);
    case "discord":
      return validateDiscordStep(credentials, webhooks);
    default:
      return { valid: true };
  }
}
