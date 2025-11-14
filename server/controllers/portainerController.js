/**
 * Portainer Instance Controller
 * Handles CRUD operations for Portainer instances
 * Uses: Repositories, ApiResponse, Typed errors, Validation
 */

const container = require('../di/container');
const portainerService = require('../services/portainerService');
const { sendSuccess, sendCreated, sendNoContent } = require('../utils/responseHelper');
const { NotFoundError, ValidationError, ExternalServiceError } = require('../domain/errors');
const logger = require('../utils/logger');
const { resolveUrlToIp, detectBackendIp } = require('../utils/dnsResolver');

// Resolve dependencies from container
const portainerInstanceRepository = container.resolve('portainerInstanceRepository');
const containerCacheService = container.resolve('containerCacheService');

/**
 * Validate Portainer instance credentials without creating the instance
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function validateInstance(req, res, next) {
  try {
    const { url, username, password, apiKey, authType = 'apikey' } = req.body;

    // Validate required fields based on auth type
    if (authType === 'apikey') {
      if (!url || !apiKey) {
        throw new ValidationError('url and apiKey are required for API key authentication', 'apiKey');
      }
    } else {
      if (!url || !username || !password) {
        throw new ValidationError('url, username, and password are required for password authentication');
      }
    }

    // Validate URL format
    try {
      const urlObj = new URL(url);
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        throw new ValidationError('URL must use http:// or https://', 'url', url);
      }
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      throw new ValidationError('Invalid URL format', 'url', url);
    }

    // Test authentication - skip cache to ensure we validate the actual credentials provided
    try {
      await portainerService.authenticatePortainer(
        url.trim(),
        username || null,
        password || null,
        apiKey || null,
        authType,
        true // skipCache = true for validation
      );
      
      // If we get here, authentication succeeded
      sendSuccess(res, { message: 'Authentication successful' });
    } catch (authError) {
      // Authentication failed - clear any cached token for this URL
      portainerService.clearAuthToken(url.trim());
      throw new ExternalServiceError('Portainer', authError.message || 'Authentication failed. Please check your credentials.', 401);
    }
  } catch (error) {
    next(error);
  }
}

/**
 * Get all Portainer instances
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getInstances(req, res, next) {
  try {
    const instances = await portainerInstanceRepository.findAll();
    // Don't return passwords or API keys in the response
    const safeInstances = instances.map(({ password, api_key, ...rest }) => rest);
    sendSuccess(res, { instances: safeInstances });
  } catch (error) {
    next(error);
  }
}

/**
 * Get a single Portainer instance
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getInstance(req, res, next) {
  try {
    const { id } = req.params;
    const instance = await portainerInstanceRepository.findById(parseInt(id));
    
    if (!instance) {
      throw new NotFoundError('Portainer instance');
    }

    // Don't return password or API key in the response
    const { password, api_key, ...safeInstance } = instance;
    sendSuccess(res, { instance: safeInstance });
  } catch (error) {
    next(error);
  }
}

/**
 * Create a new Portainer instance
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function createInstance(req, res, next) {
  try {
    const { name, url, username, password, apiKey, authType = 'apikey' } = req.body;

    // Validate required fields based on auth type
    if (authType === 'apikey') {
      if (!name || !url || !apiKey) {
        throw new ValidationError('name, url, and apiKey are required for API key authentication', 'apiKey');
      }
    } else {
      if (!name || !url || !username || !password) {
        throw new ValidationError('name, url, username, and password are required for password authentication');
      }
    }

    // Validate URL format
    try {
      const urlObj = new URL(url);
      // Ensure URL has http or https
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        throw new ValidationError('URL must use http:// or https://', 'url', url);
      }
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      throw new ValidationError('Invalid URL format', 'url', url);
    }

    // If name is empty, use URL hostname as default
    const instanceName = name.trim() || new URL(url).hostname;

    // Check if instance with this URL already exists
    // Normalize URL for comparison (trim, remove trailing slash, lowercase)
    const normalizedUrl = url.trim().toLowerCase().replace(/\/$/, '');
    const existing = await portainerInstanceRepository.findByUrl(url.trim());
    
    // Also check if any existing instance has a normalized URL that matches
    if (!existing) {
      const allInstances = await portainerInstanceRepository.findAll();
      const matchingInstance = allInstances.find(inst => {
        const existingNormalized = inst.url.trim().toLowerCase().replace(/\/$/, '');
        return existingNormalized === normalizedUrl;
      });
      
      if (matchingInstance) {
        const { ConflictError } = require('../domain/errors');
        throw new ConflictError('A Portainer instance with this URL already exists');
      }
    } else {
      const { ConflictError } = require('../domain/errors');
      throw new ConflictError('A Portainer instance with this URL already exists');
    }

    // Resolve URL to IP address for fallback when DNS fails
    let ipAddress = await resolveUrlToIp(url.trim());
    if (ipAddress) {
      logger.debug('Resolved Portainer URL to IP address', {
        module: 'portainerController',
        operation: 'createInstance',
        url: url.trim(),
        ipAddress: ipAddress,
      });
      
      // Try to detect the actual backend IP if behind a proxy
      // This is useful when the resolved IP is a proxy (like nginx proxy manager)
      // and we need the actual Portainer instance IP
      try {
        const backendIp = await detectBackendIp(
          ipAddress,
          url.trim(),
          apiKey || null,
          username || null,
          password || null,
          authType
        );
        
        if (backendIp && backendIp !== ipAddress) {
          logger.debug('Detected backend IP behind proxy', {
            module: 'portainerController',
            operation: 'createInstance',
            url: url.trim(),
            proxyIp: ipAddress,
            backendIp: backendIp,
          });
          ipAddress = backendIp; // Use the detected backend IP instead
        }
      } catch (detectError) {
        // Non-fatal - if detection fails, use the proxy IP
        logger.warn('Backend IP detection failed, using proxy IP', {
          module: 'portainerController',
          operation: 'createInstance',
          url: url.trim(),
          error: detectError,
        });
      }
    } else {
      logger.warn('Failed to resolve URL to IP address', {
        module: 'portainerController',
        operation: 'createInstance',
        url: url.trim(),
        note: 'Will use URL only',
      });
    }

    // Create instance
    const id = await portainerInstanceRepository.create({
      name: instanceName,
      url: url.trim(),
      username: authType === 'apikey' ? '' : (username ? username.trim() : ''),
      password: authType === 'apikey' ? '' : (password || ''),
      apiKey: apiKey || null,
      authType,
      ipAddress,
    });

    sendCreated(res, {
      message: 'Portainer instance created successfully',
      id,
    });
  } catch (error) {
    // Handle unique constraint violation
    if (error.message && error.message.includes('UNIQUE constraint failed')) {
      const { ConflictError } = require('../domain/errors');
      throw new ConflictError('A Portainer instance with this URL already exists');
    }
    next(error);
  }
}

/**
 * Update a Portainer instance
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function updateInstance(req, res, next) {
  try {
    const { id } = req.params;
    const { name, url, username, password, apiKey, authType } = req.body;

    // Check if instance exists
    const existing = await getPortainerInstanceById(parseInt(id));
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Portainer instance not found',
      });
    }

    // Use existing authType if not provided
    const finalAuthType = authType || existing.auth_type || 'apikey';

    // Validate required fields based on auth type
    if (finalAuthType === 'apikey') {
      if (!name || !url) {
        throw new ValidationError('name and url are required', 'name');
      }
      // For API key auth, apiKey is required if not updating (keeping existing)
      if (!apiKey && !existing.api_key) {
        throw new ValidationError('API key is required for API key authentication', 'apiKey');
      }
    } else {
      if (!name || !url || !username) {
        throw new ValidationError('name, url, and username are required for password authentication');
      }
    }

    // Validate URL format
    try {
      const urlObj = new URL(url);
      // Ensure URL has http or https
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        throw new ValidationError('URL must use http:// or https://', 'url', url);
      }
    } catch (err) {
      if (err instanceof ValidationError) throw err;
      throw new ValidationError('Invalid URL format', 'url', url);
    }

    // If name is empty, use URL hostname as default
    const instanceName = name.trim() || new URL(url).hostname;
    
    // Resolve URL to IP address for fallback when DNS fails
    // Only resolve if URL changed, otherwise keep existing IP
    let ipAddress = existing.ip_address;
    if (url.trim() !== existing.url) {
      let resolvedIp = await resolveUrlToIp(url.trim());
      if (resolvedIp) {
        logger.debug('Resolved Portainer URL to IP address for update', {
          module: 'portainerController',
          operation: 'updateInstance',
          url: url.trim(),
          ipAddress: resolvedIp,
        });
        
        // Try to detect the actual backend IP if behind a proxy
        try {
          const backendIp = await detectBackendIp(
            resolvedIp,
            url.trim(),
            apiKey || existing.api_key || null,
            username || existing.username || null,
            password || existing.password || null,
            finalAuthType
          );
          
          if (backendIp && backendIp !== resolvedIp) {
            logger.debug('Detected backend IP behind proxy for update', {
              module: 'portainerController',
              operation: 'updateInstance',
              url: url.trim(),
              proxyIp: resolvedIp,
              backendIp: backendIp,
            });
            resolvedIp = backendIp;
          }
        } catch (detectError) {
          // Non-fatal - if detection fails, use the proxy IP
          logger.warn('Backend IP detection failed during update, using proxy IP', {
            module: 'portainerController',
            operation: 'updateInstance',
            url: url.trim(),
            error: detectError,
          });
        }
        
        ipAddress = resolvedIp;
      } else {
        logger.warn(`Failed to resolve ${url.trim()} to IP address - keeping existing IP if available`);
      }
    }
    
    // Handle credentials based on auth type
    // IMPORTANT: When switching auth methods, explicitly clear the old method's data
    let passwordToUse = null;
    let apiKeyToUse = null;
    
    // Check if auth type is changing
    const authTypeChanged = existing.auth_type !== finalAuthType;
    
    if (finalAuthType === 'apikey') {
      // For API key auth, use provided apiKey or keep existing (if not switching)
      apiKeyToUse = apiKey || (authTypeChanged ? null : existing.api_key);
      // Always clear password data when using API key auth
      passwordToUse = '';
    } else {
      // For password auth, use provided password or keep existing (if not switching)
      passwordToUse = password || (authTypeChanged ? '' : existing.password);
      // Always clear API key data when using password auth
      apiKeyToUse = null;
    }

    // Update instance
    await portainerInstanceRepository.update(parseInt(id), {
      name: instanceName,
      url: url.trim(),
      username: finalAuthType === 'apikey' ? '' : (username ? username.trim() : ''),
      password: passwordToUse || '',
      apiKey: apiKeyToUse,
      authType: finalAuthType,
      ipAddress,
    });

    sendSuccess(res, { message: 'Portainer instance updated successfully' });
  } catch (error) {
    // Handle unique constraint violation
    if (error.message && error.message.includes('UNIQUE constraint failed')) {
      const { ConflictError } = require('../domain/errors');
      throw new ConflictError('A Portainer instance with this URL already exists');
    }
    next(error);
  }
}

/**
 * Delete a Portainer instance
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function deleteInstance(req, res, next) {
  try {
    const { id } = req.params;

    // Check if instance exists
    const existing = await getPortainerInstanceById(parseInt(id));
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Portainer instance not found',
      });
    }

    // Get the instance URL before deletion so we can remove its containers from cache
    const deletedInstanceUrl = existing.url;
    
    // Normalize URL for comparison (remove trailing slash, lowercase)
    const normalizeUrl = (url) => {
      if (!url) return '';
      return url.trim().replace(/\/+$/, '').toLowerCase();
    };
    const normalizedDeletedUrl = normalizeUrl(deletedInstanceUrl);

    // Delete instance
    await portainerInstanceRepository.delete(parseInt(id));

    // Remove containers from cache that belong to the deleted instance
    try {
      const cached = await containerCacheService.get('containers');
      if (cached && cached.containers && Array.isArray(cached.containers)) {
        // Log for debugging
        const totalContainersBefore = cached.containers.length;
        const containersWithUpdatesBefore = cached.containers.filter(c => c.hasUpdate).length;
        
        // Filter out containers from the deleted instance using normalized URL comparison
        // IMPORTANT: Preserve all container properties including hasUpdate flag
        const filteredContainers = cached.containers.filter(
          (container) => {
            const containerUrl = normalizeUrl(container.portainerUrl);
            const shouldKeep = containerUrl !== normalizedDeletedUrl;
            return shouldKeep;
          }
        );

        // Log for debugging
        const totalContainersAfter = filteredContainers.length;
        const containersWithUpdatesAfter = filteredContainers.filter(c => c.hasUpdate).length;
        logger.info('Filtering containers from cache after instance deletion', {
          module: 'portainerController',
          operation: 'deleteInstance',
          instanceUrl: deletedInstanceUrl,
          containersBefore: totalContainersBefore,
          containersAfter: totalContainersAfter,
          withUpdatesBefore: containersWithUpdatesBefore,
          withUpdatesAfter: containersWithUpdatesAfter,
        });

        // Filter out the instance from portainerInstances array using normalized URL comparison
        const filteredInstances = cached.portainerInstances
          ? cached.portainerInstances.filter(
              (instance) => normalizeUrl(instance.url) !== normalizedDeletedUrl
            )
          : [];

        // Update stacks to remove containers from deleted instance using normalized URL comparison
        const filteredStacks = cached.stacks
          ? cached.stacks.map((stack) => ({
              ...stack,
              containers: stack.containers
                ? stack.containers.filter(
                    (container) => normalizeUrl(container.portainerUrl) !== normalizedDeletedUrl
                  )
                : [],
            })).filter((stack) => stack.containers && stack.containers.length > 0)
          : [];

        // Recalculate portainerInstances stats based on filtered containers
        // IMPORTANT: Use the filtered containers array which preserves hasUpdate flags
        const recalculatedInstances = filteredInstances.map((instance) => {
          const instanceUrl = normalizeUrl(instance.url);
          const instanceContainers = filteredContainers.filter(
            (c) => normalizeUrl(c.portainerUrl) === instanceUrl
          );
          
          // Preserve hasUpdate flag from filtered containers
          const withUpdates = instanceContainers.filter((c) => c.hasUpdate === true);
          const upToDate = instanceContainers.filter((c) => c.hasUpdate !== true);
          
          logger.debug('Recalculated instance stats after filtering', {
            module: 'portainerController',
            operation: 'deleteInstance',
            instanceName: instance.name,
            instanceUrl: instance.url,
            totalContainers: instanceContainers.length,
            withUpdates: withUpdates.length,
            upToDate: upToDate.length,
          });
          
          return {
            ...instance,
            containers: instanceContainers,
            withUpdates: withUpdates,
            upToDate: upToDate,
            totalContainers: instanceContainers.length,
          };
        });

        // Recalculate unused images count based on remaining containers
        // Since we don't have the unused images list in cache, we'll recalculate
        // by counting containers that are not in use. For now, we'll keep the existing
        // count but it will be recalculated on the next fetch.
        // The count will be updated correctly when containers are next fetched.

        // Update cache with filtered data
        const updatedCache = {
          ...cached,
          containers: filteredContainers,
          portainerInstances: recalculatedInstances,
          stacks: filteredStacks,
          // unusedImagesCount will be recalculated on next fetch based on remaining instances
        };

        await containerCacheService.set('containers', updatedCache);
        logger.info('Removed containers from cache for deleted instance', {
          module: 'portainerController',
          operation: 'deleteInstance',
          instanceUrl: deletedInstanceUrl,
          containersRemoved: totalContainersBefore - totalContainersAfter,
        });
      }
    } catch (cacheError) {
      // Log error but don't fail the delete operation
      logger.error('Error updating container cache after instance deletion', {
        module: 'portainerController',
        operation: 'deleteInstance',
        instanceUrl: deletedInstanceUrl,
        error: cacheError,
      });
    }

    res.json({
      success: true,
      message: 'Portainer instance deleted successfully',
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Update the display order of Portainer instances
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function updateInstanceOrder(req, res, next) {
  try {
    const { orders } = req.body;

    if (!Array.isArray(orders)) {
      return res.status(400).json({
        success: false,
        error: 'orders must be an array',
      });
    }

    // Validate each order entry
    for (const order of orders) {
      if (typeof order.id !== 'number' || typeof order.display_order !== 'number') {
        throw new ValidationError('Each order entry must have id (number) and display_order (number)', 'orders', order);
      }
    }

    await portainerInstanceRepository.updateOrder(orders);

    sendSuccess(res, { message: 'Portainer instance order updated successfully' });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  validateInstance,
  getInstances,
  getInstance,
  createInstance,
  updateInstance,
  deleteInstance,
  updateInstanceOrder,
};

