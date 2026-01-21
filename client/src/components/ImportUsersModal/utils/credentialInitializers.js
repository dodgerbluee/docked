/**
 * Credential Initializers
 * Utility functions for initializing user credentials structure
 */

/**
 * Initialize credentials structure for a user
 */
export function initializeUserCredentials(user) {
  const credentials = {};

  // Always initialize Portainer credentials structure
  if (
    user.portainerInstances &&
    Array.isArray(user.portainerInstances) &&
    user.portainerInstances.length > 0
  ) {
    credentials.portainerInstances = user.portainerInstances.map((instance) => ({
      url: instance.url,
      name: instance.name,
      auth_type: instance.auth_type || "apikey",
      username: "",
      password: "",
      apiKey: "",
    }));
  } else {
    credentials.portainerInstances = [];
  }

  // Always initialize Discord webhooks structure
  if (
    user.discordWebhooks &&
    Array.isArray(user.discordWebhooks) &&
    user.discordWebhooks.length > 0
  ) {
    credentials.discordWebhooks = user.discordWebhooks.map((webhook) => ({
      id: webhook.id,
      serverName: webhook.server_name,
      webhookUrl: "",
    }));
  } else {
    credentials.discordWebhooks = [];
  }

  return credentials;
}

/**
 * Calculate steps needed for a user
 * Only includes steps that have data in the import file
 */
export function calculateUserSteps(user, isInstanceAdmin) {
  const steps = [];

  if (isInstanceAdmin) {
    steps.push("instance_admin_verification");
  }
  steps.push("password"); // Always required

  // Only include Portainer step if instances exist in import file
  if (
    user.portainerInstances &&
    Array.isArray(user.portainerInstances) &&
    user.portainerInstances.length > 0
  ) {
    steps.push("portainer");
  }

  // Only include Discord step if webhooks exist in import file
  if (
    user.discordWebhooks &&
    Array.isArray(user.discordWebhooks) &&
    user.discordWebhooks.length > 0
  ) {
    steps.push("discord");
  }

  return steps;
}
