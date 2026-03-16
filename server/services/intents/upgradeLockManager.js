/**
 * Container Upgrade Lock
 *
 * In-memory lock manager that prevents concurrent upgrades of the same container.
 * Ensures that if two intents (or a manual upgrade and an intent) target the
 * same container, only one proceeds at a time.
 *
 * This is a singleton — require() always returns the same instance.
 */

const logger = require("../../utils/logger");

class UpgradeLockManager {
  constructor() {
    /** @type {Map<string, { acquiredAt: number, owner: string }>} */
    this.locks = new Map();
    this.STALE_LOCK_MS = 10 * 60 * 1000; // 10 minutes — stale lock threshold
  }

  /**
   * Build a lock key for a container.
   * Uses typed prefixes to disambiguate containers across different backends.
   * @param {string} containerId - Docker container ID
   * @param {Object} [opts] - Backend identifier
   * @param {number} [opts.sourceInstanceId] - Source instance ID (Portainer)
   * @param {number} [opts.runnerId] - Runner ID
   * @returns {string} Lock key
   */
  _key(containerId, opts = {}) {
    if (opts.sourceInstanceId) {
      return `source:${opts.sourceInstanceId}:${containerId}`;
    }
    if (opts.runnerId) {
      return `runner:${opts.runnerId}:${containerId}`;
    }
    return containerId;
  }

  /**
   * Attempt to acquire an upgrade lock for a container.
   * @param {string} containerId - Docker container ID
   * @param {Object} [options]
   * @param {number} [options.sourceInstanceId] - Source instance ID (Portainer)
   * @param {number} [options.runnerId] - Runner ID
   * @param {string} [options.owner] - Who is requesting the lock (e.g. "intent:42", "manual")
   * @returns {boolean} true if lock acquired, false if already locked
   */
  acquire(containerId, options = {}) {
    const key = this._key(containerId, options);
    const existing = this.locks.get(key);

    if (existing) {
      // Check if the lock is stale (holder crashed/timed out)
      const age = Date.now() - existing.acquiredAt;
      if (age > this.STALE_LOCK_MS) {
        logger.warn("Releasing stale upgrade lock", {
          containerId,
          owner: existing.owner,
          ageMs: age,
        });
        this.locks.delete(key);
        // Fall through to acquire
      } else {
        return false;
      }
    }

    this.locks.set(key, {
      acquiredAt: Date.now(),
      owner: options.owner || "unknown",
    });

    return true;
  }

  /**
   * Release an upgrade lock for a container.
   * @param {string} containerId - Docker container ID
   * @param {Object} [options]
   * @param {number} [options.sourceInstanceId] - Source instance ID (Portainer)
   * @param {number} [options.runnerId] - Runner ID
   */
  release(containerId, options = {}) {
    const key = this._key(containerId, options);
    this.locks.delete(key);
  }

  /**
   * Check if a container is currently locked for upgrade.
   * @param {string} containerId - Docker container ID
   * @param {Object} [options]
   * @param {number} [options.sourceInstanceId] - Source instance ID (Portainer)
   * @param {number} [options.runnerId] - Runner ID
   * @returns {{ locked: boolean, owner?: string, acquiredAt?: number }}
   */
  isLocked(containerId, options = {}) {
    const key = this._key(containerId, options);
    const existing = this.locks.get(key);

    if (!existing) {
      return { locked: false };
    }

    // Check for staleness
    const age = Date.now() - existing.acquiredAt;
    if (age > this.STALE_LOCK_MS) {
      this.locks.delete(key);
      return { locked: false };
    }

    return {
      locked: true,
      owner: existing.owner,
      acquiredAt: existing.acquiredAt,
    };
  }

  /**
   * Get the count of currently held locks.
   * @returns {number}
   */
  get size() {
    return this.locks.size;
  }

  /**
   * Clear all locks (for testing or shutdown).
   */
  clear() {
    this.locks.clear();
  }
}

// Singleton instance
const upgradeLockManager = new UpgradeLockManager();

module.exports = upgradeLockManager;
