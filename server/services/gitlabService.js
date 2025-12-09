/**
 * GitLab Service
 * Handles fetching release information from GitLab repositories
 */

const axios = require("axios");
const Cache = require("../utils/cache");
const logger = require("../utils/logger");

// Cache for GitLab releases (key: owner/repo, value: { releases, timestamp })
const releaseCache = new Cache();
const RELEASE_CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Parse HTTPS GitLab URL
 * @param {string} trimmed - Trimmed input string
 * @returns {Object|null} - { owner, repo, baseUrl } or null
 */
function parseGitLabHttps(trimmed) {
  const urlMatch = trimmed.match(/^https:\/\/(?<host>[^/]+)\/(?<path>.+)$/);
  if (!urlMatch) {
    return null;
  }

  const baseUrl = `https://${urlMatch.groups.host}`;
  const path = urlMatch.groups.path.replace(/\/$/, "").replace(/\.git$/, "");
  const parts = path.split("/").filter(p => p);
  if (parts.length >= 2) {
    return {
      owner: parts[0],
      repo: parts.slice(1).join("/"),
      baseUrl,
    };
  }
  return null;
}

/**
 * Parse SSH GitLab URL
 * @param {string} trimmed - Trimmed input string
 * @returns {Object|null} - { owner, repo, baseUrl } or null
 */
function parseGitLabSsh(trimmed) {
  const match = trimmed.match(/^git@(?<host>[^:]+):(?<path>.+)\.git$/);
  if (!match) {
    return null;
  }

  const { host, path: pathMatch } = match.groups;
  const baseUrl = host === "gitlab.com" ? "https://gitlab.com" : `https://${host}`;
  const parts = pathMatch.split("/").filter(p => p);
  if (parts.length >= 2) {
    return {
      owner: parts[0],
      repo: parts.slice(1).join("/"),
      baseUrl,
    };
  }
  return null;
}

/**
 * Parse owner/repo format
 * @param {string} trimmed - Trimmed input string
 * @returns {Object|null} - { owner, repo, baseUrl } or null
 */
function parseGitLabOwnerRepo(trimmed) {
  const parts = trimmed.split("/").filter(p => p);
  if (parts.length >= 2) {
    return {
      owner: parts[0],
      repo: parts.slice(1).join("/").replace(/\.git$/, ""),
      baseUrl: "https://gitlab.com",
    };
  }
  return null;
}

/**
 * Parse GitLab repository URL or owner/repo string
 * Supports gitlab.com and self-hosted GitLab instances
 * @param {string} repoInput - GitLab repo URL or owner/repo format
 * @returns {Object|null} - { owner, repo, baseUrl } or null if invalid
 */
function parseGitLabRepo(repoInput) {
  if (!repoInput || typeof repoInput !== "string") {
    return null;
  }

  const trimmed = repoInput.trim();
  let result = null;

  if (trimmed.startsWith("https://")) {
    result = parseGitLabHttps(trimmed);
  } else if (trimmed.startsWith("git@")) {
    result = parseGitLabSsh(trimmed);
  } else if (trimmed.includes("/")) {
    result = parseGitLabOwnerRepo(trimmed);
  }

  if (result && result.owner && result.repo) {
    return {
      owner: result.owner.trim(),
      repo: result.repo.trim(),
      baseUrl: result.baseUrl.trim(),
    };
  }

  return null;
}

/**
 * Build GitLab API headers
 * @param {string} token - Optional token
 * @returns {Object} - Headers object
 */
function buildGitLabHeaders(token) {
  const headers = {
    Accept: "application/json",
    "User-Agent": "Docked/1.0",
  };

  const gitlabToken = token || process.env.GITLAB_TOKEN;
  if (gitlabToken) {
    headers.Authorization = `Bearer ${gitlabToken}`;
    logger.debug(
      `[GitLab] Using GitLab token for authentication${token ? " (from repository config)" : " (from environment)"}`,
    );
  } else {
    logger.debug(`[GitLab] No GitLab token found, using unauthenticated request`);
  }

  return headers;
}

