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
 * Validate Portainer credentials step
 */
export function validatePortainerStep(credentials, instances) {
  const errors = {};
  
  if (instances.length > 0) {
    credentials.forEach((cred, index) => {
      if (cred.auth_type === "apikey") {
        if (!cred.apiKey) {
          errors[`portainer_${index}_apiKey`] = "API key is required";
        }
      } else if (cred.auth_type === "password") {
        if (!cred.username) {
          errors[`portainer_${index}_username`] = "Username is required";
        }
        if (!cred.password) {
          errors[`portainer_${index}_password`] = "Password is required";
        }
      }
    });
  }
  
  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

/**
 * Validate Docker Hub credentials step
 */
export function validateDockerHubStep(credentials) {
  const errors = {};
  const dockerHub = credentials?.dockerHub;
  
  if (dockerHub && (dockerHub.username || dockerHub.token)) {
    // If any field is filled, both are required
    if (!dockerHub.username) {
      errors.dockerhub_username = "Username is required";
    }
    if (!dockerHub.token) {
      errors.dockerhub_token = "Token is required";
    }
  }
  
  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
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
export function validateStep(stepType, credentials, password, instances, webhooks) {
  switch (stepType) {
    case "password":
      return validatePasswordStep(password);
    case "portainer":
      return validatePortainerStep(credentials?.portainerInstances || [], instances);
    case "dockerhub":
      return validateDockerHubStep(credentials);
    case "discord":
      return validateDiscordStep(credentials, webhooks);
    default:
      return { valid: true };
  }
}

