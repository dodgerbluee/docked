/**
 * GitLab Service
 * Handles fetching release information from GitLab repositories
 */

const axios = require("axios");
const config = require("../config");
const Cache = require("../utils/cache");
const logger = require("../utils/logger");

// Cache for GitLab releases (key: owner/repo, value: { releases, timestamp })
const releaseCache = new Cache();
const RELEASE_CACHE_TTL = 60 * 60 * 1000; // 1 hour

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

  // Handle GitLab URL formats:
  // https://gitlab.com/owner/repo
  // https://gitlab.com/owner/repo/
  // https://custom-gitlab.com/owner/repo
  // git@gitlab.com:owner/repo.git
  // owner/repo (assumes gitlab.com)
  let owner,
    repo,
    baseUrl = "https://gitlab.com";

  if (trimmed.startsWith("https://")) {
    // Extract base URL and path
    const urlMatch = trimmed.match(/^https:\/\/([^\/]+)\/(.+)$/);
    if (urlMatch) {
      baseUrl = `https://${urlMatch[1]}`;
      const path = urlMatch[2].replace(/\/$/, "").replace(/\.git$/, "");
      const parts = path.split("/").filter((p) => p);
      if (parts.length >= 2) {
        owner = parts[0];
        repo = parts.slice(1).join("/"); // Support nested groups
      }
    }
  } else if (trimmed.startsWith("git@")) {
    // git@gitlab.com:owner/repo.git or git@custom-gitlab.com:owner/repo.git
    const match = trimmed.match(/^git@([^:]+):(.+)\.git$/);
    if (match) {
      const host = match[1];
      baseUrl = host === "gitlab.com" ? "https://gitlab.com" : `https://${host}`;
      const path = match[2];
      const parts = path.split("/").filter((p) => p);
      if (parts.length >= 2) {
        owner = parts[0];
        repo = parts.slice(1).join("/");
      }
    }
  } else if (trimmed.includes("/")) {
    // Assume owner/repo format (defaults to gitlab.com)
    const parts = trimmed.split("/").filter((p) => p);
    if (parts.length >= 2) {
      owner = parts[0];
      repo = parts
        .slice(1)
        .join("/")
        .replace(/\.git$/, "");
    }
  }

  if (owner && repo) {
    return { owner: owner.trim(), repo: repo.trim(), baseUrl: baseUrl.trim() };
  }

  return null;
}

