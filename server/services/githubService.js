/**
 * GitHub Service
 * Handles fetching release information from GitHub repositories
 */

const axios = require('axios');
const config = require('../config');
const Cache = require('../utils/cache');

// Cache for GitHub releases (key: owner/repo, value: { releases, timestamp })
const releaseCache = new Cache();
const RELEASE_CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Parse GitHub repository URL or owner/repo string
 * @param {string} repoInput - GitHub repo URL or owner/repo format
 * @returns {Object|null} - { owner, repo } or null if invalid
 */
function parseGitHubRepo(repoInput) {
  if (!repoInput || typeof repoInput !== 'string') {
    return null;
  }

  const trimmed = repoInput.trim();
  
  // Handle GitHub URL formats:
  // https://github.com/owner/repo
  // https://github.com/owner/repo/
  // git@github.com:owner/repo.git
  // owner/repo
  let owner, repo;
  
  if (trimmed.startsWith('https://github.com/')) {
    const parts = trimmed.replace('https://github.com/', '').split('/').filter(p => p);
    if (parts.length >= 2) {
      owner = parts[0];
      repo = parts[1].replace('.git', '');
    }
  } else if (trimmed.startsWith('git@github.com:')) {
    const parts = trimmed.replace('git@github.com:', '').replace('.git', '').split('/');
    if (parts.length >= 2) {
      owner = parts[0];
      repo = parts[1];
    }
  } else if (trimmed.includes('/')) {
    // Assume owner/repo format
    const parts = trimmed.split('/').filter(p => p);
    if (parts.length >= 2) {
      owner = parts[0];
      repo = parts[1].replace('.git', '');
    }
  }
  
  if (owner && repo) {
    return { owner: owner.trim(), repo: repo.trim() };
  }
  
  return null;
}

/**
 * Get latest release from GitHub repository
 * @param {string} repoInput - GitHub repo URL or owner/repo format
 * @returns {Promise<Object|null>} - Latest release info or null
 */
async function getLatestRelease(repoInput) {
  const repoInfo = parseGitHubRepo(repoInput);
  if (!repoInfo) {
    throw new Error('Invalid GitHub repository format. Use owner/repo or full GitHub URL.');
  }

  const { owner, repo } = repoInfo;
  const cacheKey = `github:${owner}/${repo}`;

  // Check cache first
  const cached = releaseCache.get(cacheKey);
  if (cached && cached.releases && cached.releases.length > 0) {
    return cached.releases[0]; // Return latest (first) release
  }

  try {
    // Use GitHub API to get latest release
    // First try the /releases/latest endpoint (only returns actual releases, not pre-releases)
    const latestUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
    
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Docked/1.0',
    };

    // Add GitHub token if available for higher rate limits
    const githubToken = process.env.GITHUB_TOKEN;
    if (githubToken) {
      headers['Authorization'] = `token ${githubToken}`;
    }

    let response;
    try {
      response = await axios.get(latestUrl, {
        headers,
        timeout: 10000,
        validateStatus: (status) => status < 500,
      });
    } catch (err) {
      // If /latest returns 404 (no releases), try getting all releases
      if (err.response?.status === 404) {
        const allReleasesUrl = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=10`;
        response = await axios.get(allReleasesUrl, {
          headers,
          timeout: 10000,
          validateStatus: (status) => status < 500,
        });
        
        if (response.status === 200 && response.data && response.data.length > 0) {
          // Filter out pre-releases and drafts, get the latest actual release
          const releases = response.data.filter(r => !r.prerelease && !r.draft);
          if (releases.length > 0) {
            const latest = releases[0];
            // Cache the result
            releaseCache.set(cacheKey, { releases: [latest], timestamp: Date.now() }, RELEASE_CACHE_TTL);
            return latest;
          }
        }
      }
      throw err;
    }

    if (response.status === 200 && response.data) {
      const release = response.data;
      // Cache the result
      releaseCache.set(cacheKey, { releases: [release], timestamp: Date.now() }, RELEASE_CACHE_TTL);
      return release;
    }

    return null;
  } catch (error) {
    if (error.response?.status === 404) {
      throw new Error(`Repository ${owner}/${repo} not found or has no releases`);
    }
    if (error.response?.status === 403) {
      throw new Error('GitHub API rate limit exceeded. Consider setting GITHUB_TOKEN environment variable.');
    }
    throw new Error(`Failed to fetch GitHub releases: ${error.message}`);
  }
}

/**
 * Get all releases from GitHub repository
 * @param {string} repoInput - GitHub repo URL or owner/repo format
 * @param {number} limit - Maximum number of releases to return (default: 10)
 * @returns {Promise<Array>} - Array of releases
 */
async function getAllReleases(repoInput, limit = 10) {
  const repoInfo = parseGitHubRepo(repoInput);
  if (!repoInfo) {
    throw new Error('Invalid GitHub repository format. Use owner/repo or full GitHub URL.');
  }

  const { owner, repo } = repoInfo;
  const cacheKey = `github:${owner}/${repo}:all`;

  // Check cache first
  const cached = releaseCache.get(cacheKey);
  if (cached && cached.releases) {
    return cached.releases.slice(0, limit);
  }

  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=${limit}`;
    
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Docked/1.0',
    };

    // Add GitHub token if available for higher rate limits
    const githubToken = process.env.GITHUB_TOKEN;
    if (githubToken) {
      headers['Authorization'] = `token ${githubToken}`;
    }

    const response = await axios.get(url, {
      headers,
      timeout: 10000,
      validateStatus: (status) => status < 500,
    });

    if (response.status === 200 && response.data) {
      const releases = response.data.filter(r => !r.prerelease && !r.draft).slice(0, limit);
      // Cache the result
      releaseCache.set(cacheKey, { releases, timestamp: Date.now() }, RELEASE_CACHE_TTL);
      return releases;
    }

    return [];
  } catch (error) {
    if (error.response?.status === 404) {
      throw new Error(`Repository ${owner}/${repo} not found`);
    }
    if (error.response?.status === 403) {
      throw new Error('GitHub API rate limit exceeded. Consider setting GITHUB_TOKEN environment variable.');
    }
    throw new Error(`Failed to fetch GitHub releases: ${error.message}`);
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
    throw new Error('Invalid GitHub repository format. Use owner/repo or full GitHub URL.');
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
    
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Docked/1.0',
    };

    // Add GitHub token if available for higher rate limits
    const githubToken = process.env.GITHUB_TOKEN;
    if (githubToken) {
      headers['Authorization'] = `token ${githubToken}`;
    }

    const response = await axios.get(url, {
      headers,
      timeout: 10000,
      validateStatus: (status) => status < 500,
    });

    if (response.status === 200 && response.data) {
      const release = response.data;
      // Cache the result
      releaseCache.set(cacheKey, release, RELEASE_CACHE_TTL);
      return release;
    }

    return null;
  } catch (error) {
    if (error.response?.status === 404) {
      // Release not found - return null
      return null;
    }
    if (error.response?.status === 403) {
      throw new Error('GitHub API rate limit exceeded. Consider setting GITHUB_TOKEN environment variable.');
    }
    // Don't throw for other errors, just return null
    return null;
  }
}

/**
 * Clear GitHub release cache
 */
function clearReleaseCache() {
  releaseCache.clear();
  console.log('🗑️ GitHub release cache cleared');
}

module.exports = {
  parseGitHubRepo,
  getLatestRelease,
  getAllReleases,
  getReleaseByTag,
  clearReleaseCache,
};

