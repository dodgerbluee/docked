/**
 * Upgrade Planner
 *
 * Backend-agnostic orchestration for upgrading a container together with the
 * containers that share its network namespace (`network_mode: service:<name>` /
 * `container:<name|id>` dependents).
 *
 * The flow is plan-then-execute (PLAN-2 §0.1):
 *   1. PLAN (read-only): inspect the target, list all containers (including
 *      stopped ones) and capture the FULL inspect JSON of every dependent plus
 *      its wasRunning state. The plan is the single source of truth — the
 *      execution phase never re-discovers from live containers.
 *   2. Stop dependents (do not remove).
 *   3. Upgrade the target: stop -> pull (before remove) -> remove -> create ->
 *      start -> wait ready (healthcheck-aware deadline).
 *   4. Recreate each dependent from its captured config, pointed at the new
 *      target id; start only the ones that were running.
 *   5. On any failure after step 2, roll back to the pre-upgrade state.
 *
 * All calls go through an injected `ops` adapter so the whole pipeline is unit
 * testable with a fully mocked backend.
 *
 * @typedef {Object} UpgradeOps
 * @property {() => Promise<Array<{Id: string, Names?: string[]}>>} listContainers
 * @property {(id: string) => Promise<Object>} inspect
 * @property {(id: string) => Promise<void>} stop
 * @property {(id: string) => Promise<void>} start
 * @property {(id: string) => Promise<void>} remove
 * @property {(config: Object, name: string) => Promise<{Id: string}>} create
 * @property {(image: string) => Promise<void>} pull
 */

const logger = require("../../utils/logger");
const { buildCreateConfig } = require("./containerConfigBuilder");

const NS_PER_MS = 1e6;
const DEFAULT_INTERVAL_NS = 30 * 1e9; // Docker default healthcheck interval (30s)
const DEFAULT_RETRIES = 3; // Docker default healthcheck retries
const MIN_HEALTH_DEADLINE_MS = 30 * 1000;
const MAX_HEALTH_DEADLINE_MS = 10 * 60 * 1000;

const DEFAULT_TIMING = {
  pollIntervalMs: 2000,
  stopPollIntervalMs: 500,
  stopMaxWaitMs: 30000,
  runningGraceDeadlineMs: 20000,
  verifyDeadlineMs: 10000,
};

/**
 * Generate a short correlation id used to grep a single upgrade run's log lines.
 * @returns {string}
 */
