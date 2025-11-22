/**
 * Image Repository Parser Utility
 * Handles parsing Docker image names to extract repository components
 */

/**
 * Parse image name to extract repository components
 * @param {string} imageName - Full image name (e.g., "nginx:latest", "library/nginx:1.21", "ghcr.io/user/repo:tag")
 * @returns {Object} - { imageRepo, registry, namespace, repository, tag }
 */
function parseImageName(imageName) {
  if (!imageName || typeof imageName !== "string") {
    throw new Error("Invalid image name provided");
  }

  // Handle incomplete SHA256 digests (e.g., "image:tag@sha256" without hash)
  // Remove incomplete digest markers
  let cleanedImageName = imageName;
  if (cleanedImageName.includes("@sha256") && !cleanedImageName.includes("@sha256:")) {
    // Remove incomplete @sha256 marker
    cleanedImageName = cleanedImageName.replace("@sha256", "");
  }

  // Split by colon to separate tag
  const parts = cleanedImageName.split(":");
  const tag = parts.length > 1 ? parts[parts.length - 1] : "latest";
  const nameWithoutTag = parts.slice(0, -1).join(":") || parts[0];

  // Check for registry (contains a dot or is a known registry)
  let registry = "docker.io";
  let path = nameWithoutTag;

  // Known registries
  const knownRegistries = ["ghcr.io", "gcr.io", "quay.io", "registry.gitlab.com", "docker.io"];
  for (const knownReg of knownRegistries) {
    if (nameWithoutTag.startsWith(knownReg + "/")) {
      registry = knownReg;
      path = nameWithoutTag.substring(knownReg.length + 1);
      break;
    }
  }

  // Check for explicit docker.io/library or docker.io/user
  if (nameWithoutTag.startsWith("docker.io/")) {
    registry = "docker.io";
    path = nameWithoutTag.substring("docker.io/".length);
  }

  // Split path into namespace and repository
  const pathParts = path.split("/");
  let namespace = null;
  let repository = path;

  if (pathParts.length > 1) {
    namespace = pathParts[0];
    repository = pathParts.slice(1).join("/");
  } else if (registry === "docker.io") {
    // Docker Hub official images don't have a namespace prefix
    // e.g., "nginx" -> namespace: null, repository: "nginx"
    namespace = null;
    repository = pathParts[0];
  }

  // Build image_repo (without tag) - this is the key for our database
  let imageRepo = repository;
  if (registry !== "docker.io") {
    imageRepo = `${registry}/${repository}`;
  } else if (namespace) {
    imageRepo = `${namespace}/${repository}`;
  }

  return {
    imageRepo,
    registry,
    namespace,
    repository,
    tag,
    imageName: nameWithoutTag,
  };
}

/**
 * Extract image repository (without tag) from image name
 * @param {string} imageName - Full image name
 * @returns {string} - Repository without tag (e.g., "nginx", "library/nginx", "ghcr.io/user/repo")
 */
function extractImageRepo(imageName) {
  const parsed = parseImageName(imageName);
  return parsed.imageRepo;
}

/**
 * Normalize image name to standard format
 * @param {string} imageName - Image name in any format
 * @returns {string} - Normalized image name (registry/namespace/repository:tag)
 */
function normalizeImageName(imageName) {
  const parsed = parseImageName(imageName);
  let normalized = parsed.repository;

  if (parsed.namespace) {
    normalized = `${parsed.namespace}/${normalized}`;
  }

  if (parsed.registry !== "docker.io") {
    normalized = `${parsed.registry}/${normalized}`;
  }

  return `${normalized}:${parsed.tag}`;
}

module.exports = {
  parseImageName,
  extractImageRepo,
  normalizeImageName,
};
