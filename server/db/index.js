/**
 * Database Module - Unified API
 *
 * This module provides a unified API for all database operations.
 * It re-exports functions from domain-specific modules and the connection module.
 *
 * Usage:
 *   const db = require('./db');
 *   const user = await db.getUserByUsername('admin');
 *   const instances = await db.getAllSourceInstances(userId);
 */

// Connection module
const connection = require("./connection");

// Domain modules
const users = require("./users");
const sourceInstances = require("./sourceInstances");
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
const intents = require("./intents");
const intentExecutions = require("./intentExecutions");
const oauth = require("./oauth");
const oauthProviders = require("./oauthProviders");
const runners = require("./runners");
const revokedTokens = require("./revokedTokens");

module.exports = {
  // Connection functions
  ...connection,

  // Domain functions
  ...users,
  ...sourceInstances,
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
  ...intents,
  ...intentExecutions,
  ...oauth,
  ...oauthProviders,
  ...runners,
  ...revokedTokens,
};