function makeUpgradeId() {
  return `upg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * The ONE network_mode matcher used everywhere. A container is a dependent of
 * the target when its NetworkMode is `service:<name>`, `container:<name>` or
 * `container:<old-id>` (full id, or a short-id prefix of it).
 * @param {string} networkMode
 * @param {Object} target
 * @param {string} target.name - Clean target name (no leading slash).
 * @param {string} [target.oldFullId] - Target's full 64-hex container id.
 * @returns {boolean}
 */
function matchesNetworkMode(networkMode, { name, oldFullId } = {}) {
  if (!networkMode || typeof networkMode !== "string") {
    return false;
  }
  let ref = null;
  if (networkMode.startsWith("service:")) {
    ref = networkMode.slice("service:".length);
  } else if (networkMode.startsWith("container:")) {
    ref = networkMode.slice("container:".length);
  } else {
    return false;
  }
  if (!ref) {
    return false;
  }
  if (name && ref === name) {
    return true;
  }
  if (oldFullId) {
    const lowerRef = ref.toLowerCase();
    const lowerId = oldFullId.toLowerCase();
    if (lowerRef === lowerId) {
      return true;
    }
    // container:<old-short-id> — a hex prefix of the full id.
    if (/^[0-9a-f]{12,64}$/i.test(ref) && lowerId.startsWith(lowerRef)) {
      return true;
    }
  }
  return false;
}

/**
 * Compute a readiness deadline (ms) from a container's healthcheck definition.
 * Returns null when the container has no effective healthcheck.
 * @param {Object} inspect - Full inspect JSON.
 * @returns {number|null}
 */
function computeHealthDeadlineMs(inspect) {
  const hc = inspect && inspect.Config && inspect.Config.Healthcheck;
  if (!hc || !Array.isArray(hc.Test) || hc.Test.length === 0 || hc.Test[0] === "NONE") {
    return null;
  }
  const startPeriodMs = (hc.StartPeriod || 0) / NS_PER_MS;
  const intervalMs = (hc.Interval || DEFAULT_INTERVAL_NS) / NS_PER_MS;
  const retries = hc.Retries || DEFAULT_RETRIES;
  const deadline = startPeriodMs + intervalMs * retries;
  return Math.min(Math.max(deadline, MIN_HEALTH_DEADLINE_MS), MAX_HEALTH_DEADLINE_MS);
}

function isRunningState(state) {
  const status = state && state.Status;
  return status === "running" || (state && state.Running === true);
}

/**
 * PLAN PHASE (read-only). Discover the target's network_mode dependents and
 * capture each one's full inspect JSON + wasRunning state.
 * @param {Object} params
 * @param {UpgradeOps} params.ops
 * @param {string} params.upgradeId
 * @param {Object} params.targetInspect - Full inspect JSON of the target.
 * @param {string} params.targetId - Id used for backend calls against the target.
 * @param {string} params.targetName - Target name (leading slash tolerated).
 * @returns {Promise<Object>} plan
 */
async function buildUpgradePlan({ ops, upgradeId, targetInspect, targetId, targetName }) {
  const oldFullId = (targetInspect.Id || targetId || "").toLowerCase();
  const cleanName = (targetName || "").replace(/^\//, "");
  const plan = {
    upgradeId,
    target: { id: targetId, inspect: targetInspect, name: cleanName },
    dependents: [],
  };

  let allContainers = [];
  try {
    allContainers = await ops.listContainers();
  } catch (err) {
    logger.warn(`[upgrade ${upgradeId}] Dependency discovery: could not list containers`, {
      error: err && err.message,
    });
    return plan;
  }

  for (const container of allContainers) {
    const cid = container.Id;
    if (!cid) {
      continue;
    }
    if (cid === targetId || cid.toLowerCase() === oldFullId) {
      continue;
    }

    let inspect;
    try {
      inspect = await ops.inspect(cid);
    } catch (err) {
      logger.debug(`[upgrade ${upgradeId}] Could not inspect ${cid}: ${err && err.message}`);
      continue;
    }

    const networkMode = (inspect.HostConfig && inspect.HostConfig.NetworkMode) || "";
    if (!matchesNetworkMode(networkMode, { name: cleanName, oldFullId })) {
      continue;
    }

    const wasRunning = isRunningState(inspect.State);
    const depName = (inspect.Name || (container.Names && container.Names[0]) || cid).replace(
      /^\//,
      ""
    );
    plan.dependents.push({ id: cid, name: depName, inspect, wasRunning, networkMode });
    logger.info(
      `[upgrade ${upgradeId}] Discovered dependent ${depName} (NetworkMode=${networkMode}, wasRunning=${wasRunning})`
    );
  }

  logger.info(
    `[upgrade ${upgradeId}] Plan built: target=${plan.target.name}, dependents=${plan.dependents.length}`
  );
  return plan;
}

/**
 * Remove a container, ignoring a "not found" (already gone) response.
 * @param {UpgradeOps} ops
 * @param {string} id
 * @returns {Promise<void>}
 */
async function removeIgnoreMissing(ops, id) {
  try {
    await ops.remove(id);
  } catch (err) {
    if (err && err.response && err.response.status === 404) {
      return;
    }
    throw err;
  }
}

/**
 * Poll until the target container is no longer running (or is gone).
 */
async function waitForStopped({ ops, id, upgradeId, pollIntervalMs, maxWaitMs }) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    let details;
    try {
      details = await ops.inspect(id);
    } catch (err) {
      if (err && err.response && err.response.status === 404) {
        return;
      }
      await sleep(pollIntervalMs);
      continue;
    }
    if (!isRunningState(details.State)) {
      return;
    }
    await sleep(pollIntervalMs);
  }
  logger.warn(
    `[upgrade ${upgradeId}] Target did not confirm stopped within ${maxWaitMs}ms, proceeding`
  );
}

/**
 * Poll until the upgraded target is ready. With a healthcheck, wait for
 * `healthy` up to the derived deadline. Without one, wait for the container to
 * be stably running. A crash (exited/dead) throws so the caller can roll back.
 */
async function waitForTargetReady({
  ops,
  id,
  hasHealthcheck,
  deadlineMs,
  pollIntervalMs,
  upgradeId,
}) {
  const start = Date.now();
  let consecutiveRunning = 0;
  while (Date.now() - start < deadlineMs) {
    let details;
    try {
      details = await ops.inspect(id);
    } catch (_err) {
      await sleep(pollIntervalMs);
      continue;
    }
    const status = details.State && details.State.Status;
    if (status === "exited" || status === "dead") {
      throw new Error(`Upgraded target entered state "${status}" during readiness wait`);
    }
    if (hasHealthcheck) {
      const health = details.State && details.State.Health && details.State.Health.Status;
      if (health === "healthy") {
        logger.info(`[upgrade ${upgradeId}] Target is healthy`);
        return;
      }
    } else if (isRunningState(details.State)) {
      consecutiveRunning += 1;
      if (consecutiveRunning >= 2) {
        logger.info(`[upgrade ${upgradeId}] Target is running and stable`);
        return;
      }
    }
    await sleep(pollIntervalMs);
  }
  logger.warn(
    `[upgrade ${upgradeId}] Target readiness deadline (${deadlineMs}ms) reached; proceeding`
  );
}

/**
 * Best-effort verification that a just-started container is running. Logs a
 * warning if it never reaches running (does not throw — a slow dependent must
 * not undo a successful target upgrade).
 */
async function verifyRunning({ ops, id, name, deadlineMs, pollIntervalMs, upgradeId }) {
  const start = Date.now();
  while (Date.now() - start < deadlineMs) {
    try {
      const details = await ops.inspect(id);
      if (isRunningState(details.State)) {
        return true;
      }
      const status = details.State && details.State.Status;
      if (status === "exited" || status === "dead") {
        break;
      }
    } catch (_err) {
      // keep polling
    }
    await sleep(pollIntervalMs);
  }
  logger.warn(`[upgrade ${upgradeId}] Dependent ${name} did not confirm running`);
  return false;
}

/**
 * Recreate each dependent from its captured config, pointed at the new target.
 */
async function recreateDependents({ ops, dependents, newTargetId, upgradeId, timing }) {
  for (const dep of dependents) {
    await removeIgnoreMissing(ops, dep.id);
    const { containerConfig } = buildCreateConfig({
      inspect: dep.inspect,
      newImage: dep.inspect.Config && dep.inspect.Config.Image,
      networkMode: `container:${newTargetId}`,
    });
    const created = await ops.create(containerConfig, dep.name);
    if (dep.wasRunning) {
      await ops.start(created.Id);
      await verifyRunning({
        ops,
        id: created.Id,
        name: dep.name,
        deadlineMs: timing.verifyDeadlineMs,
        pollIntervalMs: timing.pollIntervalMs,
        upgradeId,
      });
      logger.info(
        `[upgrade ${upgradeId}] Recreated + started dependent ${dep.name} -> ${created.Id}`
      );
    } else {
      logger.info(`[upgrade ${upgradeId}] Recreated dependent ${dep.name} (left stopped)`);
    }
  }
}

/**
 * Roll back to the pre-upgrade state after a failure past step 2.
 */
async function rollback({ ops, plan, targetRemoved, newTargetId, upgradeId }) {
  const { target, dependents } = plan;

  if (!targetRemoved) {
    // Old target still exists (e.g. pull failed before removal). Restart it and
    // the dependents we stopped.
    try {
      await ops.start(target.id);
      logger.info(`[upgrade ${upgradeId}] Rollback: restarted original target ${target.name}`);
    } catch (err) {
      logger.error(
        `[upgrade ${upgradeId}] Rollback: failed to restart target ${target.name}: ${err && err.message}`
      );
    }
    for (const dep of dependents) {
      if (!dep.wasRunning) {
        continue;
      }
      try {
        await ops.start(dep.id);
        logger.info(`[upgrade ${upgradeId}] Rollback: restarted dependent ${dep.name}`);
      } catch (err) {
        logger.error(
          `[upgrade ${upgradeId}] Rollback: failed to restart dependent ${dep.name}: ${err && err.message}`
        );
      }
    }
    return;
  }

  // Target was already removed. Recreate it from the captured inspect with the
  // OLD image (still present locally), then restore the dependents.
  const oldImage = target.inspect.Config && target.inspect.Config.Image;
  if (newTargetId) {
    try {
      await removeIgnoreMissing(ops, newTargetId);
    } catch (err) {
      logger.debug(
        `[upgrade ${upgradeId}] Rollback: could not remove partial target: ${err && err.message}`
      );
    }
  }

  let restored = null;
  try {
    const { containerConfig } = buildCreateConfig({ inspect: target.inspect, newImage: oldImage });
    restored = await ops.create(containerConfig, target.name);
    await ops.start(restored.Id);
    logger.info(
      `[upgrade ${upgradeId}] Rollback: recreated original target with old image ${oldImage}`
    );
  } catch (err) {
    logger.error(
      `[upgrade ${upgradeId}] Rollback: failed to recreate target: ${err && err.message}`
    );
    return;
  }

  for (const dep of dependents) {
    try {
      await removeIgnoreMissing(ops, dep.id);
      const { containerConfig } = buildCreateConfig({
        inspect: dep.inspect,
        newImage: dep.inspect.Config && dep.inspect.Config.Image,
        networkMode: `container:${restored.Id}`,
      });
      const created = await ops.create(containerConfig, dep.name);
      if (dep.wasRunning) {
        await ops.start(created.Id);
      }
      logger.info(`[upgrade ${upgradeId}] Rollback: restored dependent ${dep.name}`);
    } catch (err) {
      logger.error(
        `[upgrade ${upgradeId}] Rollback: failed to restore dependent ${dep.name}: ${err && err.message}`
      );
    }
  }
}

/**
 * EXECUTE PHASE. Consume a plan and perform steps 2-5, with rollback on any
 * failure after the dependents have been stopped.
 * @param {Object} params
 * @param {UpgradeOps} params.ops
 * @param {Object} params.plan - Output of {@link buildUpgradePlan}.
 * @param {string} params.newImage - Image to upgrade the target to.
 * @param {string} params.upgradeId
 * @param {Object} [params.timing] - Poll/deadline overrides (mainly for tests).
 * @returns {Promise<{ newContainer: {Id: string} }>}
 */
async function executeUpgradePlan({ ops, plan, newImage, upgradeId, timing = {} }) {
  const t = { ...DEFAULT_TIMING, ...timing };
  const { target, dependents } = plan;
  const targetInspect = target.inspect;

  // Step 2: stop dependents (do NOT remove — keeps failure recoverable).
  for (const dep of dependents) {
    try {
      await ops.stop(dep.id);
      logger.info(`[upgrade ${upgradeId}] Stopped dependent ${dep.name}`);
    } catch (err) {
      logger.debug(
        `[upgrade ${upgradeId}] Dependent ${dep.name} may already be stopped: ${err && err.message}`
      );
    }
  }

  let targetRemoved = false;
  let newContainer = null;

  try {
    // Step 3: stop the target and wait for it to be down.
    try {
      await ops.stop(target.id);
    } catch (err) {
      logger.debug(`[upgrade ${upgradeId}] Target stop returned: ${err && err.message}`);
    }
    await waitForStopped({
      ops,
      id: target.id,
      upgradeId,
      pollIntervalMs: t.stopPollIntervalMs,
      maxWaitMs: t.stopMaxWaitMs,
    });

    // Pull BEFORE removing the old container so a failed pull aborts intact.
    await ops.pull(newImage);

    // Remove old target, then create + start the new one.
    await ops.remove(target.id);
    targetRemoved = true;

    const { containerConfig } = buildCreateConfig({ inspect: targetInspect, newImage });
    newContainer = await ops.create(containerConfig, target.name);
    logger.info(`[upgrade ${upgradeId}] Created new target ${newContainer.Id}`);
    await ops.start(newContainer.Id);

    // Readiness (healthcheck-aware).
    const healthDeadlineMs = computeHealthDeadlineMs(targetInspect);
    const hasHealthcheck = healthDeadlineMs !== null;
    await waitForTargetReady({
      ops,
      id: newContainer.Id,
      hasHealthcheck,
      deadlineMs: hasHealthcheck ? healthDeadlineMs : t.runningGraceDeadlineMs,
      pollIntervalMs: t.pollIntervalMs,
      upgradeId,
    });

    // Step 4: recreate dependents from captured config, pointed at the new id.
    await recreateDependents({
      ops,
      dependents,
      newTargetId: newContainer.Id,
      upgradeId,
      timing: t,
    });
  } catch (err) {
    logger.error(
      `[upgrade ${upgradeId}] Upgrade failed after dependents stopped, rolling back: ${err && err.message}`
    );
    await rollback({
      ops,
      plan,
      targetRemoved,
      newTargetId: newContainer && newContainer.Id,
      upgradeId,
    });
    throw err;
  }

  return { newContainer };
}

module.exports = {
  makeUpgradeId,
  matchesNetworkMode,
  computeHealthDeadlineMs,
  buildUpgradePlan,
  executeUpgradePlan,
};
