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
      error: `Missing required fields: ${missing.join(', ')}`,
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
  return containerId && typeof containerId === 'string' && containerId.length >= 12;
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
  return imageName && typeof imageName === 'string' && imageName.length > 0;
}

/**
 * Validates Portainer URL format
 * @param {string} url - URL to validate
 * @returns {boolean} - True if valid
 */
function isValidPortainerUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validates array of images for deletion
 * @param {Array} images - Array of image objects
 * @returns {Object|null} - Error object if validation fails, null otherwise
 */
function validateImageArray(images) {
  if (!Array.isArray(images) || images.length === 0) {
    return { error: 'images array is required and must not be empty' };
  }

  for (const image of images) {
    if (!image.id || !image.portainerUrl || !image.endpointId) {
      return {
        error: 'Each image must have id, portainerUrl, and endpointId',
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
    return { error: 'containers array is required and must not be empty' };
  }

  for (const container of containers) {
    if (
      !container.containerId ||
      !container.endpointId ||
      !container.imageName ||
      !container.portainerUrl
    ) {
      return {
        error: 'Each container must have containerId, endpointId, imageName, and portainerUrl',
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
  validateImageArray,
  validateContainerArray,
};

