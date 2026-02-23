/**
 * Database Module - Unified API
 *
 * This module provides a unified API for all database operations.
 * It re-exports functions from domain-specific modules and the connection module.
 *
 * Usage:
 *   const db = require('./db');
 *   const user = await db.getUserByUsername('admin');
 *   const instances = await db.getAllPortainerInstances(userId);
 */

// Connection module
const connection = require("./connection");

// Domain modules
const users = require("./users");
const portainerInstances = require("./portainerInstances");
const settings = require("./settings");
const registry = require("./registry");
const trackedApps = require("./trackedApps");
const discord = require("./discord");
const containers = require("./containers");
const batch = require("./batch");
const deployedImages = require("./deployedImages");
const registryImageVersions = require("./registryImageVersions");
const dockerHubImageVersions = require("./dockerHubImageVersions");
const upgradeHistory = require("./upgradeHistory");
const trackedAppUpgradeHistory = require("./trackedAppUpgradeHistory");
const intents = require("./intents");
const intentExecutions = require("./intentExecutions");
const oauth = require("./oauth");
const oauthProviders = require("./oauthProviders");
const logger = require("../utils/logger");

/**
 * Get raw database records for all relevant tables (for debugging/export)
 * @param {number} userId - User ID
 * @returns {Promise<Object>} - Raw database records organized by table
 */
// eslint-disable-next-line max-lines-per-function -- Database record retrieval requires comprehensive query logic
function getRawDatabaseRecords(userId) {
  // eslint-disable-next-line max-lines-per-function -- Promise callback requires comprehensive record processing
  return new Promise((resolve, reject) => {
    try {
      const db = connection.getDatabase();

      const records = {};
      const tables = [
        "portainer_instances",
        "containers",
        "deployed_images",
        "registry_image_versions",
        "tracked_apps",
      ];

      let completed = 0;
      const total = tables.length;

      if (total === 0) {
        resolve(records);
        return;
      }

      tables.forEach((tableName) => {
        let query;
        let params = [];

        // Build query based on table
        if (tableName === "portainer_instances") {
          query = `SELECT * FROM ${tableName} WHERE user_id = ? ORDER BY id ASC`;
          params = [userId];
        } else if (tableName === "containers") {
          query = `SELECT * FROM ${tableName} WHERE user_id = ? ORDER BY last_seen DESC`;
          params = [userId];
        } else if (tableName === "deployed_images") {
          query = `SELECT * FROM ${tableName} WHERE user_id = ? ORDER BY last_seen DESC`;
          params = [userId];
        } else if (tableName === "registry_image_versions") {
          query = `SELECT * FROM ${tableName} WHERE user_id = ? ORDER BY last_checked DESC`;
          params = [userId];
        } else if (tableName === "tracked_apps") {
          query = `SELECT * FROM ${tableName} WHERE user_id = ? ORDER BY name ASC`;
          params = [userId];
        } else {
          query = `SELECT * FROM ${tableName} ORDER BY id ASC`;
        }

        db.all(query, params, (err, rows) => {
          if (err) {
            logger.warn(`Error fetching raw records from ${tableName}:`, err.message);
            records[tableName] = [];
            records[`${tableName}_error`] = err.message;
          } else {
            // Convert SQLite row objects to plain objects
            records[tableName] = (rows || []).map((row) => {
              const plainRow = {};
              for (const key in row) {
                plainRow[key] = row[key];
              }
              return plainRow;
            });
          }

          completed++;
          if (completed === total) {
            resolve(records);
          }
        });
      });
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  // Connection functions
  ...connection,

  // Domain functions
  ...users,
  ...portainerInstances,
  ...settings,
  ...registry,
  ...trackedApps,
  ...discord,
  ...containers,
  ...batch,
  ...deployedImages,
  ...registryImageVersions,
  ...dockerHubImageVersions,
  ...upgradeHistory,
  ...trackedAppUpgradeHistory,
  ...intents,
  ...intentExecutions,
  ...oauth,
  ...oauthProviders,

  // Utility functions
  getRawDatabaseRecords,
};
