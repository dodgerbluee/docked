/**
 * Docker Backend Factory
 *
 * Resolves the runner Docker backend service for a given runner ID and
 * returns a backend descriptor that the upgrade pipeline and container
 * management endpoints can use uniformly.
 *
 * Usage:
 *   const backend = await resolveBackend(userId, { runnerId });
 *
 *   await backend.service.stopContainer(backend.url, backend.endpointId, containerId, backend.apiKey);
 */

const runnerDockerService = require("./runnerDockerService");
const { getRunnerById } = require("../db/runners");
const logger = require("../utils/logger");

/**
 * @typedef {Object} BackendDescriptor
 * @property {"runner"} type
 * @property {Object} service        - runnerDockerService
 * @property {string} url            - Runner base URL
 * @property {null} endpointId       - Always null for runner backends
 * @property {string|null} apiKey    - Runner API key
 * @property {null} instanceId       - Always null (Portainer removed)
 * @property {number|null} runnerId  - runners.id
 * @property {string|null} instanceName - Display name of the runner
 */

/**
 * Resolve which backend to use based on the request context.
 *
 * @param {number} userId
 * @param {Object} opts
 * @param {number} [opts.runnerId]
 * @returns {Promise<BackendDescriptor>}
 * @throws {Error} If the runner is not found or not owned by userId
 */
async function resolveBackend(userId, { runnerId } = {}) {
  if (!runnerId) {
    throw Object.assign(new Error("runnerId is required"), { status: 400 });
  }
  return resolveRunnerBackend(userId, runnerId);
}

/**
 * Resolve a runner (dockhand) backend.
 */
async function resolveRunnerBackend(userId, runnerId) {
  const runner = await getRunnerById(runnerId, userId);
  if (!runner) {
    logger.warn("dockerBackendFactory: runner not found", { userId, runnerId });
    throw Object.assign(new Error("Runner not found or not accessible"), { status: 404 });
  }
  if (!runner.enabled) {
    throw Object.assign(new Error("Runner is disabled"), { status: 409 });
  }

  return {
    type: "runner",
    service: runnerDockerService,
    url: runner.url,
    endpointId: null,
    apiKey: runner.api_key,
    instanceId: null,
    runnerId: runner.id,
    instanceName: runner.name,
  };
}

module.exports = { resolveBackend };
