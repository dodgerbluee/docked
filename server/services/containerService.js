/**
 * Container Service
 * Main orchestrator that re-exports container-related services
 * This file maintains backward compatibility while delegating to focused modules
 */

// Re-export from focused service modules
const imageUpdateService = require("./imageUpdateService");
const containerUpgradeService = require("./containerUpgradeService");
const containerQueryService = require("./containerQueryService");

module.exports = {
  // Image update checking
  checkImageUpdates: imageUpdateService.checkImageUpdates,

  // Container upgrade
  upgradeSingleContainer: containerUpgradeService.upgradeSingleContainer,

  // Container querying
  getAllContainersWithUpdates: containerQueryService.getAllContainersWithUpdates,
  getContainersFromPortainer: containerQueryService.getContainersFromPortainer,
  getUnusedImages: containerQueryService.getUnusedImages,
};
