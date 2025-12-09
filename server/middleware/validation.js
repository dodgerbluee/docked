/**
 * Validation Middleware
 * Provides reusable validation middleware using express-validator
 */

const { body, param, query, validationResult } = require("express-validator");
const { ValidationError } = require("../utils/errors");

/**
 * Wrapper to run validation rules and handle errors
 * @param {Array} validations - Array of express-validator validation chains
 * @returns {Function} Express middleware function
 */
function validate(validations) {
  return async (req, res, next) => {
    // Run all validations
    await Promise.all(validations.map((validation) => validation.run(req)));

    // Check for validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const errorMessages = errors.array().map((e) => e.msg);
      const missingFields = errors
        .array()
        .filter((e) => e.type === "field")
        .map((e) => e.path);

      // Throw ValidationError to be caught by error handler
      throw new ValidationError(errorMessages.join(", "), missingFields, errors.array());
    }

    next();
  };
}

/**
 * Validation rules for common patterns
 */
const commonValidations = {
  // Container ID validation
  containerId: param("containerId")
    .isString()
    .isLength({ min: 12 })
    .withMessage("containerId must be at least 12 characters"),

  // Endpoint ID validation
  endpointId: body("endpointId")
    .notEmpty()
    .withMessage("endpointId is required")
    .custom(
      (value) =>
        // Accept both string and number
        typeof value === "string" || typeof value === "number"
    )
    .withMessage("endpointId must be a string or number"),

  // Image name validation
  imageName: body("imageName")
    .isString()
    .notEmpty()
    .withMessage("imageName is required")
    // eslint-disable-next-line prefer-named-capture-group -- Simple regex, named group not needed
    .matches(/^[a-zA-Z0-9._/-]+(:[a-zA-Z0-9._/-]+)?$/)
    .withMessage("imageName must be a valid Docker image name"),

  // Portainer URL validation
  portainerUrl: body("portainerUrl")
    .isURL({ protocols: ["http", "https"] })
    .withMessage("portainerUrl must be a valid HTTP/HTTPS URL"),

  // Portainer instance name validation
  portainerName: body("name")
    .isString()
    .trim()
    .isLength({ min: 1, max: 100 })
    .withMessage("name must be between 1 and 100 characters"),

  // Portainer instance URL validation
  portainerInstanceUrl: body("url")
    .isURL({ protocols: ["http", "https"] })
    .withMessage("url must be a valid HTTP/HTTPS URL"),

  // Auth type validation
  authType: body("auth_type")
    .isIn(["apikey", "password"])
    .withMessage("auth_type must be either 'apikey' or 'password'"),

  // Username validation
  username: body("username")
    .isString()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage("username must be between 1 and 50 characters")
    .matches(/^[a-zA-Z0-9_-]+$/)
    .withMessage("username can only contain letters, numbers, underscores, and hyphens"),

  // Password validation
  password: body("password")
    .isString()
    .isLength({ min: 8 })
    .withMessage("password must be at least 8 characters"),

  // Pagination validation
  page: query("page").optional().isInt({ min: 1 }).withMessage("page must be a positive integer"),

  limit: query("limit")
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage("limit must be between 1 and 100"),

  // User ID validation
  userId: param("userId").isInt({ min: 1 }).withMessage("userId must be a positive integer"),
};

/**
 * Pre-built validation chains for common endpoints
 */
const validationChains = {
  // Container upgrade validation
  // Note: containerId is validated as a path parameter, not in the body
  containerUpgrade: [
    commonValidations.endpointId,
    commonValidations.imageName,
    commonValidations.portainerUrl,
  ],

  // Portainer instance creation/update
  portainerInstance: [
    commonValidations.portainerName,
    commonValidations.portainerInstanceUrl,
    commonValidations.authType,
    body("api_key").optional().isString().withMessage("api_key must be a string"),
    body("username").optional().isString().withMessage("username must be a string"),
    body("password").optional().isString().withMessage("password must be a string"),
  ],

  // User creation/update
  user: [
    commonValidations.username,
    commonValidations.password,
    body("email").optional().isEmail().withMessage("email must be a valid email address"),
    body("role")
      .optional()
      .isIn(["Administrator", "User"])
      .withMessage("role must be either 'Administrator' or 'User'"),
  ],

  // Pagination
  pagination: [commonValidations.page, commonValidations.limit],
};

module.exports = {
  validate,
  commonValidations,
  validationChains,
};