/**
 * Map GitLab release to GitHub-like structure
 * @param {Object} latest - GitLab release object
 * @param {string} baseUrl - Base URL
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @returns {Object} - Mapped release
 */
function mapGitLabRelease(latest, baseUrl, owner, repo) {
  return {
    tag_name: latest.tag_name,
    name: latest.name || latest.tag_name,
    published_at: latest.released_at,
    html_url:
      latest._links?.self || `${baseUrl}/${owner}/${repo}/-/releases/${latest.tag_name}`,
    body: latest.description || "",
  };
}

/**
 * Process GitLab API response
 * @param {Object} response - API response
 * @param {string} baseUrl - Base URL
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} cacheKey - Cache key
 * @returns {Object|null} - Mapped release or null
 */
function processGitLabResponse(response, baseUrl, owner, repo, cacheKey) {
  if (response.status !== 200) {
    logger.warn(`[GitLab] Non-200 response status: ${response.status}`);
    logger.warn(`[GitLab] Response data:`, JSON.stringify(response.data));
    if (response.status === 403 || response.status === 401) {
      logger.warn(`[GitLab] Access denied. Repository may be private or require authentication.`);
      logger.warn(
        `[GitLab] Consider setting GITLAB_TOKEN environment variable for private repositories.`,
      );
    }
    return null;
  }

  if (!Array.isArray(response.data) || response.data.length === 0) {
    if (response.data && !Array.isArray(response.data)) {
      logger.warn(`[GitLab] Response data is not an array:`, JSON.stringify(response.data));
    } else {
      logger.warn(`[GitLab] No releases found for ${owner}/${repo}`);
    }
    return null;
  }

  const latest = response.data[0];
  logger.info(
    `[GitLab] Latest release tag_name: ${latest.tag_name}, name: ${latest.name}, released_at: ${latest.released_at}`,
  );

  const mappedRelease = mapGitLabRelease(latest, baseUrl, owner, repo);
  logger.info(`[GitLab] Mapped release:`, JSON.stringify(mappedRelease, null, 2));

  releaseCache.set(
    cacheKey,
    { releases: [mappedRelease], timestamp: Date.now() },
    RELEASE_CACHE_TTL,
  );
  return mappedRelease;
}

/**
 * Get latest release from GitLab repository
 * GitLab uses "releases" API which returns releases (not tags)
 * @param {string} repoInput - GitLab repo URL or owner/repo format
 * @param {string} token - Optional GitLab token for authentication
 * @returns {Promise<Object|null>} - Latest release info or null
 */
/**
 * Handle GitLab API error
 * @param {Error} error - Error object
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @returns {never}
 */
// eslint-disable-next-line complexity -- Error handling requires multiple conditional checks for different error types
function handleGitLabError(error, owner, repo) {
  logger.error(`[GitLab] Error in getLatestRelease for ${owner}/${repo}:`, { error });
  if (error.response) {
    logger.error(`[GitLab] Error response status: ${error.response.status}`);
    logger.error(`[GitLab] Error response data:`, JSON.stringify(error.response.data));
  }

  if (error.response?.status === 404) {
    throw new Error(`Repository ${owner}/${repo} not found or has no releases`);
  }
  if (error.response?.status === 403 || error.response?.status === 401) {
    const errorMsg = error.response?.data?.message || "Access denied";
    throw new Error(
      `GitLab API access denied (${error.response.status}): ${errorMsg}. Consider setting GITLAB_TOKEN environment variable for private repos.`,
    );
  }
  if (error.response?.status === 429) {
    throw new Error(
      "GitLab API rate limit exceeded. Consider setting GITLAB_TOKEN environment variable.",
    );
  }
  throw new Error(`Failed to fetch GitLab releases: ${error.message}`);
}

