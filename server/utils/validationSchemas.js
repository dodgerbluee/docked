/**
 * Validation Schemas
 * Centralized validation schemas using Joi
 */

const Joi = require('joi');

/**
 * Common validation field schemas
 */
const fields = {
  containerId: Joi.string().min(12).required(),
  endpointId: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
  imageName: Joi.string().min(1).required(),
  portainerUrl: Joi.string().uri().required(),
};

/**
 * Common validation schemas
 */
const schemas = {
  // Container schemas
  containerId: fields.containerId,
  endpointId: fields.endpointId,
  imageName: fields.imageName,
  portainerUrl: fields.portainerUrl,

  // Container upgrade request
  upgradeContainer: Joi.object({
    endpointId: fields.endpointId,
    imageName: fields.imageName,
    portainerUrl: fields.portainerUrl,
  }),

  // Batch upgrade request
  batchUpgrade: Joi.object({
    containers: Joi.array().items(
      Joi.object({
        containerId: fields.containerId,
        endpointId: fields.endpointId,
        imageName: fields.imageName,
        portainerUrl: fields.portainerUrl,
        containerName: Joi.string().optional(),
      })
    ).min(1).required(),
  }),

  // Portainer instance schemas
  portainerInstance: Joi.object({
    name: Joi.string().min(1).max(255).required(),
    url: Joi.string().uri().required(),
    username: Joi.string().allow('').optional(),
    password: Joi.string().allow('').optional(),
    apiKey: Joi.string().allow(null, '').optional(),
    authType: Joi.string().valid('password', 'apikey').default('password'),
    ipAddress: Joi.string().ip().allow(null, '').optional(),
  }),

  // Tracked image schemas
  trackedImage: Joi.object({
    name: Joi.string().min(1).max(255).required(),
    imageName: Joi.string().allow(null, '').optional(),
    githubRepo: Joi.string().allow(null, '').optional(),
    sourceType: Joi.string().valid('docker', 'github', 'gitlab').default('docker'),
    gitlabToken: Joi.string().allow(null, '').optional(),
  }),

  // Auth schemas
  login: Joi.object({
    username: Joi.string().min(1).max(255).required(),
    password: Joi.string().min(1).required(),
  }),

  updatePassword: Joi.object({
    currentPassword: Joi.string().min(1).required(),
    newPassword: Joi.string().min(8).required(),
  }),

  updateUsername: Joi.object({
    newUsername: Joi.string().min(1).max(255).required(),
  }),

  // Docker Hub credentials
  dockerHubCredentials: Joi.object({
    username: Joi.string().min(1).required(),
    token: Joi.string().min(1).required(),
  }),

  // Discord webhook schemas
  discordWebhook: Joi.object({
    webhookUrl: Joi.string().uri().required(),
    serverName: Joi.string().allow(null, '').optional(),
    channelName: Joi.string().allow(null, '').optional(),
    avatarUrl: Joi.string().uri().allow(null, '').optional(),
    guildId: Joi.string().allow(null, '').optional(),
    channelId: Joi.string().allow(null, '').optional(),
    enabled: Joi.boolean().default(true),
  }),

  // Batch config schemas
  batchConfig: Joi.object({
    enabled: Joi.boolean().required(),
    intervalMinutes: Joi.number().integer().min(1).max(1440).required(),
  }),

  // Image deletion schemas
  deleteImages: Joi.object({
    images: Joi.array().items(
      Joi.object({
        id: Joi.string().required(),
        portainerUrl: fields.portainerUrl,
        endpointId: fields.endpointId,
      })
    ).min(1).required(),
  }),

  // Settings schemas
  colorScheme: Joi.string().valid('light', 'dark', 'auto').required(),

  // Portainer instance order
  portainerInstanceOrder: Joi.object({
    instances: Joi.array().items(
      Joi.object({
        id: Joi.number().integer().required(),
        displayOrder: Joi.number().integer().min(0).required(),
      })
    ).min(1).required(),
  }),

  // Pull containers request
  pullContainers: Joi.object({
    portainerUrl: Joi.string().uri().allow(null, '').optional(),
  }),

  // Batch config update
  batchConfigUpdate: Joi.object({
    jobType: Joi.string().valid('docker-hub-pull', 'tracked-apps-check').required(),
    enabled: Joi.boolean().required(),
    intervalMinutes: Joi.number().integer().min(1).max(1440).required(),
  }),

  // Batch run create
  batchRunCreate: Joi.object({
    status: Joi.string().valid('running', 'completed', 'failed').optional(),
    jobType: Joi.string().valid('docker-hub-pull', 'tracked-apps-check').optional(),
    isManual: Joi.boolean().optional(),
  }),

  // Batch run update
  batchRunUpdate: Joi.object({
    status: Joi.string().valid('running', 'completed', 'failed').required(),
    containersChecked: Joi.number().integer().min(0).optional(),
    containersUpdated: Joi.number().integer().min(0).optional(),
    errorMessage: Joi.string().allow(null, '').optional(),
    logs: Joi.string().allow(null, '').optional(),
  }),

  // Batch trigger
  batchTrigger: Joi.object({
    jobType: Joi.string().valid('docker-hub-pull', 'tracked-apps-check').required(),
  }),

  // Log level
  logLevel: Joi.string().valid('info', 'debug').required(),

  // Tracked image update
  trackedImageUpdate: Joi.object({
    name: Joi.string().min(1).max(255).optional(),
    imageName: Joi.string().allow(null, '').optional(),
    current_version: Joi.string().allow(null, '').optional(),
    gitlabToken: Joi.string().allow(null, '').optional(),
  }),

  // Portainer instance validate
  portainerInstanceValidate: Joi.object({
    url: Joi.string().uri().required(),
    username: Joi.string().allow('').optional(),
    password: Joi.string().allow('').optional(),
    apiKey: Joi.string().allow(null, '').optional(),
    authType: Joi.string().valid('password', 'apikey').default('apikey'),
  }),

  // Portainer instance update
  portainerInstanceUpdate: Joi.object({
    name: Joi.string().min(1).max(255).optional(),
    url: Joi.string().uri().optional(),
    username: Joi.string().allow('').optional(),
    password: Joi.string().allow('').optional(),
    apiKey: Joi.string().allow(null, '').optional(),
    authType: Joi.string().valid('password', 'apikey').optional(),
    ipAddress: Joi.string().ip().allow(null, '').optional(),
  }),

  // Portainer instance order update (matches controller expectation)
  portainerInstanceOrderUpdate: Joi.object({
    orders: Joi.array().items(
      Joi.object({
        id: Joi.number().integer().required(),
        display_order: Joi.number().integer().min(0).required(),
      })
    ).min(1).required(),
  }).unknown(false), // Reject unknown fields

  // Discord webhook update
  discordWebhookUpdate: Joi.object({
    webhookUrl: Joi.string().uri().allow(null, '').optional(),
    serverName: Joi.string().allow(null, '').optional(),
    channelName: Joi.string().allow(null, '').optional(),
    enabled: Joi.boolean().optional(),
  }),

  // Discord webhook test
  discordWebhookTest: Joi.object({
    webhookUrl: Joi.string().uri().required(),
  }),

  // ID parameter
  idParam: Joi.object({
    id: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
  }),

  // Container ID parameter
  containerIdParam: Joi.object({
    containerId: fields.containerId,
  }),

  // Query parameters for batch runs
  batchRunsQuery: Joi.object({
    limit: Joi.number().integer().min(1).max(100).optional(),
    byJobType: Joi.string().valid('true', 'false').optional(),
  }),
};

