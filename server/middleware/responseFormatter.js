/**
 * Response Formatter Middleware
 * Ensures all API responses follow a consistent format
 * Automatically wraps responses with success/error structure
 */

/**
 * Response formatter middleware
 * Intercepts res.json() calls to ensure consistent response format
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function responseFormatter(req, res, next) {
  // Store original json method
  const originalJson = res.json.bind(res);

  // Override json method to ensure consistent format
  res.json = function (data) {
    // If response already has success field, assume it's properly formatted
    if (data && typeof data === "object" && "success" in data) {
      return originalJson(data);
    }

    // Auto-format success responses (2xx status codes)
    if (res.statusCode >= 200 && res.statusCode < 300) {
      return originalJson({
        success: true,
        ...data,
      });
    }

    // Auto-format error responses (4xx, 5xx status codes)
    return originalJson({
      success: false,
      error: data?.error || data?.message || "An error occurred",
      ...(data?.details && { details: data.details }),
      ...(data?.missingFields && { missingFields: data.missingFields }),
    });
  };

  next();
}

module.exports = responseFormatter;
