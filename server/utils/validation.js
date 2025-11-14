/**
 * Input validation utilities
 * Uses typed errors for better error handling
 */

const { ValidationError } = require('../domain/errors');

/**
 * Validates that required fields are present in request body
 * @param {Object} body - Request body
 * @param {string[]} requiredFields - Array of required field names
 * @throws {ValidationError} - If validation fails
 */
function validateRequiredFields(body, requiredFields) {
  const missing = requiredFields.filter((field) => {
    const value = body[field];
    return value === undefined || value === null || value === '';
  });
  
  if (missing.length > 0) {
    throw new ValidationError(
      `Missing required fields: ${missing.join(', ')}`,
      missing[0], // First missing field
      null
    );
  }
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
 * @throws {ValidationError} - If validation fails
 */
function validateImageArray(images) {
  if (!Array.isArray(images) || images.length === 0) {
    throw new ValidationError('images array is required and must not be empty');
  }

  for (const image of images) {
    if (!image.id || !image.portainerUrl || !image.endpointId) {
      throw new ValidationError(
        'Each image must have id, portainerUrl, and endpointId',
        'images',
        image
      );
    }
  }
}

/**
 * Validates array of containers for batch upgrade
 * @param {Array} containers - Array of container objects
 * @throws {ValidationError} - If validation fails
 */
function validateContainerArray(containers) {
  if (!Array.isArray(containers) || containers.length === 0) {
    throw new ValidationError('containers array is required and must not be empty');
  }

  for (const container of containers) {
    if (
      !container.containerId ||
      !container.endpointId ||
      !container.imageName ||
      !container.portainerUrl
    ) {
      throw new ValidationError(
        'Each container must have containerId, endpointId, imageName, and portainerUrl',
        'containers',
        container
      );
    }
  }
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

