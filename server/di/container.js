/**
 * Dependency Injection Container
 * Simple DI container for managing dependencies
 */

class Container {
  constructor() {
    this.services = new Map();
    this.singletons = new Map();
  }

  /**
   * Register a service
   * @param {string} name - Service name
   * @param {Function|*} factory - Factory function or instance
   * @param {boolean} singleton - Whether to treat as singleton
   */
  register(name, factory, singleton = false) {
    this.services.set(name, { factory, singleton });
  }

  /**
   * Register a singleton service
   * @param {string} name - Service name
   * @param {Function|*} factory - Factory function or instance
   */
  singleton(name, factory) {
    this.register(name, factory, true);
  }

  /**
   * Resolve a service
   * @param {string} name - Service name
   * @returns {*} - Service instance
   */
  resolve(name) {
    const service = this.services.get(name);
    
    if (!service) {
      throw new Error(`Service '${name}' not found`);
    }

    // Return singleton if already created
    if (service.singleton && this.singletons.has(name)) {
      return this.singletons.get(name);
    }

    // Create instance
    let instance;
    if (typeof service.factory === 'function') {
      instance = service.factory(this);
    } else {
      instance = service.factory;
    }

    // Store singleton
    if (service.singleton) {
      this.singletons.set(name, instance);
    }

    return instance;
  }

  /**
   * Check if service is registered
   * @param {string} name - Service name
   * @returns {boolean} - True if registered
   */
  has(name) {
    return this.services.has(name);
  }

  /**
   * Clear all services (useful for testing)
   */
  clear() {
    this.services.clear();
    this.singletons.clear();
  }
}

// Create global container instance
const container = new Container();

// Register core dependencies
container.singleton('db', () => require('../db/database').db);
container.singleton('logger', () => require('../utils/logger'));
container.singleton('config', () => require('../config'));

// Register repositories
container.singleton('userRepository', (c) => {
  const UserRepository = require('../repositories/UserRepository');
  return new UserRepository(c.resolve('db'));
});

container.singleton('portainerInstanceRepository', (c) => {
  const PortainerInstanceRepository = require('../repositories/PortainerInstanceRepository');
  return new PortainerInstanceRepository(c.resolve('db'));
});

container.singleton('trackedImageRepository', (c) => {
  const TrackedImageRepository = require('../repositories/TrackedImageRepository');
  return new TrackedImageRepository(c.resolve('db'));
});

container.singleton('batchRunRepository', (c) => {
  const BatchRunRepository = require('../repositories/BatchRunRepository');
  return new BatchRunRepository(c.resolve('db'));
});

container.singleton('batchConfigRepository', (c) => {
  const BatchConfigRepository = require('../repositories/BatchConfigRepository');
  return new BatchConfigRepository(c.resolve('db'));
});

container.singleton('discordWebhookRepository', (c) => {
  const DiscordWebhookRepository = require('../repositories/DiscordWebhookRepository');
  return new DiscordWebhookRepository(c.resolve('db'));
});

    container.singleton('settingsRepository', (c) => {
      const SettingsRepository = require('../repositories/SettingsRepository');
      return new SettingsRepository(c.resolve('db'));
    });

    // Register services
    container.singleton('containerCacheService', (c) => {
      try {
        const ContainerCacheService = require('../services/containerCacheService');
        return new ContainerCacheService(c.resolve('db'));
      } catch (error) {
        const logger = c.resolve('logger');
        logger.error('Failed to load ContainerCacheService', {
          module: 'container',
          error: error.message,
          stack: error.stack,
        });
        throw error; // This is a required service, so throw
      }
    });

    container.singleton('discordService', (c) => {
      try {
        // DiscordService exports an object with functions, not a class
        const discordService = require('../services/discordService');
        return discordService;
      } catch (error) {
        const logger = c.resolve('logger');
        logger.warn('DiscordService not available (optional dependency)', {
          module: 'container',
          error: error.message,
        });
        // Return null if discordService can't be loaded (optional dependency)
        return null;
      }
    });

module.exports = container;

