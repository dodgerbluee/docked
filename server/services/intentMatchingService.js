/**
 * Intent Matching Service
 *
 * Implements the core matching algorithm that connects AutoUpdateIntents
 * to containers after Portainer sync. This service handles:
 * - Image repository normalization (handle registry prefixes, case sensitivity)
 * - Priority-based matching (stack+service > image_repo > container_name)
 * - One-to-many and many-to-one mapping support
 *
 * Key design principle:
 * Intent-based matching is stable across Portainer database wipes because
 * it uses stable identifiers like image repos and container names, not IDs.
 */

const logger = require("../utils/logger");

/**
 * Normalize an image repository for comparison
 *
 * Handles various formats and makes them comparable:
 * - "library/nginx" (official images) → "nginx"
 * - "docker.io/nginx" (explicit registry) → "nginx"
 * - "ghcr.io/linuxserver/plex" → "ghcr.io/linuxserver/plex"
 * - "GHCR.IO/Linuxserver/Plex" (case) → "ghcr.io/linuxserver/plex"
 *
 * @param {string} imageRepo - Image repository to normalize
 * @returns {string} - Normalized image repository
 */
function normalizeImageRepo(imageRepo) {
  if (!imageRepo) return "";

  // Convert to lowercase for consistent comparison
  let normalized = imageRepo.toLowerCase().trim();

  // Remove "library/" prefix (official Docker Hub images)
  if (normalized.startsWith("library/")) {
    normalized = normalized.substring("library/".length);
  }

  // Remove "docker.io/" prefix (explicit docker.io specification)
  if (normalized.startsWith("docker.io/")) {
    normalized = normalized.substring("docker.io/".length);
  }

  // Remove trailing @sha256 digest if present (shouldn't be in image_repo, but defensive)
  if (normalized.includes("@sha256")) {
    normalized = normalized.split("@sha256")[0];
  }

  return normalized;
}

/**
 * Derive service name from container name for Docker Compose containers
 *
 * Docker Compose containers are typically named: stackname_servicename_1
 * This function extracts the service name from the container name.
 *
 * @param {string} containerName - The container name
 * @param {string} stackName - The stack name
 * @returns {string|null} - Derived service name or null if can't be determined
 */
function deriveServiceName(containerName, stackName) {
  if (!containerName || !stackName) return null;

  // Docker Compose naming: stackname_servicename_1 (or _instancenumber)
  if (containerName.startsWith(stackName + "_")) {
    // Remove stack prefix and instance suffix
    const withoutPrefix = containerName.substring(stackName.length + 1);
    // Split by underscore and remove the last part (instance number)
    const parts = withoutPrefix.split("_");
    if (parts.length > 1) {
      // Remove the last part (instance number like "1")
      return parts.slice(0, -1).join("_");
    }
    return withoutPrefix;
  }

  // Fallback: return the container name itself
  return containerName;
}

/**
 * Check if an image repository matches an intent's image_repo criterion
 *
 * Handles normalization to account for Docker registry variations.
 *
 * @param {string} containerImageRepo - Container's image repository
 * @param {string} intentImageRepo - Intent's image repository criterion
 * @returns {boolean} - True if repositories match
 */
function matchesImageRepo(containerImageRepo, intentImageRepo) {
  if (!containerImageRepo || !intentImageRepo) return false;
  return normalizeImageRepo(containerImageRepo) === normalizeImageRepo(intentImageRepo);
}

/**
 * Get matching priority for an intent
 *
 * Returns the priority level used when matching. Lower numbers = higher priority.
 * This determines which criterion was matched (for logging/debugging).
 *
 * Priority order:
 * 1. stack_name + service_name (most stable after Portainer re-ingest)
 * 2. image_repo (can match multiple containers)
 * 3. container_name (least stable)
 *
 * @param {Object} intent - AutoUpdateIntent from database
 * @param {Object} container - Container from portainer_containers table
 * @returns {number|null} - Priority level (1-3) or null if no match
 */
function getMatchPriority(intent, container) {
  // Support both snake_case (from DB) and camelCase (from formatted responses) for intent fields
  const intentStackName = intent.stack_name || intent.stackName;
  const intentServiceName = intent.service_name || intent.serviceName;
  const intentImageRepo = intent.image_repo || intent.imageRepo;
  const intentContainerName = intent.container_name || intent.containerName;

  // Support both snake_case and camelCase for container fields
  const containerStackName = container.stack_name || container.stackName;
  const containerContainerName = container.container_name || container.containerName;
  const containerImageRepo = container.image_repo || container.imageRepo;

  // Priority 1: Stack + Service (most stable)
  if (intentStackName && intentServiceName && containerStackName) {
    // Derive service name from container name since containers don't store service_name
    const containerServiceName = deriveServiceName(containerContainerName, containerStackName);
    if (
      containerStackName === intentStackName &&
      containerServiceName === intentServiceName
    ) {
      return 1;
    }
  }

  // Priority 2: Image Repository (can match multiple containers)
  if (intentImageRepo && containerImageRepo) {
    if (matchesImageRepo(containerImageRepo, intentImageRepo)) {
      return 2;
    }
  }

  // Priority 3: Container Name (least stable)
  if (intentContainerName && containerContainerName) {
    if (containerContainerName === intentContainerName) {
      return 3;
    }
  }

  return null; // No match
}

