/**
 * GitHub Service
 * Handles fetching release information from GitHub repositories
 */

const axios = require("axios");
const Cache = require("../utils/cache");

// Cache for GitHub releases (key: owner/repo, value: { releases, timestamp })
const releaseCache = new Cache();
const RELEASE_CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Parse GitHub HTTPS URL
 * @param {string} trimmed - Trimmed input string
 * @returns {Object|null} - { owner, repo } or null
 */
function parseHttpsUrl(trimmed) {
  const parts = trimmed
    .replace("https://github.com/", "")
    .split("/")
    .filter((p) => p);
  if (parts.length >= 2) {
    return {
      owner: parts[0],
      repo: parts[1].replace(".git", ""),
    };
  }
  return null;
}

/**
 * Parse GitHub SSH URL
 * @param {string} trimmed - Trimmed input string
 * @returns {Object|null} - { owner, repo } or null
 */
function parseSshUrl(trimmed) {
  const parts = trimmed.replace("git@github.com:", "").replace(".git", "").split("/");
  if (parts.length >= 2) {
    return {
      owner: parts[0],
      repo: parts[1],
    };
  }
  return null;
}

/**
 * Parse owner/repo format
 * @param {string} trimmed - Trimmed input string
 * @returns {Object|null} - { owner, repo } or null
 */
function parseOwnerRepo(trimmed) {
  const parts = trimmed.split("/").filter((p) => p);
  if (parts.length >= 2) {
    return {
      owner: parts[0],
      repo: parts[1].replace(".git", ""),
    };
  }
  return null;
}

/**
 * Parse GitHub repository URL or owner/repo string
 * @param {string} repoInput - GitHub repo URL or owner/repo format
 * @returns {Object|null} - { owner, repo } or null if invalid
 */
function parseGitHubRepo(repoInput) {
  if (!repoInput || typeof repoInput !== "string") {
    return null;
  }

  const trimmed = repoInput.trim();
  let result = null;

  if (trimmed.startsWith("https://github.com/")) {
    result = parseHttpsUrl(trimmed);
  } else if (trimmed.startsWith("git@github.com:")) {
    result = parseSshUrl(trimmed);
  } else if (trimmed.includes("/")) {
    result = parseOwnerRepo(trimmed);
  }

  if (result && result.owner && result.repo) {
    return {
      owner: result.owner.trim(),
      repo: result.repo.trim(),
    };
  }

  return null;
}

/**
 * Build GitHub API headers
 * @param {boolean} [withToken=true] - Whether to include the auth token
 * @returns {Object} - Headers object
 */
function buildGitHubHeaders(withToken = true) {
  const headers = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "Docked/1.0",
  };

  if (withToken) {
    const githubToken = process.env.GITHUB_TOKEN;
    if (githubToken) {
      headers.Authorization = `token ${githubToken}`;
    }
  }

  return headers;
}

/**
 * Check whether a 403 response is due to an org token policy rejection
 * (not a rate limit). If so, the request should be retried without the token.
 * @param {Object} response - Axios response object
 * @returns {boolean}
 */
function isOrgPolicyRejection(response) {
  if (response?.status !== 403) return false;
  const msg = typeof response.data?.message === "string" ? response.data.message : "";
  // GitHub org-policy rejections mention "organization" + "forbids" or "fine-grained"
  return msg.includes("organization") && (msg.includes("forbids") || msg.includes("fine-grained"));
}

/**
 * Make a GitHub API GET request with automatic retry on org-policy 403.
 * If the token causes a 403 due to org restrictions, retries without it.
 * @param {string} url - Full GitHub API URL
 * @param {Object} [opts] - Additional axios options (timeout, etc.)
 * @returns {Promise<Object>} - Axios response
 */
async function githubGet(url, opts = {}) {
  const headers = buildGitHubHeaders(true);
  const response = await axios.get(url, {
    headers,
    timeout: 10000,
    validateStatus: (status) => status < 500,
    ...opts,
  });

  // If the token triggered an org-policy 403, retry without it
  if (isOrgPolicyRejection(response) && process.env.GITHUB_TOKEN) {
    const retryHeaders = buildGitHubHeaders(false);
    return axios.get(url, {
      headers: retryHeaders,
      timeout: 10000,
      validateStatus: (status) => status < 500,
      ...opts,
    });
  }

  return response;
}

