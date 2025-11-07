/**
 * Portainer Instance Controller
 * Handles CRUD operations for Portainer instances
 */

const {
  getAllPortainerInstances,
  getPortainerInstanceById,
  createPortainerInstance,
  updatePortainerInstance,
  deletePortainerInstance,
  updatePortainerInstanceOrder,
} = require('../db/database');
const { validateRequiredFields } = require('../utils/validation');

/**
 * Get all Portainer instances
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function getInstances(req, res, next) {
  try {
    const instances = await getAllPortainerInstances();
    // Don't return passwords in the response
    const safeInstances = instances.map(({ password, ...rest }) => rest);
    res.json({
      success: true,
      instances: safeInstances,
    });
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
    const instance = await getPortainerInstanceById(parseInt(id));
    
    if (!instance) {
      return res.status(404).json({
        success: false,
        error: 'Portainer instance not found',
      });
    }

    // Don't return password in the response
    const { password, ...safeInstance } = instance;
    res.json({
      success: true,
      instance: safeInstance,
    });
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
    const { name, url, username, password } = req.body;

    // Validate required fields
    const validationError = validateRequiredFields(
      { name, url, username, password },
      ['name', 'url', 'username', 'password']
    );
    if (validationError) {
      return res.status(400).json(validationError);
    }

    // Validate URL format
    try {
      const urlObj = new URL(url);
      // Ensure URL has http or https
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        return res.status(400).json({
          success: false,
          error: 'URL must use http:// or https://',
        });
      }
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: 'Invalid URL format',
      });
    }

    // If name is empty, use URL hostname as default
    const instanceName = name.trim() || new URL(url).hostname;

    // Create instance
    const id = await createPortainerInstance(
      instanceName,
      url.trim(),
      username.trim(),
      password
    );

    res.json({
      success: true,
      message: 'Portainer instance created successfully',
      id,
    });
  } catch (error) {
    // Handle unique constraint violation
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({
        success: false,
        error: 'A Portainer instance with this URL already exists',
      });
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
    const { name, url, username, password } = req.body;

    // Check if instance exists
    const existing = await getPortainerInstanceById(parseInt(id));
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: 'Portainer instance not found',
      });
    }

    // Validate required fields (password is optional when updating)
    const validationError = validateRequiredFields(
      { name, url, username },
      ['name', 'url', 'username']
    );
    if (validationError) {
      return res.status(400).json(validationError);
    }

    // Validate URL format
    try {
      const urlObj = new URL(url);
      // Ensure URL has http or https
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        return res.status(400).json({
          success: false,
          error: 'URL must use http:// or https://',
        });
      }
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: 'Invalid URL format',
      });
    }

    // If name is empty, use URL hostname as default
    const instanceName = name.trim() || new URL(url).hostname;
    
    // If password is empty and we're updating, keep the existing password
    let passwordToUse = password;
    if (!password && existing.password) {
      passwordToUse = existing.password;
    }

    // Update instance
    await updatePortainerInstance(
      parseInt(id),
      instanceName,
      url.trim(),
      username.trim(),
      passwordToUse
    );

    res.json({
      success: true,
      message: 'Portainer instance updated successfully',
    });
  } catch (error) {
    // Handle unique constraint violation
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({
        success: false,
        error: 'A Portainer instance with this URL already exists',
      });
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

    // Delete instance
    await deletePortainerInstance(parseInt(id));

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
        return res.status(400).json({
          success: false,
          error: 'Each order entry must have id (number) and display_order (number)',
        });
      }
    }

    await updatePortainerInstanceOrder(orders);

    res.json({
      success: true,
      message: 'Portainer instance order updated successfully',
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getInstances,
  getInstance,
  createInstance,
  updateInstance,
  deleteInstance,
  updateInstanceOrder,
};

