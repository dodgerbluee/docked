/**
 * Runner Docker Service
 *
 * HTTP client for Docker management operations on a dockhand runner.
 * Mirrors the portainerService interface so the upgrade pipeline can treat
 * both backends identically. The endpointId parameter is accepted in every
 * function signature for interface parity but is ignored — dockhand is
 * always a single-host agent.
 *
 * Authentication: Authorization: Bearer {apiKey} (same as runnerService).
 */

const axios = require("axios");
const logger = require("../utils/logger");

// Generous timeout for operations that involve Docker (pull, create, etc.)
const OP_TIMEOUT_MS = 120_000;
const INSPECT_TIMEOUT_MS = 10_000;

function authHeaders(apiKey) {
  return { Authorization: `Bearer ${apiKey}` };
}

function opConfig(apiKey) {
  return { headers: authHeaders(apiKey), timeout: OP_TIMEOUT_MS };
}

function inspectConfig(apiKey) {
  return { headers: authHeaders(apiKey), timeout: INSPECT_TIMEOUT_MS };
}

// ── Container operations ───────────────────────────────────────────────────

/**
 * List all running containers on the runner.
 * @param {string} runnerUrl
 * @param {*} _endpointId - ignored (interface parity)
 * @param {string} apiKey
 * @returns {Promise<Array>}
 */
async function getContainers(runnerUrl, _endpointId, apiKey) {
  const resp = await axios.get(`${runnerUrl}/containers`, inspectConfig(apiKey));
  // Normalize to Docker Engine API casing so the upgrade pipeline can use
  // container.Id and container.Names[0] (as it does for Portainer containers).
  return (resp.data.containers || []).map((c) => ({
    ...c,
    Id: c.Id || c.id,
    Names: c.Names || (c.name ? [`/${c.name}`] : []),
  }));
}

/**
 * Get full Docker inspect JSON for a container.
 * Equivalent to Docker GET /containers/{id}/json.
 * @param {string} runnerUrl
 * @param {*} _endpointId - ignored
 * @param {string} containerId
 * @param {string} apiKey
 * @returns {Promise<Object>} Raw Docker ContainerJSON
 */
async function getContainerDetails(runnerUrl, _endpointId, containerId, apiKey) {
  const resp = await axios.get(
    `${runnerUrl}/containers/${encodeURIComponent(containerId)}/json`,
    inspectConfig(apiKey)
  );
  return resp.data;
}

/**
 * Stop a running container.
 * @param {string} runnerUrl
 * @param {*} _endpointId - ignored
 * @param {string} containerId
 * @param {string} apiKey
 * @returns {Promise<void>}
 */
async function stopContainer(runnerUrl, _endpointId, containerId, apiKey) {
  await axios.post(
    `${runnerUrl}/containers/${encodeURIComponent(containerId)}/stop`,
    {},
    opConfig(apiKey)
  );
}

/**
 * Remove a container.
 * @param {string} runnerUrl
 * @param {*} _endpointId - ignored
 * @param {string} containerId
 * @param {string} apiKey
 * @param {boolean} [force=false]
 * @returns {Promise<void>}
 */
async function removeContainer(runnerUrl, _endpointId, containerId, apiKey, force = false) {
  await axios.delete(`${runnerUrl}/containers/${encodeURIComponent(containerId)}`, {
    ...opConfig(apiKey),
    params: { force: force ? "true" : "false" },
  });
}

/**
 * Create a container from a Docker Engine API-compatible config body.
 * @param {string} runnerUrl
 * @param {*} _endpointId - ignored
 * @param {Object} containerConfig - Docker container create config
 * @param {string} containerName
 * @param {string} apiKey
 * @returns {Promise<Object>} {id, warnings}
 */
async function createContainer(runnerUrl, _endpointId, containerConfig, containerName, apiKey) {
  const resp = await axios.post(`${runnerUrl}/containers/create`, containerConfig, {
    ...opConfig(apiKey),
    params: { name: containerName },
  });
  // Normalize to Docker Engine API casing expected by the upgrade pipeline:
  // dockhand returns {"id":"..."} (lowercase) but the pipeline reads newContainer.Id (capital).
  const data = resp.data;
  return {
    Id: data.Id || data.id,
    Warnings: data.Warnings || data.warnings || [],
  };
}