/**
 * Try to get latest release from all releases endpoint
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} cacheKey - Cache key
 * @returns {Promise<Object|null>} - Latest release or null
 */
async function tryAllReleasesEndpoint(owner, repo, cacheKey) {
  const allReleasesUrl = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=10`;

  const response = await githubGet(allReleasesUrl);

  if (response.status === 200 && response.data?.length > 0) {
    const releases = response.data.filter((r) => !r.prerelease && !r.draft);
    if (releases.length > 0) {
      const latest = releases[0];
      releaseCache.set(cacheKey, { releases: [latest], timestamp: Date.now() }, RELEASE_CACHE_TTL);
      return latest;
    }
  }

  return null;
}

/**
 * Handle GitHub API error
 * @param {Error} error - Error object
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @returns {never}
 */
function handleGitHubError(error, owner, repo) {
  if (error.response?.status === 404) {
    throw new Error(`Repository ${owner}/${repo} not found or has no releases`);
  }
  if (error.response?.status === 403) {
    throw new Error(
      "GitHub API rate limit or access restriction. Consider checking your GITHUB_TOKEN."
    );
  }
  throw new Error(`Failed to fetch GitHub releases: ${error.message}`);
}

/**
 * Fetch latest release from GitHub API
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} cacheKey - Cache key
 * @returns {Promise<Object|null>} - Release object or null
 */
async function fetchLatestRelease(owner, repo, cacheKey) {
  const latestUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;

  try {
    const response = await githubGet(latestUrl);

    if (response.status === 200 && response.data) {
      releaseCache.set(
        cacheKey,
        { releases: [response.data], timestamp: Date.now() },
        RELEASE_CACHE_TTL
      );
      return response.data;
    }

    return null;
  } catch (err) {
    if (err.response?.status === 404) {
      return tryAllReleasesEndpoint(owner, repo, cacheKey);
    }
    throw err;
  }
}

async function getLatestRelease(repoInput, { skipCache = false } = {}) {
  const repoInfo = parseGitHubRepo(repoInput);
  if (!repoInfo) {
    throw new Error("Invalid GitHub repository format. Use owner/repo or full GitHub URL.");
  }

  const { owner, repo } = repoInfo;
  const cacheKey = `github:${owner}/${repo}`;

  if (!skipCache) {
    const cached = releaseCache.get(cacheKey);
    if (cached?.releases?.length > 0) {
      return cached.releases[0];
    }
  }

  try {
    return await fetchLatestRelease(owner, repo, cacheKey);
  } catch (error) {
    return handleGitHubError(error, owner, repo);
  }
}

/**
 * Process and cache releases
 * @param {Array} releases - Raw releases array
 * @param {number} limit - Limit
 * @param {string} cacheKey - Cache key
 * @returns {Array} - Filtered releases
 */
function processAndCacheReleases(releases, limit, cacheKey) {
  const filtered = releases.filter((r) => !r.prerelease && !r.draft).slice(0, limit);
  releaseCache.set(cacheKey, { releases: filtered, timestamp: Date.now() }, RELEASE_CACHE_TTL);
  return filtered;
}

/**
 * Handle GitHub release by tag error
 * @param {Error} error - Error object
 * @returns {null}
 */
function handleReleaseByTagError(error) {
  if (error.response?.status === 404) {
    return null;
  }
  if (error.response?.status === 403) {
    throw new Error(
      "GitHub API rate limit or access restriction. Consider checking your GITHUB_TOKEN."
    );
  }
  return null;
}

async function getAllReleases(repoInput, limit = 10) {
  const repoInfo = parseGitHubRepo(repoInput);
  if (!repoInfo) {
    throw new Error("Invalid GitHub repository format. Use owner/repo or full GitHub URL.");
  }

  const { owner, repo } = repoInfo;
  const cacheKey = `github:${owner}/${repo}:all`;

  const cached = releaseCache.get(cacheKey);
  if (cached && cached.releases) {
    return cached.releases.slice(0, limit);
  }

  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=${limit}`;

    const response = await githubGet(url);

    if (response.status === 200 && response.data) {
      return processAndCacheReleases(response.data, limit, cacheKey);
    }

    return [];
  } catch (error) {
    return handleGitHubError(error, owner, repo);
  }
}