async function getLatestRelease(repoInput, token = null) {
  logger.info(`[GitLab] getLatestRelease called with: ${repoInput}`);
  const repoInfo = parseGitLabRepo(repoInput);
  if (!repoInfo) {
    logger.error(`[GitLab] Failed to parse repo: ${repoInput}`);
    throw new Error("Invalid GitLab repository format. Use owner/repo or full GitLab URL.");
  }

  const { owner, repo, baseUrl } = repoInfo;
  logger.info(`[GitLab] Parsed repo - owner: ${owner}, repo: ${repo}, baseUrl: ${baseUrl}`);
  const cacheKey = `gitlab:${baseUrl}:${owner}/${repo}`;

  const cached = releaseCache.get(cacheKey);
  if (cached?.releases?.length > 0) {
    logger.info(
      `[GitLab] Returning cached release for ${owner}/${repo}: ${cached.releases[0].tag_name}`,
    );
    return cached.releases[0];
  }

  try {
    const encodedProject = encodeURIComponent(`${owner}/${repo}`);
    const releasesUrl = `${baseUrl}/api/v4/projects/${encodedProject}/releases`;
    logger.info(`[GitLab] Fetching releases from: ${releasesUrl}`);

    const headers = buildGitLabHeaders(token);

    const response = await axios.get(releasesUrl, {
      headers,
      timeout: 10000,
      validateStatus: status => status < 500,
      params: {
        per_page: 10,
        order_by: "released_at",
        sort: "desc",
      },
    });

    logger.info(`[GitLab] API response status: ${response.status}`);
    if (response.data && Array.isArray(response.data) && response.data.length > 0) {
      logger.info(`[GitLab] First release data:`, JSON.stringify(response.data[0], null, 2));
    }

    return processGitLabResponse(response, baseUrl, owner, repo, cacheKey);
  } catch (error) {
    return handleGitLabError(error, owner, repo);
  }
}

/**
 * Build GitLab headers with optional token
 * @param {string} token - Optional token
 * @returns {Object} - Headers object
 */
function buildGitLabHeadersWithToken(token) {
  const headers = {
    Accept: "application/json",
    "User-Agent": "Docked/1.0",
  };

  const gitlabToken = token || process.env.GITLAB_TOKEN;
  if (gitlabToken) {
    headers.Authorization = `Bearer ${gitlabToken}`;
  }

  return headers;
}

/**
 * Process and cache GitLab releases
 * @param {Object} params - Parameters object
 * @param {Array} params.releases - Raw releases
 * @param {number} params.limit - Limit
 * @param {string} params.baseUrl - Base URL
 * @param {string} params.owner - Owner
 * @param {string} params.repo - Repository
 * @param {string} params.cacheKey - Cache key
 * @returns {Array} - Mapped releases
 */
function processAndCacheGitLabReleases({ releases, limit, baseUrl, owner, repo, cacheKey }) {
  const mapped = releases.slice(0, limit).map(latest => mapGitLabRelease(latest, baseUrl, owner, repo));
  releaseCache.set(cacheKey, { releases: mapped, timestamp: Date.now() }, RELEASE_CACHE_TTL);
  return mapped;
}

/**
 * Handle GitLab getAllReleases error
 * @param {Error} error - Error object
 * @param {string} owner - Owner
 * @param {string} repo - Repository
 * @returns {never}
 */
function handleGetAllReleasesError(error, owner, repo) {
  if (error.response?.status === 404) {
    throw new Error(`Repository ${owner}/${repo} not found`);
  }
  if (error.response?.status === 403 || error.response?.status === 401) {
    throw new Error(
      "GitLab API access denied. Consider setting GITLAB_TOKEN environment variable.",
    );
  }
  if (error.response?.status === 429) {
    throw new Error(
      "GitLab API rate limit exceeded. Consider setting GITLAB_TOKEN environment variable.",
    );
  }
  throw new Error(`Failed to fetch GitLab releases: ${error.message}`);
}

