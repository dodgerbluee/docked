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
const { getContainersFromRunners } = require("../runnerService");
const { getRegistryImageVersion } = require("../../db/registryImageVersions");
const { parseImageName } = require("../../utils/imageRepoParser");
const { computeHasUpdate } = require("../../utils/containerUpdateHelpers");

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
 * Test if a container matches all of the intent's inclusion criteria (ignoring exclusions).
 * Criteria are AND-ed: if an intent specifies both matchImages and matchStacks,
 * the container must match at least one pattern in EACH specified criterion.
 * An unset/empty criterion is ignored (treated as "match all" for that dimension).
 *
 * @param {Object} container - Container from getContainersWithUpdates
 * @param {Object} intent - Intent object (parsed from DB, snake_case fields with JSON arrays parsed)
 * @returns {boolean}
 */
function containerMatchesInclusion(container, intent) {
  const matchContainers = intent.match_containers;
  const matchImages = intent.match_images;
  const matchSources = intent.match_sources;
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

  return true;
}

/**
 * Get the exclusion reason for a container that matched inclusion criteria.
 * Returns null if the container is NOT excluded, or a human-readable reason string.
 *
 * @param {Object} container - Container from getContainersWithUpdates
 * @param {Object} intent - Intent object (parsed from DB)
 * @returns {string|null} - Exclusion reason or null if not excluded
 */
function getExclusionReason(container, intent) {
  const excludeContainers = intent.exclude_containers;
  const excludeImages = intent.exclude_images;
  const excludeStacks = intent.exclude_stacks;
  const excludeRegistries = intent.exclude_registries;

  if (excludeContainers && excludeContainers.length > 0) {
    if (matchesAnyGlob(container.containerName, excludeContainers)) {
      return "container name excluded";
    }
  }

  if (excludeImages && excludeImages.length > 0) {
    if (matchesAnyGlob(container.imageName, excludeImages)) {
      return "image excluded";
    }
  }

  if (excludeStacks && excludeStacks.length > 0) {
    if (matchesAnyGlob(container.stackName, excludeStacks)) {
      return "stack excluded";
    }
  }

  if (excludeRegistries && excludeRegistries.length > 0) {
    if (matchesAnyGlob(container.registry, excludeRegistries)) {
      return "registry excluded";
    }
  }

  return null;
}

/**
 * Test if a container matches all of the intent's criteria (inclusion + exclusion).
 *
 * @param {Object} container - Container from getContainersWithUpdates
 * @param {Object} intent - Intent object (parsed from DB, snake_case fields with JSON arrays parsed)
 * @returns {boolean}
 */
// eslint-disable-next-line complexity -- Multiple match criteria require sequential checks
function containerMatchesIntent(container, intent) {
  if (!containerMatchesInclusion(container, intent)) {
    return false;
  }
  return getExclusionReason(container, intent) === null;
}

/**
 * Enrich a runner container with registry version info so hasUpdate can be computed.
 * Uses cached registry_image_versions data (non-blocking, no registry calls).
 *
 * @param {number} userId - User ID
 * @param {Object} container - Normalized runner container from runnerService
 * @returns {Promise<Object>} - Container with hasUpdate computed
 */
async function enrichRunnerContainerForMatching(userId, container) {
  try {
    const { imageRepo, tag } = parseImageName(container.image);
    const cached = await getRegistryImageVersion(userId, imageRepo, tag);
    if (cached && cached.latest_digest) {
      const enriched = {
        ...container,
        latestDigest: cached.latest_digest,
        latestVersion: cached.latest_version || null,
        latestPublishDate: cached.latest_publish_date || null,
        lastChecked: cached.last_checked || null,
        provider: cached.provider || null,
        existsInDockerHub: true,
        noDigest: false,
      };
      enriched.hasUpdate = computeHasUpdate(enriched);
      return enriched;
    }
  } catch (err) {
    logger.debug(`Runner container enrichment failed for ${container.name} during matching:`, {
      module: "matchingEngine",
      error: err.message,
    });
  }
  return container;
}

/**
 * Map a normalized runner container to the shape used by containerMatchesIntent().
 * DB containers use containerName/imageName/containerId; runner containers use name/image/id.
 *
 * @param {Object} rc - Normalized runner container from runnerService
 * @returns {Object} - Container in matching-engine shape
 */
function mapRunnerContainerForMatching(rc) {
  return {
    ...rc,
    containerId: rc.id,
    containerName: rc.name,
    imageName: rc.image,
    imageRepo: rc.image ? parseImageName(rc.image).imageRepo : null,
    sourceInstanceId: null,
    // runnerId, stackName, hasUpdate, repoDigests, currentDigest already present
  };
}

