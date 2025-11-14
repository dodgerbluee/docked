/**
 * Response Helper
 * Utilities for consistent API responses
 */

const { ApiResponse } = require('../domain/dtos');
const { NotFoundError } = require('../domain/errors');

/**
 * Send success response
 * @param {Object} res - Express response object
 * @param {*} data - Response data
 * @param {Object} metadata - Additional metadata
 * @param {number} statusCode - HTTP status code (default: 200)
 */
function sendSuccess(res, data, metadata = {}, statusCode = 200) {
  res.status(statusCode).json(ApiResponse.success(data, metadata));
}

/**
 * Send error response (errors should be thrown, but this is for edge cases)
 * @param {Object} res - Express response object
 * @param {string|Error} error - Error message or error object
 * @param {number} statusCode - HTTP status code (default: 500)
 */
function sendError(res, error, statusCode = 500) {
  const message = error instanceof Error ? error.message : error;
  res.status(statusCode).json(ApiResponse.error(message));
}

/**
 * Send not found response
 * @param {Object} res - Express response object
 * @param {string} resource - Resource name
 */
function sendNotFound(res, resource = 'Resource') {
  throw new NotFoundError(resource);
}

/**
 * Send created response (201)
 * @param {Object} res - Express response object
 * @param {*} data - Response data
 * @param {Object} metadata - Additional metadata
 */
function sendCreated(res, data, metadata = {}) {
  sendSuccess(res, data, metadata, 201);
}

/**
 * Send no content response (204)
 * @param {Object} res - Express response object
 */
function sendNoContent(res) {
  res.status(204).send();
}

module.exports = {
  sendSuccess,
  sendError,
  sendNotFound,
  sendCreated,
  sendNoContent,
};