/**
 * Get all releases from GitLab repository
 * @param {string} repoInput - GitLab repo URL or owner/repo format
 * @param {number} limit - Maximum number of releases to return (default: 10)
 * @param {string} token - Optional GitLab token for authentication
 * @returns {Promise<Array>} - Array of releases
 */
async function getAllReleases(repoInput, limit = 10, token = null) {
  const repoInfo = parseGitLabRepo(repoInput);
  if (!repoInfo) {
    throw new Error("Invalid GitLab repository format. Use owner/repo or full GitLab URL.");
  }

  const { owner, repo, baseUrl } = repoInfo;
  const cacheKey = `gitlab:${baseUrl}:${owner}/${repo}:all`;

  const cached = releaseCache.get(cacheKey);
  if (cached && cached.releases) {
    return cached.releases.slice(0, limit);
  }

  try {
    const encodedProject = encodeURIComponent(`${owner}/${repo}`);
    const url = `${baseUrl}/api/v4/projects/${encodedProject}/releases`;
    const headers = buildGitLabHeadersWithToken(token);

    const response = await axios.get(url, {
      headers,
      timeout: 10000,
      validateStatus: status => status < 500,
      params: {
        per_page: limit,
        order_by: "released_at",
        sort: "desc",
      },
    });

    if (response.status === 200 && response.data) {
      return processAndCacheGitLabReleases({
        releases: response.data,
        limit,
        baseUrl,
        owner,
        repo,
        cacheKey,
      });
    }

    return [];
  } catch (error) {
    return handleGetAllReleasesError(error, owner, repo);
  }
}

/**
 * Get a specific release by tag name from GitLab repository
 * @param {string} repoInput - GitLab repo URL or owner/repo format
 * @param {string} tagName - Tag/version name (e.g., 'v1.0.0')
 * @param {string} token - Optional GitLab token for authentication
 * @returns {Promise<Object|null>} - Release info or null
 */
/**
 * Handle GitLab release by tag error
 * @param {Error} error - Error object
 * @returns {null}
 */
function handleReleaseByTagError(error) {
  if (error.response?.status === 404) {
    return null;
  }
  if (error.response?.status === 403 || error.response?.status === 401) {
    throw new Error(
      "GitLab API access denied. Consider setting GITLAB_TOKEN environment variable.",
    );
  }
  if (error.response?.status === 429) {
    throw new Error(
      "GitLab API rate limit exceeded. Consider setting GITLAB_TOKEN environment variable.",
    );
  }
  return null;
}

async function getReleaseByTag(repoInput, tagName, token = null) {
  const repoInfo = parseGitLabRepo(repoInput);
  if (!repoInfo) {
    throw new Error("Invalid GitLab repository format. Use owner/repo or full GitLab URL.");
  }

  if (!tagName) {
    return null;
  }

  const { owner, repo, baseUrl } = repoInfo;
  const cacheKey = `gitlab:${baseUrl}:${owner}/${repo}:${tagName}`;

  const cached = releaseCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const encodedProject = encodeURIComponent(`${owner}/${repo}`);
    const url = `${baseUrl}/api/v4/projects/${encodedProject}/releases/${encodeURIComponent(tagName)}`;
    const headers = buildGitLabHeadersWithToken(token);

    const response = await axios.get(url, {
      headers,
      timeout: 10000,
      validateStatus: status => status < 500,
    });

    if (response.status === 200 && response.data) {
      const mappedRelease = mapGitLabRelease(response.data, baseUrl, owner, repo);
      releaseCache.set(cacheKey, mappedRelease, RELEASE_CACHE_TTL);
      return mappedRelease;
    }

    return null;
  } catch (error) {
    return handleReleaseByTagError(error);
  }
}

/**
 * Clear GitLab release cache
 */
function clearReleaseCache() {
  releaseCache.clear();
  const loggerInstance = require("../utils/logger");
  loggerInstance.info("🗑️ GitLab release cache cleared");
}

module.exports = {
  parseGitLabRepo,
  getLatestRelease,
  getAllReleases,
  getReleaseByTag,
  clearReleaseCache,
};
