/**
 * Intent Matching Engine
 *
 * Matches containers against intent criteria to determine which containers
 * should be upgraded. Supports:
 * - Glob patterns for container names (matchContainers)
 * - Glob patterns for images (matchImages), stacks (matchStacks), registries (matchRegistries)
 * - Typed source IDs for sources (matchSources) — e.g. "portainer:5", "runner:3"
 * - Exclusion glob patterns for containers (excludeContainers), images (excludeImages),
 *   stacks (excludeStacks), registries (excludeRegistries)
 *
 * Only containers with hasUpdate === true are eligible for matching.
 * Inclusion criteria are AND-ed; exclusion criteria filter out matches after inclusion.
 */

const logger = require("../../utils/logger");
const {
  getContainersWithUpdates,
  getAllSourceInstances,
  getAllRunners,
} = require("../../db/index");

/**
 * Convert a simple glob pattern to a RegExp.
 * Supports * (any chars) and ? (single char). Case-insensitive.
 * @param {string} pattern - Glob pattern
 * @returns {RegExp}
 */
function globToRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const globbed = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${globbed}$`, "i");
}

/**
 * Test if a value matches any of the given glob patterns.
 * @param {string|null|undefined} value - The value to test
 * @param {Array<string>} patterns - Glob patterns
 * @returns {boolean}
 */
function matchesAnyGlob(value, patterns) {
  if (!value) {
    return false;
  }
  return patterns.some((pattern) => globToRegex(pattern).test(value));
}

/**
 * Test if a container name matches any of the given exact names (case-insensitive).
 * @param {string|null|undefined} containerName - Container name
 * @param {Array<string>} names - Exact names to match
 * @returns {boolean}
 */
function matchesAnyName(containerName, names) {
  if (!containerName) {
    return false;
  }
  const lower = containerName.toLowerCase();
  return names.some((name) => name.toLowerCase() === lower);
}

/**
 * Test if a container matches all of the intent's criteria.
 * Criteria are AND-ed: if an intent specifies both matchImages and matchStacks,
 * the container must match at least one pattern in EACH specified criterion.
 * An unset/empty criterion is ignored (treated as "match all" for that dimension).
 *
 * @param {Object} container - Container from getContainersWithUpdates
 * @param {Object} intent - Intent object (parsed from DB, snake_case fields with JSON arrays parsed)
 * @returns {boolean}
 */
// eslint-disable-next-line complexity -- Multiple match criteria require sequential checks
function containerMatchesIntent(container, intent) {
  const matchContainers = intent.match_containers;
  const matchImages = intent.match_images;
  const matchSources = intent.match_sources;
  const matchStacks = intent.match_stacks;
  const matchRegistries = intent.match_registries;
  const excludeContainers = intent.exclude_containers;
  const excludeImages = intent.exclude_images;
  const excludeStacks = intent.exclude_stacks;
  const excludeRegistries = intent.exclude_registries;

  // Check container names (glob match)
  if (matchContainers && matchContainers.length > 0) {
    if (!matchesAnyGlob(container.containerName, matchContainers)) {
      return false;
    }
  }

  // Check image patterns (glob match against imageName)
  if (matchImages && matchImages.length > 0) {
    if (!matchesAnyGlob(container.imageName, matchImages)) {
      return false;
    }
  }

  // Check source IDs (typed: "portainer:5", "runner:3")
  if (matchSources && matchSources.length > 0) {
    const containerSourceKey = container.sourceInstanceId
      ? `portainer:${container.sourceInstanceId}`
      : container.runnerId
        ? `runner:${container.runnerId}`
        : null;

    if (!containerSourceKey || !matchSources.includes(containerSourceKey)) {
      return false;
    }
  }

  // Check stack patterns (glob match)
  if (matchStacks && matchStacks.length > 0) {
    if (!matchesAnyGlob(container.stackName, matchStacks)) {
      return false;
    }
  }

  // Check registry patterns (glob match)
  if (matchRegistries && matchRegistries.length > 0) {
    // registry comes from deployed_images join; may be null for some containers
    if (!matchesAnyGlob(container.registry, matchRegistries)) {
      return false;
    }
  }

  // Exclusion checks: if any exclusion matches, exclude the container
  if (excludeContainers && excludeContainers.length > 0) {
    if (matchesAnyGlob(container.containerName, excludeContainers)) {
      return false;
    }
  }

  if (excludeImages && excludeImages.length > 0) {
    if (matchesAnyGlob(container.imageName, excludeImages)) {
      return false;
    }
  }

  if (excludeStacks && excludeStacks.length > 0) {
    if (matchesAnyGlob(container.stackName, excludeStacks)) {
      return false;
    }
  }

  if (excludeRegistries && excludeRegistries.length > 0) {
    if (matchesAnyGlob(container.registry, excludeRegistries)) {
      return false;
    }
  }

  return true;
}

/**
 * Find all containers that match an intent's criteria.
 *
 * @param {Object} intent - Intent object (parsed from DB)
 * @param {number} userId - User ID
 * @param {boolean} [requireUpdate=true] - If true, only include containers with available updates
 * @returns {Promise<Array<Object>>} - Matched containers, each enriched with portainerUrl or runnerId/runnerUrl
 */
async function findMatchingContainers(intent, userId, requireUpdate = true) {
  try {
    // Fetch all containers with update info (no URL filter = all instances)
    const allContainers = await getContainersWithUpdates(userId);

    // Build maps for both source instances and runners
    const [sourceInstances, runners] = await Promise.all([
      getAllSourceInstances(userId),
      getAllRunners(userId),
    ]);

    const sourceInstanceUrlMap = new Map();
    for (const inst of sourceInstances) {
      sourceInstanceUrlMap.set(inst.id, inst.url);
    }

    const runnerMap = new Map();
    for (const runner of runners) {
      runnerMap.set(runner.id, { url: runner.url, apiKey: runner.api_key });
    }

    // Filter: must match intent criteria (and optionally have update available)
    const matched = [];
    for (const container of allContainers) {
      if (requireUpdate && !container.hasUpdate) {
        continue;
      }

      if (!containerMatchesIntent(container, intent)) {
        continue;
      }

      // Enrich with backend URL (required by upgradeSingleContainer)
      if (container.sourceInstanceId) {
        const portainerUrl = sourceInstanceUrlMap.get(container.sourceInstanceId);
        if (!portainerUrl) {
          logger.warn("Skipping container with unknown source instance", {
            containerId: container.containerId,
            containerName: container.containerName,
            sourceInstanceId: container.sourceInstanceId,
          });
          continue;
        }
        matched.push({
          ...container,
          portainerUrl,
          registry: container.registry || null,
        });
      } else if (container.runnerId) {
        const runner = runnerMap.get(container.runnerId);
        if (!runner) {
          logger.warn("Skipping container with unknown runner", {
            containerId: container.containerId,
            containerName: container.containerName,
            runnerId: container.runnerId,
          });
          continue;
        }
        matched.push({
          ...container,
          portainerUrl: null,
          runnerUrl: runner.url,
          registry: container.registry || null,
        });
      } else {
        logger.warn("Skipping container with no source instance or runner", {
          containerId: container.containerId,
          containerName: container.containerName,
        });
        continue;
      }
    }

    logger.info(`Intent matching complete`, {
      intentId: intent.id,
      intentName: intent.name,
      totalContainers: allContainers.length,
      containersWithUpdates: allContainers.filter((c) => c.hasUpdate).length,
      matchedContainers: matched.length,
      requireUpdate,
    });

    return matched;
  } catch (error) {
    logger.error("Error in intent matching engine:", {
      intentId: intent.id,
      error: error.message,
    });
    throw error;
  }
}

module.exports = {
  findMatchingContainers,
  containerMatchesIntent,
  matchesAnyGlob,
  matchesAnyName,
  globToRegex,
};
