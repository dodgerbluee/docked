/**
 * User Import Validators
 * Validation utilities for user import process
 */

import { validateDiscordWebhookUrl } from "../../../utils/validation";

/**
 * Validate password step
 */
export function validatePasswordStep(password, confirmPassword) {
  const errors = {};
  if (!password || password.length < 8) {
    errors.password = "Password must be at least 8 characters long";
  }
  // The confirm field used to be local to the step component, so the flow
  // happily created the user with a password that did not match what they
  // retyped.
  if (password && confirmPassword !== password) {
    errors.confirmPassword = "Passwords do not match";
  }
  if (Object.keys(errors).length > 0) {
    return { valid: false, errors };
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
export function validateStep(stepType, credentials, password, webhooks, confirmPassword) {
  switch (stepType) {
    case "password":
      return validatePasswordStep(password, confirmPassword);
    case "discord":
      return validateDiscordStep(credentials, webhooks);
    default:
      return { valid: true };
  }
}
