/**
 * Registry Client
 * 
 * OCI-compliant container registry client that handles:
 * - Single-arch manifests (OCI Image Manifest)
 * - Multi-arch manifest lists (OCI Image Index / Docker Manifest List)
 * - Platform-specific digest selection
 * 
 * This client queries registries directly using the OCI Distribution Spec
 * and never relies on docker pull or external CLI tools.
 * 
 * Key Principle: Always select the digest that matches the container's
 * actual platform (OS/architecture/variant), not a top-level manifest list digest.
 */

const axios = require("axios");
const logger = require("../utils/logger");

class RegistryClient {
  constructor() {
    this.authTokenCache = new Map(); // Cache auth tokens by registry
  }

  /**
   * Parse an image reference into registry, repository, and tag/digest
   * Normalizes to canonical OCI form: registry/namespace/repository[:tag|@digest]
   * 
   * @param {string} imageRef - Image reference (e.g., "postgres:15", "ghcr.io/owner/repo@sha256:...")
   * @returns {Object} Parsed components
   */
  parseImageReference(imageRef) {
    // Handle digest-pinned images
    let ref = imageRef;
    let digest = null;
    
    if (ref.includes("@sha256:")) {
      const parts = ref.split("@");
      ref = parts[0];
      digest = parts[1];
    }
    
    // Split into repository and tag
    const [repo, tag = "latest"] = ref.split(":");
    
    // Detect registry
    let registry, repository;
    
    if (repo.includes("/")) {
      const parts = repo.split("/");
      
      // Check if first part looks like a registry (has dots or port)
      if (parts[0].includes(".") || parts[0].includes(":")) {
        registry = parts[0];
        repository = parts.slice(1).join("/");
      } else {
        // Docker Hub with namespace
        registry = "registry-1.docker.io";
        repository = repo;
      }
    } else {
      // Docker Hub official image (library namespace)
      registry = "registry-1.docker.io";
      repository = `library/${repo}`;
    }
    
    // Normalize registry hostnames
    const registryNormalized = this._normalizeRegistry(registry);
    
    return {
      registry: registryNormalized,
      repository,
      tag: digest ? null : tag,
      digest,
      original: imageRef,
    };
  }

  /**
   * Normalize registry hostname
   * @private
   */
  _normalizeRegistry(registry) {
    const normalizationMap = {
      "docker.io": "registry-1.docker.io",
      "index.docker.io": "registry-1.docker.io",
      "registry.hub.docker.com": "registry-1.docker.io",
      "ghcr.io": "ghcr.io",
      "gcr.io": "gcr.io",
      "registry.gitlab.com": "registry.gitlab.com",
      "lscr.io": "lscr.io",
      "quay.io": "quay.io",
    };
    
    return normalizationMap[registry] || registry;
  }

  /**
   * Get authentication token for a registry
   * @private
   */
  async _getAuthToken(registry, repository) {
    const cacheKey = `${registry}/${repository}`;
    
    // Check cache
    const cached = this.authTokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }
    