/**
 * Start a container.
 * @param {string} runnerUrl
 * @param {*} _endpointId - ignored
 * @param {string} containerId
 * @param {string} apiKey
 * @returns {Promise<void>}
 */
async function startContainer(runnerUrl, _endpointId, containerId, apiKey) {
  await axios.post(
    `${runnerUrl}/containers/${encodeURIComponent(containerId)}/start`,
    {},
    opConfig(apiKey)
  );
}

/**
 * Get container logs as a string.
 * @param {string} runnerUrl
 * @param {*} _endpointId - ignored
 * @param {string} containerId
 * @param {number} [tail=100]
 * @param {string} apiKey
 * @returns {Promise<string>}
 */
async function getContainerLogs(runnerUrl, _endpointId, containerId, tail = 100, apiKey) {
  // The runner log endpoint returns SSE-formatted text (event: log\ndata: ...\n\n).
  // We request without follow=true and strip the SSE framing to get plain log lines.
  const resp = await axios.get(`${runnerUrl}/containers/${encodeURIComponent(containerId)}/logs`, {
    ...inspectConfig(apiKey),
    params: { tail, follow: false },
    responseType: "text",
  });
  const raw = resp.data || "";
  // Extract plain text from SSE `data:` lines, ignoring `event:` and empty lines.
  const lines = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("data: ") || line.startsWith("data:")) {
      lines.push(line.replace(/^data:\s?/, ""));
    }
  }
  return lines.join("\n");
}

// ── Image operations ───────────────────────────────────────────────────────

/**
 * List all local images on the runner.
 * @param {string} runnerUrl
 * @param {*} _endpointId - ignored
 * @param {string} apiKey
 * @returns {Promise<Array>}
 */
async function getImages(runnerUrl, _endpointId, apiKey) {
  const resp = await axios.get(`${runnerUrl}/images`, inspectConfig(apiKey));
  return resp.data.images || [];
}

/**
 * Pull an image on the runner. Blocks until pull is complete.
 * @param {string} runnerUrl
 * @param {*} _endpointId - ignored
 * @param {string} imageName - Full image reference (e.g. "nginx:latest")
 * @param {*} _originalUrl - ignored (interface parity with portainerService)
 * @param {string} apiKey
 * @returns {Promise<void>}
 */
async function pullImage(runnerUrl, _endpointId, imageName, _originalUrl, apiKey) {
  // Split image reference into fromImage / tag for the dockhand API.
  let fromImage = imageName;
  let tag = "";
  const colonIdx = imageName.lastIndexOf(":");
  if (colonIdx > 0) {
    fromImage = imageName.substring(0, colonIdx);
    tag = imageName.substring(colonIdx + 1);
  }
  await axios.post(`${runnerUrl}/images/pull`, { fromImage, tag }, opConfig(apiKey));
  logger.info("runnerDockerService: image pulled", { imageName, runnerUrl });
}

/**
 * Delete a local image on the runner.
 * @param {string} runnerUrl
 * @param {*} _endpointId - ignored
 * @param {string} imageId
 * @param {boolean} [force=false]
 * @param {string} apiKey
 * @returns {Promise<void>}
 */
async function deleteImage(runnerUrl, _endpointId, imageId, force = false, apiKey) {
  await axios.delete(`${runnerUrl}/images/${encodeURIComponent(imageId)}`, {
    ...opConfig(apiKey),
    params: { force: force ? "true" : "false" },
  });
}

// ── Stubs for interface parity (not applicable to runner backend) ──────────

/** Not needed for runner — no separate auth step. */
async function authenticatePortainer() {}

/** Not needed for runner. */
function clearAuthToken() {}

module.exports = {
  // Container
  getContainers,
  getContainerDetails,
  stopContainer,
  removeContainer,
  createContainer,
  startContainer,
  getContainerLogs,
  // Image
  getImages,
  pullImage,
  deleteImage,
  // Stubs
  authenticatePortainer,
  clearAuthToken,
};
