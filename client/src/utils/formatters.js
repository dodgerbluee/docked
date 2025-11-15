/**
 * Utility functions for formatting data
 */

/**
 * Format bytes to human-readable string
 * @param {number} bytes - Bytes to format
 * @returns {string} - Formatted string (e.g., "1.5 GB")
 */
export function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

/**
 * Parse a UTC timestamp from SQLite/database format
 * SQLite stores timestamps in UTC without timezone info (YYYY-MM-DD HH:MM:SS)
 * @param {string} dateString - Date string from database
 * @returns {Date} - Date object parsed as UTC
 */
export function parseUTCTimestamp(dateString) {
  if (!dateString) return null;

  if (typeof dateString === "string") {
    // Check if it's a SQLite datetime format (YYYY-MM-DD HH:MM:SS or YYYY-MM-DDTHH:MM:SS)
    if (/^\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}:\d{2}$/.test(dateString)) {
      // SQLite datetime without timezone - assume UTC and add 'Z'
      return new Date(dateString.replace(" ", "T") + "Z");
    } else if (
      dateString.includes("T") &&
      !dateString.includes("Z") &&
      !dateString.match(/[+-]\d{2}:\d{2}$/)
    ) {
      // ISO string without timezone - assume UTC
      return new Date(dateString + "Z");
    } else {
      // Already has timezone info or is in a different format
      return new Date(dateString);
    }
  } else {
    return new Date(dateString);
  }
}

/**
 * Format a date string to "time ago" format
 * @param {string} dateString - ISO date string
 * @returns {string} - Formatted string (e.g., "2 days ago", "3 hours ago")
 */
export function formatTimeAgo(dateString) {
  if (!dateString) return null;

  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffSecs < 60) return "just now";
  if (diffMins < 60) return `${diffMins} ${diffMins === 1 ? "minute" : "minutes"} ago`;
  if (diffHours < 24) return `${diffHours} ${diffHours === 1 ? "hour" : "hours"} ago`;
  if (diffDays < 7) return `${diffDays} ${diffDays === 1 ? "day" : "days"} ago`;
  if (diffWeeks < 4) return `${diffWeeks} ${diffWeeks === 1 ? "week" : "weeks"} ago`;
  if (diffMonths < 12) return `${diffMonths} ${diffMonths === 1 ? "month" : "months"} ago`;
  return `${diffYears} ${diffYears === 1 ? "year" : "years"} ago`;
}

/**
 * Extract GitHub repository URL from Docker image name
 * @param {string} imageName - Docker image name (e.g., "ghcr.io/owner/repo" or "owner/repo")
 * @returns {string|null} - GitHub repository URL or null
 */
export function getGitHubRepoUrl(imageName) {
  if (!imageName) return null;

  // Remove tag if present
  const repo = imageName.split(":")[0];

  // Check for GitHub Container Registry (ghcr.io)
  if (repo.startsWith("ghcr.io/")) {
    const parts = repo.replace("ghcr.io/", "").split("/");
    if (parts.length >= 2) {
      return `https://github.com/${parts[0]}/${parts[1]}`;
    }
  }

  // Check for common GitHub Docker Hub patterns
  // Many projects use their GitHub username/org as Docker Hub namespace
  // This is a best-effort guess - not always accurate
  const parts = repo.split("/");
  if (parts.length >= 2) {
    const namespace = parts[0];
    // Extract namespace for filtering
    // parts[1] is imageRepo - kept for potential future use

    // Skip common non-GitHub namespaces
    const skipNamespaces = [
      "library",
      "docker",
      "ubuntu",
      "alpine",
      "debian",
      "centos",
      "redis",
      "postgres",
      "mysql",
      "nginx",
      "node",
    ];
    if (skipNamespaces.includes(namespace.toLowerCase())) {
      return null;
    }

    // Try to construct GitHub URL (this is a guess)
    // In practice, you'd need to query Docker Hub API for source repository
    // For now, we'll return null for most cases and only handle ghcr.io explicitly
    return null;
  }

  return null;
}

