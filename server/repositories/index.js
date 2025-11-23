/**
 * Repositories - Unified API
 * 
 * This module provides a unified API for all repository operations.
 * It exports singleton instances of all repositories.
 * 
 * Usage:
 *   const repositories = require('./repositories');
 *   const user = await repositories.user.findByUsername('admin');
 *   const containers = await repositories.container.findByUser(userId);
 */

const BaseRepository = require("./BaseRepository");
const PortainerInstanceRepository = require("./PortainerInstanceRepository");
const UserRepository = require("./UserRepository");
const ContainerRepository = require("./ContainerRepository");
const DockerHubImageVersionRepository = require("./DockerHubImageVersionRepository");
const TrackedAppRepository = require("./TrackedAppRepository");
const DiscordRepository = require("./DiscordRepository");
const BatchRepository = require("./BatchRepository");
const RegistryRepository = require("./RegistryRepository");
const SettingsRepository = require("./SettingsRepository");
const DeployedImageRepository = require("./DeployedImageRepository");
const RegistryImageVersionRepository = require("./RegistryImageVersionRepository");

// Create singleton instances
const portainerInstance = new PortainerInstanceRepository();
const user = new UserRepository();
const container = new ContainerRepository();
const dockerHubImageVersion = new DockerHubImageVersionRepository();
const trackedApp = new TrackedAppRepository();
const discord = new DiscordRepository();
const batch = new BatchRepository();
const registry = new RegistryRepository();
const settings = new SettingsRepository();
const deployedImage = new DeployedImageRepository();
const registryImageVersion = new RegistryImageVersionRepository();

module.exports = {
  // Base class for creating custom repositories
  BaseRepository,
  
  // Repository instances
  portainerInstance,
  user,
  container,
  dockerHubImageVersion,
  trackedApp,
  discord,
  batch,
  registry,
  settings,
  deployedImage,
  registryImageVersion,
  
  // Aliases for convenience
  portainer: portainerInstance,
  users: user,
  containers: container,
  dockerHubImageVersions: dockerHubImageVersion,
  trackedApps: trackedApp,
  discordWebhooks: discord,
  batchJobs: batch,
  registries: registry,
  deployedImages: deployedImage,
  registryImageVersions: registryImageVersion,
};

