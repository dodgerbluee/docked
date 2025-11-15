/**
 * Input validation utilities
 */

/**
 * Validates that required fields are present in request body
 * @param {Object} body - Request body
 * @param {string[]} requiredFields - Array of required field names
 * @returns {Object|null} - Error object if validation fails, null otherwise
 */
function validateRequiredFields(body, requiredFields) {
  const missing = requiredFields.filter((field) => !body[field]);
  if (missing.length > 0) {
    return {
      error: `Missing required fields: ${missing.join(", ")}`,
      missingFields: missing,
    };
  }
  return null;
}

/**
 * Validates container ID format
 * @param {string} containerId - Container ID to validate
 * @returns {boolean} - True if valid
 */
function isValidContainerId(containerId) {
  if (!containerId || typeof containerId !== "string" || containerId.length < 12) {
    return false;
  }
  return true;
}

/**
 * Validates endpoint ID
 * @param {string|number} endpointId - Endpoint ID to validate
 * @returns {boolean} - True if valid
 */
function isValidEndpointId(endpointId) {
  return endpointId !== undefined && endpointId !== null;
}

/**
 * Validates image name format
 * @param {string} imageName - Image name to validate
 * @returns {boolean} - True if valid
 */
function isValidImageName(imageName) {
  if (!imageName || typeof imageName !== "string" || imageName.length === 0) {
    return false;
  }
  return true;
}

/**
 * Validates Portainer URL format
 * @param {string} url - URL to validate
 * @returns {boolean} - True if valid
 */
function isValidPortainerUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Validates that a URL is safe from SSRF attacks
 * Blocks private/internal IP addresses and localhost
 * @param {string} url - URL to validate
 * @param {boolean} allowPrivateIPs - Whether to allow private IP ranges (default: false)
 * @returns {Object} - { valid: boolean, error?: string }
 */
function validateUrlForSSRF(url, allowPrivateIPs = false) {
  try {
    const parsed = new URL(url);

    // Only allow http and https protocols
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return {
        valid: false,
        error: "Only http and https protocols are allowed",
      };
    }

    const hostname = parsed.hostname.toLowerCase();

    // Block localhost and variants
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "0.0.0.0" ||
      hostname.startsWith("127.") ||
      hostname === "[::1]"
    ) {
      return {
        valid: false,
        error: "Localhost addresses are not allowed",
      };
    }

    // Check for IPv4 addresses
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const ipv4Match = hostname.match(ipv4Regex);

    if (ipv4Match) {
      const octets = ipv4Match.slice(1, 5).map(Number);

      // Validate IP range (0-255)
      if (octets.some((octet) => octet > 255)) {
        return {
          valid: false,
          error: "Invalid IP address format",
        };
      }

      // Block private IP ranges unless explicitly allowed
      if (!allowPrivateIPs) {
        // 10.0.0.0/8
        if (octets[0] === 10) {
          return {
            valid: false,
            error: "Private IP addresses (10.x.x.x) are not allowed",
          };
        }

        // 172.16.0.0/12
        if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
          return {
            valid: false,
            error: "Private IP addresses (172.16-31.x.x) are not allowed",
          };
        }

        // 192.168.0.0/16
        if (octets[0] === 192 && octets[1] === 168) {
          return {
            valid: false,
            error: "Private IP addresses (192.168.x.x) are not allowed",
          };
        }

        // 169.254.0.0/16 (link-local)
        if (octets[0] === 169 && octets[1] === 254) {
          return {
            valid: false,
            error: "Link-local addresses (169.254.x.x) are not allowed",
          };
        }

        // 224.0.0.0/4 (multicast)
        if (octets[0] >= 224 && octets[0] <= 239) {
          return {
            valid: false,
            error: "Multicast addresses are not allowed",
          };
        }
      }
    }

    // Check for IPv6 addresses (basic check)
    if (hostname.includes(":")) {
      // Block IPv6 localhost
      if (
        hostname === "[::1]" ||
        hostname === "::1" ||
        hostname.startsWith("[::ffff:127.") ||
        hostname.startsWith("::ffff:127.")
      ) {
        return {
          valid: false,
          error: "IPv6 localhost addresses are not allowed",
        };
      }

      // Block IPv6 private ranges (fc00::/7) unless allowed
      if (!allowPrivateIPs && (hostname.startsWith("[fc") || hostname.startsWith("fc"))) {
        return {
          valid: false,
          error: "IPv6 private addresses (fc00::/7) are not allowed",
        };
      }
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: `Invalid URL format: ${error.message}`,
    };
  }
}

/**
 * Validates array of images for deletion
 * @param {Array} images - Array of image objects
 * @returns {Object|null} - Error object if validation fails, null otherwise
 */
function validateImageArray(images) {
  if (!Array.isArray(images) || images.length === 0) {
    return { error: "images array is required and must not be empty" };
  }

  for (const image of images) {
    if (!image.id || !image.portainerUrl || !image.endpointId) {
      return {
        error: "Each image must have id, portainerUrl, and endpointId",
        invalidImage: image,
      };
    }
  }

  return null;
}

/**
 * Validates array of containers for batch upgrade
 * @param {Array} containers - Array of container objects
 * @returns {Object|null} - Error object if validation fails, null otherwise
 */
function validateContainerArray(containers) {
  if (!Array.isArray(containers) || containers.length === 0) {
    return { error: "containers array is required and must not be empty" };
  }

  for (const container of containers) {
    if (
      !container.containerId ||
      !container.endpointId ||
      !container.imageName ||
      !container.portainerUrl
    ) {
      return {
        error: "Each container must have containerId, endpointId, imageName, and portainerUrl",
        invalidContainer: container,
      };
    }
  }

  return null;
}

module.exports = {
  validateRequiredFields,
  isValidContainerId,
  isValidEndpointId,
  isValidImageName,
  isValidPortainerUrl,
  validateUrlForSSRF,
  validateImageArray,
  validateContainerArray,
};