/**
 * Test if a container matches an intent
 *
 * Uses priority-based matching: if the intent matches on one criterion,
 * higher-priority criteria are not checked. This prevents low-priority
 * matches from overriding high-priority ones.
 *
 * @param {Object} intent - AutoUpdateIntent from database
 * @param {Object} container - Container from portainer_containers table
 * @returns {boolean} - True if container matches this intent
 */
function matchesIntent(intent, container) {
  return getMatchPriority(intent, container) !== null;
}

/**
 * Build an intent-to-containers mapping
 *
 * After Portainer sync, this function matches all enabled intents to all
 * available containers. Result shows which intents match which containers.
 *
 * Important behaviors:
 * - Each intent is matched against all containers
 * - An intent can match 0, 1, or many containers
 * - A container can match multiple intents (though typically just one)
 * - Intents with zero matches are still returned (for logging/debugging)
 *
 * @param {Array} intents - Array of enabled AutoUpdateIntent objects
 * @param {Array} containers - Array of container objects from portainer_containers table
 * @returns {Array} - Array of { intent, matchedContainers, matchCount, matchPriority }
 */
function buildIntentMap(intents, containers) {
  const intentMap = [];

  for (const intent of intents) {
    const matchedContainers = [];
    let highestPriority = null;

    // Match this intent against all containers
    for (const container of containers) {
      const priority = getMatchPriority(intent, container);

      if (priority !== null) {
        matchedContainers.push({
          ...container,
          matchPriority: priority,
        });

        // Track the highest (lowest number) priority matched
        if (highestPriority === null || priority < highestPriority) {
          highestPriority = priority;
        }
      }
    }

    intentMap.push({
      intent,
      matchedContainers,
      matchCount: matchedContainers.length,
      matchPriority: highestPriority, // Highest priority criterion that matched
    });
  }

  return intentMap;
}

/**
 * Validate an intent has required matching criteria
 *
 * AutoUpdateIntents must have at least one matching criterion defined.
 * This function checks that the intent has the minimum configuration.
 *
 * @param {Object} intent - AutoUpdateIntent to validate
 * @returns {Object} - { valid: boolean, errors: Array<string> }
 */
function validateIntent(intent) {
  const errors = [];

  // Support both snake_case and camelCase
  const intentStackName = intent.stack_name || intent.stackName;
  const intentServiceName = intent.service_name || intent.serviceName;
  const intentImageRepo = intent.image_repo || intent.imageRepo;
  const intentContainerName = intent.container_name || intent.containerName;

  // Must have at least one matching criterion
  if (!intentStackName && !intentImageRepo && !intentContainerName) {
    errors.push(
      "At least one matching criterion must be specified (stackName, imageRepo, or containerName)"
    );
  }

  // Stack name without service name is incomplete
  if (intentStackName && !intentServiceName) {
    // This is a warning but allowed - can match any service in the stack
    logger.debug("Intent has stack_name but no service_name - will match any service in stack", {
      stackName: intentStackName,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Format intent matching results for logging/debugging
 *
 * Creates human-readable output showing what each intent matched.
 *
 * @param {Array} intentMap - Result from buildIntentMap()
 * @returns {Object} - Formatted results for logging
 */
function formatMatchingResults(intentMap) {
  const results = {
    totalIntents: intentMap.length,
    intentsWithMatches: 0,
    intentsWithoutMatches: 0,
    totalMatches: 0,
    byPriority: { 1: 0, 2: 0, 3: 0 },
    details: [],
  };

  for (const { intent, matchedContainers, matchCount, matchPriority } of intentMap) {
    if (matchCount > 0) {
      results.intentsWithMatches++;
      results.totalMatches += matchCount;
      if (matchPriority) results.byPriority[matchPriority]++;
    } else {
      results.intentsWithoutMatches++;
    }

    // Support both snake_case and camelCase for intent fields
    const intentStackName = intent.stack_name || intent.stackName;
    const intentServiceName = intent.service_name || intent.serviceName;
    const intentImageRepo = intent.image_repo || intent.imageRepo;
    const intentContainerName = intent.container_name || intent.containerName;

    results.details.push({
      intentId: intent.id,
      criteria: {
        stackService: intentStackName && intentServiceName
          ? `${intentStackName}/${intentServiceName}`
          : null,
        imageRepo: intentImageRepo,
        containerName: intentContainerName,
      },
      matchCount,
      matchPriority:
        matchPriority === 1 ? "stack+service" : matchPriority === 2 ? "image_repo" : "container_name",
      matchedContainerNames: matchedContainers.map((c) => c.container_name || c.containerName),
    });
  }

  return results;
}

module.exports = {
  normalizeImageRepo,
  deriveServiceName,
  matchesImageRepo,
  matchesIntent,
  getMatchPriority,
  buildIntentMap,
  validateIntent,
  formatMatchingResults,
};