/**
 * Strip common registry prefixes from image repository name
 * @param {string} repo - Image repository name
 * @returns {string} - Repository name without registry prefix
 */
function stripRegistryPrefix(repo) {
  if (!repo) return repo;

  // List of well-known registries to strip
  // These registries are often used but images may also be available on Docker Hub
  const registryPrefixes = [
    /^docker\.io\//,
    /^registry-1\.docker\.io\//,
    /^registry\.docker\.io\//,
    /^lscr\.io\//, // LinuxServer.io registry
    /^ghcr\.io\//, // GitHub Container Registry
    /^gcr\.io\//, // Google Container Registry
    /^registry\.gitlab\.com\//, // GitLab Container Registry
    /^quay\.io\//, // Quay.io
    /^mcr\.microsoft\.com\//, // Microsoft Container Registry
    /^public\.ecr\.aws\//, // AWS ECR Public
    /^nvcr\.io\//, // NVIDIA Container Registry
  ];

  let stripped = repo;
  for (const prefix of registryPrefixes) {
    stripped = stripped.replace(prefix, "");
  }

  return stripped;
}

/**
 * Get Docker Hub tags page URL for an image
 * @param {string} imageName - Full image name (e.g., "nginx:latest" or "user/repo:tag")
 * @returns {string} - Docker Hub tags page URL
 */
export function getDockerHubTagsUrl(imageName) {
  if (!imageName) return null;

  // Parse image name (remove tag if present)
  let repo = imageName;
  if (imageName.includes(":")) {
    const parts = imageName.split(":");
    repo = parts[0];
  }

  // Remove registry prefixes
  repo = stripRegistryPrefix(repo);

  // Format: https://hub.docker.com/r/{namespace}/{repo}/tags
  if (repo.includes("/")) {
    // User image
    return `https://hub.docker.com/r/${repo}/tags`;
  } else {
    // Official image (library)
    return `https://hub.docker.com/r/library/${repo}/tags`;
  }
}

/**
 * Get Docker Hub repository URL (main page, not tags or layers)
 * @param {string} imageName - Full image name (e.g., "nginx:latest" or "user/repo:tag")
 * @returns {string} - Docker Hub repository URL
 */
export function getDockerHubRepoUrl(imageName) {
  if (!imageName) return null;

  // Parse image name (remove tag if present)
  let repo = imageName;
  if (imageName.includes(":")) {
    const parts = imageName.split(":");
    repo = parts[0];
  }

  // Remove registry prefixes
  repo = stripRegistryPrefix(repo);

  // Format: https://hub.docker.com/r/{namespace}/{repo}
  if (repo.includes("/")) {
    // User image
    return `https://hub.docker.com/r/${repo}`;
  } else {
    // Official image (library)
    return `https://hub.docker.com/r/library/${repo}`;
  }
}

/**
 * Get Docker Hub URL for an image layer page
 * @param {string} imageName - Full image name (e.g., "nginx:latest" or "user/repo:tag")
 * @param {string} tag - Tag/version to use in the URL (required)
 * @returns {string} - Docker Hub layer URL
 */
export function getDockerHubUrl(imageName, tag = null) {
  if (!imageName) return null;

  // Parse image name
  let repo = imageName;
  let imageTag = tag;

  if (imageName.includes(":")) {
    const parts = imageName.split(":");
    repo = parts[0];
    // Only use imageTag from parameter if provided, otherwise use from imageName
    if (!imageTag) {
      imageTag = parts[1];
    }
  }

  // Remove registry prefixes
  repo = stripRegistryPrefix(repo);

  // Use the provided tag, or fallback to 'latest'
  const tagForUrl = imageTag || "latest";

  // Format: https://hub.docker.com/layers/{namespace}/{repo}/{tag}/images
  if (repo.includes("/")) {
    // User image
    return `https://hub.docker.com/layers/${repo}/${tagForUrl}/images`;
  } else {
    // Official image (library)
    return `https://hub.docker.com/layers/library/${repo}/${tagForUrl}/images`;
  }
}
