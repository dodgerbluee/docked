/**
 * Image Repository Parser Utility
 * Handles parsing Docker image names to extract repository components
 */

/**
 * Clean image name by removing incomplete SHA256 digests
 * @param {string} imageName - Image name to clean
 * @returns {string} - Cleaned image name
 */
function cleanImageName(imageName) {
  if (imageName.includes("@sha256") && !imageName.includes("@sha256:")) {
    return imageName.replace("@sha256", "");
  }
  return imageName;
}

/**
 * Extract tag and name without tag from image name
 * @param {string} cleanedImageName - Cleaned image name
 * @returns {Object} - { tag, nameWithoutTag }
 */
function extractTag(cleanedImageName) {
  const parts = cleanedImageName.split(":");
  const tag = parts.length > 1 ? parts[parts.length - 1] : "latest";
  const nameWithoutTag = parts.slice(0, -1).join(":") || parts[0];
  return { tag, nameWithoutTag };
}

/**
 * Extract registry and path from image name
 * @param {string} nameWithoutTag - Image name without tag
 * @returns {Object} - { registry, path }
 */
function extractRegistry(nameWithoutTag) {
  const knownRegistries = ["ghcr.io", "gcr.io", "quay.io", "registry.gitlab.com", "docker.io"];
  for (const knownReg of knownRegistries) {
    if (nameWithoutTag.startsWith(`${knownReg}/`)) {
      return {
        registry: knownReg,
        path: nameWithoutTag.substring(knownReg.length + 1),
      };
    }
  }

  // Check for explicit docker.io/library or docker.io/user
  if (nameWithoutTag.startsWith("docker.io/")) {
    return {
      registry: "docker.io",
      path: nameWithoutTag.substring("docker.io/".length),
    };
  }

  return { registry: "docker.io", path: nameWithoutTag };
}

/**
 * Extract namespace and repository from path
 * @param {string} path - Path component
 * @param {string} registry - Registry name
 * @returns {Object} - { namespace, repository }
 */
function extractNamespaceAndRepo(path, registry) {
  const pathParts = path.split("/");
  if (pathParts.length > 1) {
    return {
      namespace: pathParts[0],
      repository: pathParts.slice(1).join("/"),
    };
  }
  if (registry === "docker.io") {
    return { namespace: null, repository: pathParts[0] };
  }
  return { namespace: null, repository: path };
}

/**
 * Build image repository identifier
 * @param {string} repository - Repository name
 * @param {string} registry - Registry name
 * @param {string|null} namespace - Namespace or null
 * @returns {string} - Image repository identifier
 */
function buildImageRepo(repository, registry, namespace) {
  if (registry !== "docker.io") {
    // For non-docker.io registries, include namespace if present
    // e.g., ghcr.io/blakeblackshear/frigate (not ghcr.io/frigate)
    if (namespace) {
      return `${registry}/${namespace}/${repository}`;
    }
    return `${registry}/${repository}`;
  }
  if (namespace) {
    return `${namespace}/${repository}`;
  }
  return repository;
}

/**
 * Parse image name to extract repository components
 * @param {string} imageName - Full image name (e.g., "nginx:latest", "library/nginx:1.21", "ghcr.io/user/repo:tag")
 * @returns {Object} - { imageRepo, registry, namespace, repository, tag }
 */
function parseImageName(imageName) {
  if (!imageName || typeof imageName !== "string") {
    throw new Error("Invalid image name provided");
  }

  const cleanedImageName = cleanImageName(imageName);
  const { tag, nameWithoutTag } = extractTag(cleanedImageName);
  const { registry, path } = extractRegistry(nameWithoutTag);
  const { namespace, repository } = extractNamespaceAndRepo(path, registry);
  const imageRepo = buildImageRepo(repository, registry, namespace);

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
