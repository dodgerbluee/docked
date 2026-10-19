import { graphqlClient } from "./client";
import {
  UPGRADE_CONTAINER_MUTATION,
  CONTAINER_UPGRADE_PROGRESS_SUBSCRIPTION,
  UPGRADE_HISTORY_QUERY,
} from "./queries";

/** Poll cadence for the upgradeHistory fallback (ms). */
const POLL_INTERVAL_MS = 3000;
/** Runner upgrades (pull + stop + recreate + start) rarely exceed a few minutes. */
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Upgrade a runner-backed container through the Go GraphQL API and wait for
 * the terminal outcome. The upgradeContainer mutation is fire-and-forget (it
 * returns an Operation in PENDING state), so completion is observed via the
 * containerUpgradeProgress subscription; the upgradeHistory poll covers the
 * case where the WebSocket event is missed (e.g. the subscription connects
 * after a fast upgrade already finished).
 *
 * Throws Error(message) on failure or timeout, mirroring the axios error
 * contract the upgrade hooks already handle.
 */
export async function upgradeRunnerContainer(container, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const input = {
    dockerContainerId: container.id,
    imageName: container.image,
    runnerId: String(container.runnerId),
  };
  const startedAt = new Date();

  const res = await graphqlClient.mutation(UPGRADE_CONTAINER_MUTATION, { input }).toPromise();
  if (res.error || !res.data?.upgradeContainer) {
    throw new Error(res.error?.message || "Upgrade request failed");
  }

  return await waitForUpgradeOutcome({
    operationId: res.data.upgradeContainer.id,
    container,
    startedAt,
    timeoutMs,
  });
}

function waitForUpgradeOutcome({ operationId, container, startedAt, timeoutMs }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe = null;
    let pollTimer = null;

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      if (unsubscribe) unsubscribe();
      if (pollTimer) clearInterval(pollTimer);
      fn(arg);
    };

    const timeoutTimer = setTimeout(
      () => finish(reject, new Error("Upgrade did not report completion in time")),
      timeoutMs
    );
    const succeed = () => {
      clearTimeout(timeoutTimer);
      finish(resolve, { success: true, operationId });
    };
    const fail = (message) => {
      clearTimeout(timeoutTimer);
      finish(reject, new Error(message || "Upgrade failed"));
    };

    // Primary signal: phase events scoped to this operation.
    const stream = graphqlClient.subscribe(CONTAINER_UPGRADE_PROGRESS_SUBSCRIPTION, {});
    unsubscribe = () => stream.unsubscribe();
    stream.subscribe((result) => {
      const ev = result.data?.containerUpgradeProgress;
      if (!ev || ev.operationId !== operationId) return;
      if (ev.phase === "COMPLETED") succeed();
      else if (ev.phase === "FAILED") fail(ev.message);
    });

    // Fallback signal: the Go upgrade worker writes a terminal upgradeHistory
    // row for every attempt; poll for it in case the subscription missed the
    // terminal phase event.
    pollTimer = setInterval(async () => {
      try {
        const r = await graphqlClient
          .query(UPGRADE_HISTORY_QUERY, {
            first: 10,
            filter: { containerName: container.name, from: startedAt.toISOString() },
          })
          .toPromise();
        const rec = r.data?.upgradeHistory?.items?.find(
          (item) => item.dockerContainerId === container.id
        );
        if (!rec) return;
        if (rec.status === "SUCCESS") succeed();
        else if (rec.status === "FAILED") fail(rec.errorMessage);
      } catch {
        // Transient query failure — keep polling until the timeout.
      }
    }, POLL_INTERVAL_MS);
  });
}