/**
 * Validate request data against schema
 * @param {Object} data - Data to validate
 * @param {Joi.Schema} schema - Joi schema
 * @param {Object} options - Validation options
 * @returns {Object} - Validated and sanitized data
 * @throws {ValidationError} - If validation fails
 */
function validate(data, schema, options = {}) {
  const { ValidationError } = require('../domain/errors');
  const { abortEarly = true, stripUnknown = true } = options;

  const { error, value } = schema.validate(data, {
    abortEarly,
    stripUnknown,
    convert: true, // Convert types (e.g., string to number)
  });

  if (error) {
    const details = error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message,
    }));

    throw new ValidationError(
      `Validation failed: ${details[0].message}`,
      details[0].field,
      data[details[0].field]
    );
  }

  return value;
}

/**
 * Middleware factory for request validation
 * @param {Joi.Schema} schema - Schema to validate against
 * @param {Object} options - Validation options
 * @returns {Function} - Express middleware
 */
function validateRequest(schema, options = {}) {
  return (req, res, next) => {
    try {
      // Validate body, query, and params
      const dataToValidate = {
        ...req.body,
        ...req.query,
        ...req.params,
      };

      const validated = validate(dataToValidate, schema, options);
      
      // Replace request data with validated data
      req.body = validated;
      req.query = validated;
      req.params = validated;

      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Validate only request body
 */
function validateBody(schema, options = {}) {
  return (req, res, next) => {
    try {
      req.body = validate(req.body, schema, options);
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Validate only request query parameters
 */
function validateQuery(schema, options = {}) {
  return (req, res, next) => {
    try {
      req.query = validate(req.query, schema, options);
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Validate only request params
 */
function validateParams(schema, options = {}) {
  return (req, res, next) => {
    try {
      req.params = validate(req.params, schema, options);
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = {
  schemas,
  validate,
  validateRequest,
  validateBody,
  validateQuery,
  validateParams,
};

