/**
 * Intent Matching Engine
 *
 * Matches containers against intent criteria to determine which containers
 * should be upgraded. Supports:
 * - Glob patterns for container names (matchContainers)
 * - Glob patterns for images (matchImages), stacks (matchStacks), registries (matchRegistries)
 * - ID match for Portainer instances (matchInstances)
 *
 * Only containers with hasUpdate === true are eligible for matching.
 */

const logger = require("../../utils/logger");
const { getPortainerContainersWithUpdates, getAllPortainerInstances } = require("../../db/index");

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
 * @param {Object} container - Container from getPortainerContainersWithUpdates
 * @param {Object} intent - Intent object (parsed from DB, snake_case fields with JSON arrays parsed)
 * @returns {boolean}
 */
// eslint-disable-next-line complexity -- Multiple match criteria require sequential checks
function containerMatchesIntent(container, intent) {
  const matchContainers = intent.match_containers;
  const matchImages = intent.match_images;
  const matchInstances = intent.match_instances;
  const matchStacks = intent.match_stacks;
  const matchRegistries = intent.match_registries;

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

  // Check Portainer instance IDs
  if (matchInstances && matchInstances.length > 0) {
    const instanceIds = matchInstances.map(Number);
    if (!instanceIds.includes(container.portainerInstanceId)) {
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

  return true;
}

/**
 * Find all containers that match an intent's criteria and have available updates.
 *
 * @param {Object} intent - Intent object (parsed from DB)
 * @param {number} userId - User ID
 * @returns {Promise<Array<Object>>} - Matched containers, each enriched with portainerUrl
 */
async function findMatchingContainers(intent, userId) {
  try {
    // Fetch all containers with update info (no portainerUrl filter = all instances)
    const allContainers = await getPortainerContainersWithUpdates(userId);

    // Build a map of portainerInstanceId -> portainerUrl for enrichment
    const instances = await getAllPortainerInstances(userId);
    const instanceUrlMap = new Map();
    for (const inst of instances) {
      instanceUrlMap.set(inst.id, inst.url);
    }

    // Filter: must have an update available AND match intent criteria
    const matched = [];
    for (const container of allContainers) {
      if (!container.hasUpdate) {
        continue;
      }

      if (!containerMatchesIntent(container, intent)) {
        continue;
      }

      // Enrich with portainerUrl (required by upgradeSingleContainer)
      const portainerUrl = instanceUrlMap.get(container.portainerInstanceId);
      if (!portainerUrl) {
        logger.warn("Skipping container with unknown portainer instance", {
          containerId: container.containerId,
          containerName: container.containerName,
          portainerInstanceId: container.portainerInstanceId,
        });
        continue;
      }

      matched.push({
        ...container,
        portainerUrl,
        // Also include registry from the join (may already be on container via deployed_images)
        registry: container.registry || null,
      });
    }

    logger.info(`Intent matching complete`, {
      intentId: intent.id,
      intentName: intent.name,
      totalContainers: allContainers.length,
      containersWithUpdates: allContainers.filter((c) => c.hasUpdate).length,
      matchedContainers: matched.length,
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
