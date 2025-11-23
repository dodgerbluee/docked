/**
 * Input validation utilities
 */

/**
 * Validates that required fields are present in request body
 * @param {Object} body - Request body
 * @param {string[]} requiredFields - Array of required field names
 * @returns {Object|null} - Error object if validation fails, null otherwise
 */
/**
 * Validates that required fields are present in request body
 * @param {Object} body - Request body
 * @param {string[]} requiredFields - Array of required field names
 * @returns {Object|null} - Standardized error object if validation fails, null otherwise
 */
function validateRequiredFields(body, requiredFields) {
  const missing = requiredFields.filter((field) => !body[field]);
  if (missing.length > 0) {
    return {
      success: false,
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
 * Validates and sanitizes a path component to prevent path traversal attacks
 * @param {string|number} pathComponent - Path component to validate
 * @returns {Object} - { valid: boolean, sanitized?: string, error?: string }
 */
function validatePathComponent(pathComponent) {
  if (pathComponent === undefined || pathComponent === null) {
    return {
      valid: false,
      error: "Path component cannot be null or undefined",
    };
  }

  // Convert to string for validation
  const str = String(pathComponent);

  // Block path traversal attempts
  if (
    str.includes("..") ||
    str.includes("/") ||
    str.includes("\\") ||
    str.includes("%2e") ||
    str.includes("%2f") ||
    str.includes("%5c") ||
    str.trim() !== str ||
    str.length === 0
  ) {
    return {
      valid: false,
      error: "Path component contains invalid characters",
    };
  }

  // Additional check: ensure it's alphanumeric with allowed characters (for IDs)
  // Allow alphanumeric, hyphens, underscores (common in IDs)
  if (!/^[a-zA-Z0-9_-]+$/.test(str)) {
    return {
      valid: false,
      error: "Path component contains invalid characters",
    };
  }

  return {
    valid: true,
    sanitized: str,
  };
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

/**
 * Validates email format using a ReDoS-safe regex pattern
 * Uses a more specific pattern to avoid catastrophic backtracking
 * @param {string} email - Email address to validate
 * @returns {boolean} - True if email format is valid
 */
function isValidEmail(email) {
  if (!email || typeof email !== "string") {
    return false;
  }

  // ReDoS-safe email validation pattern
  // Uses specific character classes instead of negated character classes with quantifiers
  // This avoids catastrophic backtracking that can occur with [^\s@]+ patterns
  // Pattern breakdown:
  // - Local part: [a-zA-Z0-9._%+-]+ (alphanumeric and common email characters)
  // - @ symbol
  // - Domain: [a-zA-Z0-9.-]+ (alphanumeric, dots, hyphens)
  // - TLD: \.[a-zA-Z]{2,} (at least 2 letters)
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

  // Additional length check to prevent extremely long inputs
  if (email.length > 254) {
    return false;
  }

  return emailRegex.test(email);
}

module.exports = {
  validateRequiredFields,
  isValidContainerId,
  isValidEndpointId,
  isValidImageName,
  isValidPortainerUrl,
  validateUrlForSSRF,
  validatePathComponent,
  validateImageArray,
  validateContainerArray,
  isValidEmail,
};
