/**
 * Container Upgrade Lock
 *
 * Shared SQLite lock manager that prevents concurrent upgrades of the same container.
 * Ensures that if two intents (or a manual upgrade and an intent) target the
 * same container, only one proceeds at a time.
 *
 * This is a singleton — require() always returns the same instance.
 */

const { getDatabase } = require("../../db/connection");
const { randomUUID } = require("crypto");

class UpgradeLockManager {
  constructor() {
    /** @type {Map<string, { acquiredAt: number, owner: string, token: string, heartbeat: NodeJS.Timeout }>} */
    this.locks = new Map();
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
   * @returns {Promise<string|false>} acquisition token, or false if already locked
   */
  async acquire(containerId, options = {}) {
    const key = this._key(containerId, options);
    const owner = options.owner || "unknown";
    const token = `${owner}:${randomUUID()}`;
    const acquired = await this._run(
      `INSERT INTO upgrade_locks (target_key, owner, expires_at)
       VALUES (?, ?, datetime('now', '+10 minutes'))
       ON CONFLICT(target_key) DO UPDATE SET
         owner = excluded.owner,
         expires_at = excluded.expires_at,
         created_at = CURRENT_TIMESTAMP
       WHERE upgrade_locks.expires_at <= CURRENT_TIMESTAMP`,
      [key, token]
    );
    if (acquired.changes !== 1) return false;

    const heartbeat = setInterval(() => {
      this._run(
        `UPDATE upgrade_locks
         SET expires_at = datetime('now', '+10 minutes')
         WHERE target_key = ? AND owner = ?`,
        [key, token]
      ).catch(() => {
        // The active operation will still release its owner-scoped lock. A
        // transient heartbeat failure leaves the existing ten-minute lease.
      });
    }, 60 * 1000);
    heartbeat.unref();
    this.locks.set(key, {
      acquiredAt: Date.now(),
      owner,
      token,
      heartbeat,
    });
    return token;
  }

  /**
   * Release an upgrade lock for a container.
   * @param {string} containerId - Docker container ID
   * @param {Object} [options]
   * @param {number} [options.sourceInstanceId] - Source instance ID (Portainer)
   * @param {number} [options.runnerId] - Runner ID
   */
  async release(containerId, options = {}) {
    const key = this._key(containerId, options);
    const local = this.locks.get(key);
    const token = options.lockToken || local?.token;

    // Delete only our own claim; a stale lock may have been replaced by the
    // other backend while this process was paused.
    if (local && local.token === token) {
      clearInterval(local.heartbeat);
      this.locks.delete(key);
    }
    if (token) {
      await this._run("DELETE FROM upgrade_locks WHERE target_key = ? AND owner = ?", [key, token]);
    }
  }

  async _run(sql, params = []) {
    const db = getDatabase();
    await new Promise((resolve, reject) => {
      db.run(
        `CREATE TABLE IF NOT EXISTS upgrade_locks (
          target_key TEXT PRIMARY KEY,
          owner TEXT NOT NULL,
          expires_at DATETIME NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        (err) => (err ? reject(err) : resolve())
      );
    });
    return new Promise((resolve, reject) => {
      db.run(sql, params, function onRun(err) {
        if (err) reject(err);
        else resolve({ changes: this.changes, lastID: this.lastID });
      });
    });
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
    for (const lock of this.locks.values()) {
      clearInterval(lock.heartbeat);
    }
    this.locks.clear();
  }
}

// Singleton instance
const upgradeLockManager = new UpgradeLockManager();

module.exports = upgradeLockManager;
