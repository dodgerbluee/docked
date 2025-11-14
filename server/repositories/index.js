/**
 * Repository Index
 * Exports all repositories with database connection
 */

const { db } = require('../db/database');
const UserRepository = require('./UserRepository');
const PortainerInstanceRepository = require('./PortainerInstanceRepository');
const TrackedImageRepository = require('./TrackedImageRepository');
const BatchRunRepository = require('./BatchRunRepository');
const BatchConfigRepository = require('./BatchConfigRepository');
const DiscordWebhookRepository = require('./DiscordWebhookRepository');
const SettingsRepository = require('./SettingsRepository');

// Create repository instances
const userRepository = new UserRepository(db);
const portainerInstanceRepository = new PortainerInstanceRepository(db);
const trackedImageRepository = new TrackedImageRepository(db);
const batchRunRepository = new BatchRunRepository(db);
const batchConfigRepository = new BatchConfigRepository(db);
const discordWebhookRepository = new DiscordWebhookRepository(db);
const settingsRepository = new SettingsRepository(db);

module.exports = {
  userRepository,
  portainerInstanceRepository,
  trackedImageRepository,
  batchRunRepository,
  batchConfigRepository,
  discordWebhookRepository,
  settingsRepository,
};