/**
 * Get latest release from GitLab repository
 * GitLab uses "releases" API which returns releases (not tags)
 * @param {string} repoInput - GitLab repo URL or owner/repo format
 * @param {string} token - Optional GitLab token for authentication
 * @returns {Promise<Object|null>} - Latest release info or null
 */
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

  // Check cache first
  const cached = releaseCache.get(cacheKey);
  if (cached && cached.releases && cached.releases.length > 0) {
    logger.info(
      `[GitLab] Returning cached release for ${owner}/${repo}: ${cached.releases[0].tag_name}`
    );
    return cached.releases[0]; // Return latest (first) release
  }

  try {
    // GitLab API endpoint for releases
    // Format: https://gitlab.com/api/v4/projects/{owner}%2F{repo}/releases
    // Note: GitLab requires URL encoding for the project path (owner/repo)
    const encodedProject = encodeURIComponent(`${owner}/${repo}`);
    const releasesUrl = `${baseUrl}/api/v4/projects/${encodedProject}/releases`;
    logger.info(`[GitLab] Fetching releases from: ${releasesUrl}`);

    const headers = {
      Accept: "application/json",
      "User-Agent": "Docked/1.0",
    };

    // Add GitLab token if available (prefer provided token, then env var)
    const gitlabToken = token || process.env.GITLAB_TOKEN;
    if (gitlabToken) {
      headers["Authorization"] = `Bearer ${gitlabToken}`;
      logger.debug(
        `[GitLab] Using GitLab token for authentication${token ? " (from repository config)" : " (from environment)"}`
      );
    } else {
      logger.debug(`[GitLab] No GitLab token found, using unauthenticated request`);
    }

    let response;
    try {
      response = await axios.get(releasesUrl, {
        headers,
        timeout: 10000,
        validateStatus: (status) => status < 500,
        params: {
          per_page: 10,
          order_by: "released_at",
          sort: "desc",
        },
      });
      logger.info(`[GitLab] API response status: ${response.status}`);
    } catch (err) {
      logger.error(`[GitLab] API request error:`, { error: err });
      if (err.response) {
        logger.error(`[GitLab] Response status: ${err.response.status}`);
        logger.error(`[GitLab] Response headers:`, JSON.stringify(err.response.headers));
        logger.error(`[GitLab] Response data:`, JSON.stringify(err.response.data));
      }
      throw err;
    }

    // Log response details for non-200 status codes
    if (response.status !== 200) {
      logger.warn(`[GitLab] Non-200 response status: ${response.status}`);
      logger.warn(`[GitLab] Response data:`, JSON.stringify(response.data));
      if (response.status === 403 || response.status === 401) {
        logger.warn(`[GitLab] Access denied. Repository may be private or require authentication.`);
        logger.warn(
          `[GitLab] Consider setting GITLAB_TOKEN environment variable for private repositories.`
        );
      }
    }

    logger.info(
      `[GitLab] Response data length: ${response.data ? (Array.isArray(response.data) ? response.data.length : "not an array") : 0}`
    );
    if (response.data && Array.isArray(response.data) && response.data.length > 0) {
      logger.info(`[GitLab] First release data:`, JSON.stringify(response.data[0], null, 2));
    } else if (response.data && !Array.isArray(response.data)) {
      logger.warn(`[GitLab] Response data is not an array:`, JSON.stringify(response.data));
    }

    if (
      response.status === 200 &&
      response.data &&
      Array.isArray(response.data) &&
      response.data.length > 0
    ) {
      // Filter out pre-releases if needed (GitLab doesn't have a prerelease flag like GitHub)
      // For now, we'll take the first release (most recent)
      const latest = response.data[0];
      logger.info(
        `[GitLab] Latest release tag_name: ${latest.tag_name}, name: ${latest.name}, released_at: ${latest.released_at}`
      );

      // GitLab release structure:
      // {
      //   tag_name: "v1.0.0",
      //   name: "Release v1.0.0",
      //   released_at: "2024-01-01T00:00:00Z",
      //   ...
      // }
      // We'll map it to a GitHub-like structure for compatibility
      const mappedRelease = {
        tag_name: latest.tag_name,
        name: latest.name || latest.tag_name,
        published_at: latest.released_at,
        html_url:
          latest._links?.self || `${baseUrl}/${owner}/${repo}/-/releases/${latest.tag_name}`,
        body: latest.description || "",
      };

      logger.info(`[GitLab] Mapped release:`, JSON.stringify(mappedRelease, null, 2));

      // Cache the result
      releaseCache.set(
        cacheKey,
        { releases: [mappedRelease], timestamp: Date.now() },
        RELEASE_CACHE_TTL
      );
      return mappedRelease;
    } else if (response.status === 200 && (!response.data || response.data.length === 0)) {
      logger.warn(`[GitLab] No releases found for ${owner}/${repo}`);
    } else {
      logger.warn(`[GitLab] Unexpected response status ${response.status} for ${owner}/${repo}`);
    }

    return null;
  } catch (error) {
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
        `GitLab API access denied (${error.response.status}): ${errorMsg}. Consider setting GITLAB_TOKEN environment variable for private repos.`
      );
    }
    if (error.response?.status === 429) {
      throw new Error(
        "GitLab API rate limit exceeded. Consider setting GITLAB_TOKEN environment variable."
      );
    }
    throw new Error(`Failed to fetch GitLab releases: ${error.message}`);
  }
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

  // Check cache first
  const cached = releaseCache.get(cacheKey);
  if (cached && cached.releases) {
    return cached.releases.slice(0, limit);
  }

  try {
    const encodedProject = encodeURIComponent(`${owner}/${repo}`);
    const url = `${baseUrl}/api/v4/projects/${encodedProject}/releases`;

    const headers = {
      Accept: "application/json",
      "User-Agent": "Docked/1.0",
    };

    const gitlabToken = token || process.env.GITLAB_TOKEN;
    if (gitlabToken) {
      headers["Authorization"] = `Bearer ${gitlabToken}`;
    }

    const response = await axios.get(url, {
      headers,
      timeout: 10000,
      validateStatus: (status) => status < 500,
      params: {
        per_page: limit,
        order_by: "released_at",
        sort: "desc",
      },
    });

    if (response.status === 200 && response.data) {
      const releases = response.data.slice(0, limit).map((latest) => ({
        tag_name: latest.tag_name,
        name: latest.name || latest.tag_name,
        published_at: latest.released_at,
        html_url:
          latest._links?.self || `${baseUrl}/${owner}/${repo}/-/releases/${latest.tag_name}`,
        body: latest.description || "",
      }));

      // Cache the result
      releaseCache.set(cacheKey, { releases, timestamp: Date.now() }, RELEASE_CACHE_TTL);
      return releases;
    }

    return [];
  } catch (error) {
    if (error.response?.status === 404) {
      throw new Error(`Repository ${owner}/${repo} not found`);
    }
    if (error.response?.status === 403 || error.response?.status === 401) {
      throw new Error(
        "GitLab API access denied. Consider setting GITLAB_TOKEN environment variable."
      );
    }
    if (error.response?.status === 429) {
      throw new Error(
        "GitLab API rate limit exceeded. Consider setting GITLAB_TOKEN environment variable."
      );
    }
    throw new Error(`Failed to fetch GitLab releases: ${error.message}`);
  }
}