/**
 * Enrich a container with its source URL info.
 * Returns the enriched container, or null if the source is unknown (logs a warning).
 *
 * @param {Object} container - Container in matching-engine shape
 * @param {Map} sourceInstanceUrlMap - Map of source instance ID → URL
 * @param {Map} runnerMap - Map of runner ID → { url, apiKey }
 * @returns {Object|null}
 */
function enrichContainerWithSource(container, sourceInstanceUrlMap, runnerMap) {
  if (container.sourceInstanceId) {
    const portainerUrl = sourceInstanceUrlMap.get(container.sourceInstanceId);
    if (!portainerUrl) {
      logger.warn("Skipping container with unknown source instance", {
        containerId: container.containerId,
        containerName: container.containerName,
        sourceInstanceId: container.sourceInstanceId,
      });
      return null;
    }
    return { ...container, portainerUrl, registry: container.registry || null };
  } else if (container.runnerId) {
    const runner = runnerMap.get(container.runnerId);
    if (!runner) {
      logger.warn("Skipping container with unknown runner", {
        containerId: container.containerId,
        containerName: container.containerName,
        runnerId: container.runnerId,
      });
      return null;
    }
    return {
      ...container,
      portainerUrl: null,
      runnerUrl: runner.url,
      registry: container.registry || null,
    };
  } else {
    logger.warn("Skipping container with no source instance or runner", {
      containerId: container.containerId,
      containerName: container.containerName,
    });
    return null;
  }
}

/**
 * Find all containers that match an intent's criteria.
 *
 * Queries both DB-persisted containers (Portainer) and live runner containers
 * so that intents matching by source work for all source types.
 *
 * @param {Object} intent - Intent object (parsed from DB)
 * @param {number} userId - User ID
 * @param {boolean} [requireUpdate=true] - If true, only include containers with available updates
 * @param {Object} [options] - Additional options
 * @param {boolean} [options.trackExcluded=false] - If true, also return containers that matched
 *   inclusion criteria but were excluded, along with exclusion reasons
 * @returns {Promise<Array<Object>|{matched: Array<Object>, excluded: Array<Object>}>}
 *   When trackExcluded is false (default), returns an array of matched containers.
 *   When trackExcluded is true, returns { matched, excluded } where each excluded entry
 *   includes an `exclusionReason` string.
 */
async function findMatchingContainers(intent, userId, requireUpdate = true, options = {}) {
  const { trackExcluded = false } = options;

  try {
    // Fetch DB containers (Portainer) and runners in parallel
    const [dbContainers, sourceInstances, runners] = await Promise.all([
      getContainersWithUpdates(userId),
      getAllSourceInstances(userId),
      getAllRunners(userId),
    ]);

    // Fetch live runner containers, enrich with registry data, and map to matching shape
    const rawRunnerContainers = await getContainersFromRunners(runners);
    const enrichedRunnerContainers = await Promise.all(
      rawRunnerContainers.map((rc) => enrichRunnerContainerForMatching(userId, rc))
    );
    const runnerContainers = enrichedRunnerContainers.map(mapRunnerContainerForMatching);

    // Combine all containers
    const allContainers = [...dbContainers, ...runnerContainers];

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
    const excluded = [];

    for (const container of allContainers) {
      if (requireUpdate && !container.hasUpdate) {
        continue;
      }

      // Check inclusion first
      if (!containerMatchesInclusion(container, intent)) {
        continue;
      }

      // Check exclusion
      const exclusionReason = getExclusionReason(container, intent);

      if (exclusionReason && trackExcluded) {
        // Matched inclusion but excluded — track it
        const enriched = enrichContainerWithSource(container, sourceInstanceUrlMap, runnerMap);
        if (enriched) {
          excluded.push({ ...enriched, exclusionReason });
        }
        continue;
      }

      if (exclusionReason) {
        // Excluded but not tracking — skip
        continue;
      }

      // Fully matched — enrich with source URL
      const enriched = enrichContainerWithSource(container, sourceInstanceUrlMap, runnerMap);
      if (enriched) {
        matched.push(enriched);
      }
    }

    logger.info(`Intent matching complete`, {
      intentId: intent.id,
      intentName: intent.name,
      totalContainers: allContainers.length,
      dbContainers: dbContainers.length,
      runnerContainers: runnerContainers.length,
      containersWithUpdates: allContainers.filter((c) => c.hasUpdate).length,
      matchedContainers: matched.length,
      excludedContainers: excluded.length,
      requireUpdate,
      trackExcluded,
    });

    if (trackExcluded) {
      return { matched, excluded };
    }
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
  containerMatchesInclusion,
  getExclusionReason,
  matchesAnyGlob,
  matchesAnyName,
  globToRegex,
};
