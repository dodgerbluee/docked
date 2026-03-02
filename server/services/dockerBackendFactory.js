/**
 * Docker Backend Factory
 *
 * Resolves which Docker backend service to use (Portainer or Runner) based on
 * the context provided by the caller. Returns a backend descriptor that the
 * upgrade pipeline and container management endpoints can use uniformly.
 *
 * Usage:
 *   const backend = await resolveBackend(userId, { portainerUrl, endpointId });
 *   // or
 *   const backend = await resolveBackend(userId, { runnerId });
 *
 *   await backend.service.stopContainer(backend.url, backend.endpointId, containerId, backend.apiKey);
 */

const portainerService = require("./portainerService");
const runnerDockerService = require("./runnerDockerService");
const { getAllPortainerInstances } = require("../db/index");
const { getRunnerById } = require("../db/runners");
const logger = require("../utils/logger");

/**
 * @typedef {Object} BackendDescriptor
 * @property {"portainer"|"runner"} type
 * @property {Object} service        - portainerService or runnerDockerService
 * @property {string} url            - Base URL of the backend (portainerUrl or runner.url)
 * @property {string|null} endpointId  - Endpoint ID (null for runner backends)
 * @property {string|null} apiKey    - Runner API key (null for Portainer — uses token cache)
 * @property {number|null} instanceId  - portainer_instances.id (null for runner)
 * @property {number|null} runnerId    - runners.id (null for Portainer)
 * @property {string|null} instanceName - Display name of the backend instance
 */

/**
 * Resolve which backend to use based on the request context.
 *
 * Pass exactly one of { portainerUrl + endpointId } or { runnerId }.
 *
 * @param {number} userId
 * @param {Object} opts
 * @param {string} [opts.portainerUrl]
 * @param {string|number} [opts.endpointId]
 * @param {number} [opts.runnerId]
 * @returns {Promise<BackendDescriptor>}
 * @throws {Error} If the referenced instance/runner is not found or not owned by userId
 */
async function resolveBackend(userId, { portainerUrl, endpointId, runnerId } = {}) {
  if (runnerId) {
    return resolveRunnerBackend(userId, runnerId);
  }
  if (portainerUrl) {
    return resolvePortainerBackend(userId, portainerUrl, endpointId);
  }
  throw Object.assign(new Error("Either portainerUrl or runnerId is required"), { status: 400 });
}

/**
 * Resolve a Portainer backend and pre-authenticate.
 */
async function resolvePortainerBackend(userId, portainerUrl, endpointId) {
  const instances = await getAllPortainerInstances(userId);
  const instance = instances.find((inst) => inst.url === portainerUrl);
  if (!instance) {
    logger.warn("dockerBackendFactory: Portainer instance not found", { userId, portainerUrl });
    throw Object.assign(new Error("Portainer instance not found or not accessible"), {
      status: 404,
    });
  }

  // Pre-authenticate (uses token cache internally).
  await portainerService.authenticatePortainer({
    portainerUrl,
    username: instance.username,
    password: instance.password,
    apiKey: instance.api_key,
    authType: instance.auth_type || "apikey",
    skipCache: false,
  });

  return {
    type: "portainer",
    service: portainerService,
    url: portainerUrl,
    endpointId: endpointId ?? null,
    apiKey: null,
    instanceId: instance.id,
    runnerId: null,
    instanceName: instance.name,
  };
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