/**
 * Get a specific release by tag name from GitLab repository
 * @param {string} repoInput - GitLab repo URL or owner/repo format
 * @param {string} tagName - Tag/version name (e.g., 'v1.0.0')
 * @param {string} token - Optional GitLab token for authentication
 * @returns {Promise<Object|null>} - Release info or null
 */
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

  // Check cache first
  const cached = releaseCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const encodedProject = encodeURIComponent(`${owner}/${repo}`);
    const url = `${baseUrl}/api/v4/projects/${encodedProject}/releases/${encodeURIComponent(tagName)}`;

    const headers = {
      Accept: "application/json",
      "User-Agent": "Docked/1.0",
    };

    const gitlabToken = token || process.env.GITLAB_TOKEN;
    if (gitlabToken) {
      headers["Authorization"] = `Bearer ${gitlabToken}`;
    }

    const response = await axios.get(url, {
      headers,
      timeout: 10000,
      validateStatus: (status) => status < 500,
    });

    if (response.status === 200 && response.data) {
      const latest = response.data;
      const mappedRelease = {
        tag_name: latest.tag_name,
        name: latest.name || latest.tag_name,
        published_at: latest.released_at,
        html_url:
          latest._links?.self || `${baseUrl}/${owner}/${repo}/-/releases/${latest.tag_name}`,
        body: latest.description || "",
      };

      // Cache the result
      releaseCache.set(cacheKey, mappedRelease, RELEASE_CACHE_TTL);
      return mappedRelease;
    }

    return null;
  } catch (error) {
    if (error.response?.status === 404) {
      // Release not found - return null
      return null;
    }
    if (error.response?.status === 403 || error.response?.status === 401) {
      throw new Error(
        "GitLab API access denied. Consider setting GITLAB_TOKEN environment variable."
      );
    }
    if (error.response?.status === 429) {
      throw new Error(
        "GitLab API rate limit exceeded. Consider setting GITLAB_TOKEN environment variable."
      );
    }
    // Don't throw for other errors, just return null
    return null;
  }
}

/**
 * Clear GitLab release cache
 */
function clearReleaseCache() {
  releaseCache.clear();
  const logger = require("../utils/logger");
  logger.info("🗑️ GitLab release cache cleared");
}

module.exports = {
  parseGitLabRepo,
  getLatestRelease,
  getAllReleases,
  getReleaseByTag,
  clearReleaseCache,
};