/**
 * Get a specific release by tag name from GitHub repository
 * @param {string} repoInput - GitHub repo URL or owner/repo format
 * @param {string} tagName - Tag/version name (e.g., 'v1.0.0')
 * @returns {Promise<Object|null>} - Release info or null
 */
async function getReleaseByTag(repoInput, tagName) {
  const repoInfo = parseGitHubRepo(repoInput);
  if (!repoInfo) {
    throw new Error("Invalid GitHub repository format. Use owner/repo or full GitHub URL.");
  }

  if (!tagName) {
    return null;
  }

  const { owner, repo } = repoInfo;
  const cacheKey = `github:${owner}/${repo}:${tagName}`;

  // Check cache first
  const cached = releaseCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tagName}`;

    const response = await githubGet(url);

    if (response.status === 200 && response.data) {
      const release = response.data;
      releaseCache.set(cacheKey, release, RELEASE_CACHE_TTL);
      return release;
    }

    return null;
  } catch (error) {
    return handleReleaseByTagError(error);
  }
}

/**
 * Find a release by tag, checking the cached "all releases" list first
 * to avoid unnecessary API calls. Falls back to getReleaseByTag if not
 * found in the cached list.
 *
 * This is the preferred method for looking up a specific version's release
 * info (e.g. to get published_at) because it minimizes API calls.
 *
 * @param {string} repoInput - GitHub repo URL or owner/repo format
 * @param {string} tagName - Tag/version name (e.g., 'v1.0.0')
 * @returns {Promise<Object|null>} - Release info or null
 */
async function findReleaseByTag(repoInput, tagName) {
  if (!tagName) {
    return null;
  }

  // Normalize for comparison (case-insensitive, trim)
  const normalizeTag = (t) => String(t).trim().toLowerCase();
  const normalizedTarget = normalizeTag(tagName);
  // Also prepare v-prefix variant for matching
  const withV = normalizedTarget.startsWith("v") ? normalizedTarget : `v${normalizedTarget}`;
  const withoutV = normalizedTarget.startsWith("v")
    ? normalizedTarget.substring(1)
    : normalizedTarget;

  // Step 1: Check the per-tag cache (already populated by prior getReleaseByTag calls)
  const repoInfo = parseGitHubRepo(repoInput);
  if (!repoInfo) {
    return null;
  }
  const { owner, repo } = repoInfo;

  for (const variant of [normalizedTarget, withV, withoutV]) {
    const tagCacheKey = `github:${owner}/${repo}:${variant}`;
    const cachedTag = releaseCache.get(tagCacheKey);
    if (cachedTag) {
      return cachedTag;
    }
  }

  // Step 2: Try to find in the "all releases" cache (or fetch it — 1 API call)
  try {
    const allReleases = await getAllReleases(repoInput, 10);
    if (allReleases && allReleases.length > 0) {
      const match = allReleases.find((r) => {
        const rTag = normalizeTag(r.tag_name);
        return rTag === normalizedTarget || rTag === withV || rTag === withoutV;
      });
      if (match) {
        // Cache the found release under the requested tag key
        const cacheKey = `github:${owner}/${repo}:${tagName}`;
        releaseCache.set(cacheKey, match, RELEASE_CACHE_TTL);
        return match;
      }
    }
  } catch {
    // Non-fatal — fall through to direct lookup
  }

  // Step 3: Tag not in recent releases — fall back to direct API call
  // Try exact tag first, then v-prefix variants
  let release = await getReleaseByTag(repoInput, tagName);
  if (release) {
    return release;
  }

  if (!tagName.startsWith("v")) {
    release = await getReleaseByTag(repoInput, `v${tagName}`);
  } else {
    release = await getReleaseByTag(repoInput, tagName.substring(1));
  }

  // Cache negative result to avoid repeated lookups
  if (!release) {
    const negativeCacheKey = `github:${owner}/${repo}:${tagName}`;
    releaseCache.set(negativeCacheKey, null, RELEASE_CACHE_TTL);
  }

  return release;
}

/**
 * Clear GitHub release cache
 */
function clearReleaseCache() {
  releaseCache.clear();
  const logger = require("../utils/logger");
  logger.info("GitHub release cache cleared");
}

module.exports = {
  parseGitHubRepo,
  getLatestRelease,
  getAllReleases,
  getReleaseByTag,
  findReleaseByTag,
  clearReleaseCache,
};
