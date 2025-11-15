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
  getContainerCache,
  setContainerCache,
} = require("../db/database");
const { validateRequiredFields } = require("../utils/validation");
const portainerService = require("../services/portainerService");
const logger = require("../utils/logger");
const { resolveUrlToIp } = require("../utils/dnsResolver");

/**
 * Validate Portainer instance credentials without creating the instance
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
async function validateInstance(req, res, next) {
  try {
    const { url, username, password, apiKey, authType = "apikey" } = req.body;

    // Validate required fields based on auth type
    if (authType === "apikey") {
      const validationError = validateRequiredFields({ url, apiKey }, ["url", "apiKey"]);
      if (validationError) {
        return res.status(400).json(validationError);
      }
    } else {
      const validationError = validateRequiredFields({ url, username, password }, [
        "url",
        "username",
        "password",
      ]);
      if (validationError) {
        return res.status(400).json(validationError);
      }
    }

    // Validate URL format
    try {
      const urlObj = new URL(url);
      if (!["http:", "https:"].includes(urlObj.protocol)) {
        return res.status(400).json({
          success: false,
          error: "URL must use http:// or https://",
        });
      }
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: "Invalid URL format",
      });
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
      res.json({
        success: true,
        message: "Authentication successful",
      });
    } catch (authError) {
      // Authentication failed - clear any cached token for this URL
      portainerService.clearAuthToken(url.trim());
      return res.status(401).json({
        success: false,
        error: authError.message || "Authentication failed. Please check your credentials.",
      });
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
    const instances = await getAllPortainerInstances();
    // Don't return passwords or API keys in the response
    const safeInstances = instances.map(({ password, api_key, ...rest }) => rest);
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
        error: "Portainer instance not found",
      });
    }

    // Don't return password or API key in the response
    const { password, api_key, ...safeInstance } = instance;
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
    const { name, url, username, password, apiKey, authType = "apikey" } = req.body;

    // Validate required fields based on auth type
    if (authType === "apikey") {
      const validationError = validateRequiredFields({ name, url, apiKey }, [
        "name",
        "url",
        "apiKey",
      ]);
      if (validationError) {
        return res.status(400).json(validationError);
      }
    } else {
      const validationError = validateRequiredFields({ name, url, username, password }, [
        "name",
        "url",
        "username",
        "password",
      ]);
      if (validationError) {
        return res.status(400).json(validationError);
      }
    }

    // Validate URL format
    try {
      const urlObj = new URL(url);
      // Ensure URL has http or https
      if (!["http:", "https:"].includes(urlObj.protocol)) {
        return res.status(400).json({
          success: false,
          error: "URL must use http:// or https://",
        });
      }
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: "Invalid URL format",
      });
    }

    // If name is empty, use URL hostname as default
    const instanceName = name.trim() || new URL(url).hostname;

    // Resolve URL to IP address for fallback when DNS fails
    // Simple DNS lookup - store whatever the hostname resolves to
    const ipAddress = await resolveUrlToIp(url.trim());
    if (ipAddress) {
      logger.info("Resolved Portainer URL to IP address via DNS", {
        module: "portainerController",
        operation: "createInstance",
        url: url.trim(),
        ipAddress: ipAddress,
        note: "This IP will be used for fallback when DNS is unavailable (e.g., during nginx upgrades)",
      });
    } else {
      logger.warn("Failed to resolve URL to IP address", {
        module: "portainerController",
        operation: "createInstance",
        url: url.trim(),
        note: "IP fallback will not be available. If this instance is behind a proxy, you may need to manually set the IP address in Settings.",
      });
    }

    // Create instance
    // For API key auth, pass empty strings for username/password to satisfy NOT NULL constraints
    const id = await createPortainerInstance(
      instanceName,
      url.trim(),
      authType === "apikey" ? "" : username ? username.trim() : "",
      authType === "apikey" ? "" : password || "",
      apiKey || null,
      authType,
      ipAddress
    );

    res.json({
      success: true,
      message: "Portainer instance created successfully",
      id,
    });
  } catch (error) {
    // Handle unique constraint violation
    if (error.message.includes("UNIQUE constraint failed")) {
      return res.status(400).json({
        success: false,
        error: "A Portainer instance with this URL already exists",
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
    const { name, url, username, password, apiKey, authType } = req.body;

    // Check if instance exists
    const existing = await getPortainerInstanceById(parseInt(id));
    if (!existing) {
      return res.status(404).json({
        success: false,
        error: "Portainer instance not found",
      });
    }

    // Use existing authType if not provided
    const finalAuthType = authType || existing.auth_type || "apikey";

    // Validate required fields based on auth type
    if (finalAuthType === "apikey") {
      const validationError = validateRequiredFields({ name, url }, ["name", "url"]);
      if (validationError) {
        return res.status(400).json(validationError);
      }
      // For API key auth, apiKey is required if not updating (keeping existing)
      if (!apiKey && !existing.api_key) {
        return res.status(400).json({
          success: false,
          error: "API key is required for API key authentication",
        });
      }
    } else {
      const validationError = validateRequiredFields({ name, url, username }, [
        "name",
        "url",
        "username",
      ]);
      if (validationError) {
        return res.status(400).json(validationError);
      }
    }

    // Validate URL format
    try {
      const urlObj = new URL(url);
      // Ensure URL has http or https
      if (!["http:", "https:"].includes(urlObj.protocol)) {
        return res.status(400).json({
          success: false,
          error: "URL must use http:// or https://",
        });
      }
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: "Invalid URL format",
      });
    }

    // If name is empty, use URL hostname as default
    const instanceName = name.trim() || new URL(url).hostname;

    // Resolve URL to IP address for fallback when DNS fails
    // Only resolve if URL changed, otherwise keep existing IP
    // Simple DNS lookup - store whatever the hostname resolves to
    let ipAddress = existing.ip_address;
    if (url.trim() !== existing.url) {
      const resolvedIp = await resolveUrlToIp(url.trim());
      if (resolvedIp) {
        logger.info("Resolved Portainer URL to IP address via DNS for update", {
          module: "portainerController",
          operation: "updateInstance",
          url: url.trim(),
          ipAddress: resolvedIp,
          note: "This IP will be used for fallback when DNS is unavailable (e.g., during nginx upgrades)",
        });
        ipAddress = resolvedIp;
      } else {
        logger.warn(
          `Failed to resolve ${url.trim()} to IP address - keeping existing IP (${existing.ip_address || "none"}) if available`
        );
      }
    }

    // Handle credentials based on auth type
    // IMPORTANT: When switching auth methods, explicitly clear the old method's data
    let passwordToUse = null;
    let apiKeyToUse = null;

    // Check if auth type is changing
    const authTypeChanged = existing.auth_type !== finalAuthType;

    if (finalAuthType === "apikey") {
      // For API key auth, use provided apiKey or keep existing (if not switching)
      apiKeyToUse = apiKey || (authTypeChanged ? null : existing.api_key);
      // Always clear password data when using API key auth
      passwordToUse = "";
    } else {
      // For password auth, use provided password or keep existing (if not switching)
      passwordToUse = password || (authTypeChanged ? "" : existing.password);
      // Always clear API key data when using password auth
      apiKeyToUse = null;
    }

    // Update instance
    // For API key auth, use empty strings for username/password to satisfy NOT NULL constraints
    // For password auth, use null for API key to clear it
    await updatePortainerInstance(
      parseInt(id),
      instanceName,
      url.trim(),
      finalAuthType === "apikey" ? "" : username ? username.trim() : "",
      passwordToUse || "",
      apiKeyToUse,
      finalAuthType,
      ipAddress
    );

    res.json({
      success: true,
      message: "Portainer instance updated successfully",
    });
  } catch (error) {
    // Handle unique constraint violation
    if (error.message.includes("UNIQUE constraint failed")) {
      return res.status(400).json({
        success: false,
        error: "A Portainer instance with this URL already exists",
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
        error: "Portainer instance not found",
      });
    }

    // Get the instance URL before deletion so we can remove its containers from cache
    const deletedInstanceUrl = existing.url;

    // Normalize URL for comparison (remove trailing slash, lowercase)
    const normalizeUrl = (url) => {
      if (!url) {
        return "";
      }
      return url.trim().replace(/\/+$/, "").toLowerCase();
    };
    const normalizedDeletedUrl = normalizeUrl(deletedInstanceUrl);

    // Delete instance
    await deletePortainerInstance(parseInt(id));

    // Remove containers from cache that belong to the deleted instance
    try {
      const cached = await getContainerCache("containers");
      if (cached && cached.containers && Array.isArray(cached.containers)) {
        // Log for debugging
        const totalContainersBefore = cached.containers.length;
        const containersWithUpdatesBefore = cached.containers.filter((c) => c.hasUpdate).length;

        // Filter out containers from the deleted instance using normalized URL comparison
        // IMPORTANT: Preserve all container properties including hasUpdate flag
        const filteredContainers = cached.containers.filter((container) => {
          const containerUrl = normalizeUrl(container.portainerUrl);
          const shouldKeep = containerUrl !== normalizedDeletedUrl;
          return shouldKeep;
        });

        // Log for debugging
        const totalContainersAfter = filteredContainers.length;
        const containersWithUpdatesAfter = filteredContainers.filter((c) => c.hasUpdate).length;
        logger.info("Filtering containers from cache after instance deletion", {
          module: "portainerController",
          operation: "deleteInstance",
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
          ? cached.stacks
              .map((stack) => ({
                ...stack,
                containers: stack.containers
                  ? stack.containers.filter(
                      (container) => normalizeUrl(container.portainerUrl) !== normalizedDeletedUrl
                    )
                  : [],
              }))
              .filter((stack) => stack.containers && stack.containers.length > 0)
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

          logger.debug("Recalculated instance stats after filtering", {
            module: "portainerController",
            operation: "deleteInstance",
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

        await setContainerCache("containers", updatedCache);
        logger.info("Removed containers from cache for deleted instance", {
          module: "portainerController",
          operation: "deleteInstance",
          instanceUrl: deletedInstanceUrl,
          containersRemoved: totalContainersBefore - totalContainersAfter,
        });
      }
    } catch (cacheError) {
      // Log error but don't fail the delete operation
      logger.error("Error updating container cache after instance deletion", {
        module: "portainerController",
        operation: "deleteInstance",
        instanceUrl: deletedInstanceUrl,
        error: cacheError,
      });
    }

    res.json({
      success: true,
      message: "Portainer instance deleted successfully",
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
        error: "orders must be an array",
      });
    }

    // Validate each order entry
    for (const order of orders) {
      if (typeof order.id !== "number" || typeof order.display_order !== "number") {
        return res.status(400).json({
          success: false,
          error: "Each order entry must have id (number) and display_order (number)",
        });
      }
    }

    await updatePortainerInstanceOrder(orders);

    res.json({
      success: true,
      message: "Portainer instance order updated successfully",
    });
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