    try {
      let authUrl;
      
      if (registry === "registry-1.docker.io") {
        authUrl = `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repository}:pull`;
      } else if (registry === "ghcr.io") {
        authUrl = `https://ghcr.io/token?scope=repository:${repository}:pull`;
      } else if (registry === "gcr.io") {
        authUrl = `https://gcr.io/v2/token?service=gcr.io&scope=repository:${repository}:pull`;
      } else if (registry === "registry.gitlab.com") {
        authUrl = `https://gitlab.com/jwt/auth?service=container_registry&scope=repository:${repository}:pull`;
      } else {
        // Try standard OCI auth endpoint
        authUrl = `https://${registry}/token?scope=repository:${repository}:pull`;
      }
      
      const response = await axios.get(authUrl, {
        timeout: 10000,
        validateStatus: (status) => status < 500,
      });
      
      const token = response.data?.token || response.data?.access_token;
      
      if (token) {
        // Cache for 5 minutes
        this.authTokenCache.set(cacheKey, {
          token,
          expiresAt: Date.now() + 5 * 60 * 1000,
        });
        return token;
      }
      
      return null;
    } catch (error) {
      logger.debug(`Auth failed for ${registry}/${repository} (will try anonymous):`, error.message);
      return null;
    }
  }

  /**
   * Get manifest from registry
   * @private
   */
  async _getManifest(registry, repository, tagOrDigest, authToken = null) {
    const manifestUrl = `https://${registry}/v2/${repository}/manifests/${tagOrDigest}`;
    
    const headers = {
      // Request both single-arch and multi-arch manifests
      Accept: [
        "application/vnd.docker.distribution.manifest.v2+json",
        "application/vnd.docker.distribution.manifest.list.v2+json",
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.oci.image.index.v1+json",
      ].join(", "),
    };
    
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }
    
    const response = await axios.get(manifestUrl, {
      headers,
      timeout: 15000,
      validateStatus: (status) => status < 500,
    });
    
    if (response.status !== 200) {
      throw new Error(`Failed to get manifest: HTTP ${response.status}`);
    }
    
    return {
      data: response.data,
      contentType: response.headers["content-type"] || "",
      digest: response.headers["docker-content-digest"],
    };
  }

  /**
   * Get platform-specific digest from registry
   * 
   * This is the core method that handles multi-arch correctly:
   * 1. Query the manifest for the tag
   * 2. If it's a manifest list, find the platform-specific manifest
   * 3. Return the digest that matches the container's platform
   * 
   * Why: Comparing a running container's digest to a manifest list digest
   * will always show a mismatch. We must compare platform-to-platform.
   * 
   * @param {string} imageRef - Image reference
   * @param {Object} platform - Platform object {os, architecture, variant}
   * @returns {Promise<Object>} {digest, tag, isManifestList}
   */
  async getPlatformSpecificDigest(imageRef, platform) {
    const parsed = this.parseImageReference(imageRef);
    
    // If image is already digest-pinned, return it
    if (parsed.digest) {
      logger.debug(
        `Image ${imageRef} is digest-pinned, returning: ${parsed.digest.substring(0, 20)}...`
      );
      return {
        digest: parsed.digest,
        tag: null,
        isManifestList: false,
        platform,
      };
    }
    
    logger.debug(
      `Querying registry ${parsed.registry}/${parsed.repository}:${parsed.tag} for platform ${platform.os}/${platform.architecture}${platform.variant ? `/${platform.variant}` : ""}`
    );
    
    try {
      // Get auth token
      const authToken = await this._getAuthToken(parsed.registry, parsed.repository);
      
      // Get manifest
      const manifest = await this._getManifest(
        parsed.registry,
        parsed.repository,
        parsed.tag,
        authToken
      );
      
      const contentType = manifest.contentType;
      
      // Check if this is a manifest list (multi-arch)
      if (
        contentType.includes("manifest.list") ||
        contentType.includes("image.index")
      ) {
        logger.debug(`Manifest list detected for ${imageRef}, selecting platform-specific digest`);
        
        const manifestList = manifest.data;
        
        if (!manifestList.manifests || !Array.isArray(manifestList.manifests)) {
          throw new Error("Invalid manifest list: no manifests array");
        }
        
        // Find matching platform
        const match = manifestList.manifests.find((m) => {
          if (!m.platform) return false;
          
          const osMatch = m.platform.os === platform.os;
          const archMatch = m.platform.architecture === platform.architecture;
          
          // Variant is optional - if container has no variant, match any variant
          // If container has variant, it must match exactly
          const variantMatch = !platform.variant || m.platform.variant === platform.variant;
          
          return osMatch && archMatch && variantMatch;
        });
        
        if (!match) {
          logger.warn(
            `No matching platform found in manifest list for ${imageRef} (wanted: ${platform.os}/${platform.architecture}${platform.variant ? `/${platform.variant}` : ""})`
          );
          
          // Fallback: use first manifest that matches OS/arch (ignore variant)
          const fallback = manifestList.manifests.find(
            (m) =>
              m.platform?.os === platform.os &&
              m.platform?.architecture === platform.architecture
          );
          
          if (fallback) {
            logger.debug(`Using fallback manifest (ignoring variant): ${fallback.digest.substring(0, 20)}...`);
            return {
              digest: fallback.digest,
              tag: parsed.tag,
              isManifestList: true,
              platform: fallback.platform,
            };
          }
          
          throw new Error(`No compatible platform found in manifest list`);
        }
        
        logger.debug(
          `Found platform-specific digest: ${match.digest.substring(0, 20)}... for ${platform.os}/${platform.architecture}`
        );
        
        return {
          digest: match.digest,
          tag: parsed.tag,
          isManifestList: true,
          platform: match.platform,
        };
      }
      
      // Single-arch manifest - use Docker-Content-Digest header or digest from manifest
      const digest =
        manifest.digest ||
        manifest.data?.config?.digest ||
        (manifest.data?.manifests?.[0]?.digest);
      
      if (!digest) {
        throw new Error("Could not extract digest from manifest");
      }
      
      logger.debug(`Single-arch manifest, digest: ${digest.substring(0, 20)}...`);
      
      return {
        digest,
        tag: parsed.tag,
        isManifestList: false,
        platform,
      };
    } catch (error) {
      logger.error(
        `Failed to get platform-specific digest for ${imageRef}:`,
        error.message
      );
      throw error;
    }
  }

  /**
   * Check if an update is available
   * Compares running digest (from Portainer) with registry digest (platform-specific)
   * 
   * @param {string} runningDigest - Digest from RepoDigests (via Portainer)
   * @param {string} registryDigest - Digest from registry (platform-specific)
   * @returns {boolean} True if update available
   */
  hasUpdate(runningDigest, registryDigest) {
    if (!runningDigest || !registryDigest) {
      return false;
    }
    
    // Normalize digests (remove sha256: prefix if present)
    const normalizeDigest = (d) => d.replace(/^sha256:/, "");
    
    const runningNormalized = normalizeDigest(runningDigest);
    const registryNormalized = normalizeDigest(registryDigest);
    
    return runningNormalized !== registryNormalized;
  }

  /**
   * Clear auth token cache
   */
  clearAuthCache() {
    this.authTokenCache.clear();
  }
}

module.exports = RegistryClient;
