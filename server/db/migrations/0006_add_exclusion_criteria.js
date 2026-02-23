/**
 * Migration 6: Add Exclusion Criteria to Intents
 *
 * Adds exclusion criteria columns to the intents table for filtering out
 * containers, images, stacks, and registries from matching.
 * Each column stores a JSON array of glob patterns.
 *
 * Version: 6
 * Date: 2026-02-23
 */

const logger = require("../../utils/logger");
const { addColumnIfNotExists } = require("./helpers");

module.exports = {
  version: 6,
  name: "Add exclusion criteria to intents",
  up: async () => {
    logger.info("Migration 6: Adding exclusion criteria to intents table");

    // Add exclusion columns with default empty JSON arrays
    await addColumnIfNotExists("intents", "exclude_containers", "TEXT", "[]");
    await addColumnIfNotExists("intents", "exclude_images", "TEXT", "[]");
    await addColumnIfNotExists("intents", "exclude_stacks", "TEXT", "[]");
    await addColumnIfNotExists("intents", "exclude_registries", "TEXT", "[]");

    logger.info("Migration 6: Exclusion criteria added successfully");
  },
};
