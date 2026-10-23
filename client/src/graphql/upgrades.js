import { graphqlClient } from "./client";
import {
  UPGRADE_CONTAINER_MUTATION,
  CONTAINER_UPGRADE_PROGRESS_SUBSCRIPTION,
  UPGRADE_HISTORY_QUERY,
} from "./queries";
import { getSessionGeneration, isSessionStale } from "../utils/cacheRegistry";

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
 *
 * Session-aware: the generation is captured before the mutation and checked
 * after every await. A login/logout mid-flight must not create the progress
 * subscription or the history poll timer through the replacement session's
 * client — the watcher settles (rejects) so its socket and timers are torn
 * down instead of leaking until the 10-minute timeout.
 */
export async function upgradeRunnerContainer(container, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const gen = getSessionGeneration();
  const input = {
    dockerContainerId: container.id,
    imageName: container.image,
    runnerId: String(container.runnerId),
  };
  const startedAt = new Date();

  const res = await graphqlClient.mutation(UPGRADE_CONTAINER_MUTATION, { input }).toPromise();
  if (isSessionStale(gen)) {
    throw Object.assign(new Error("Session ended before the upgrade completed"), {
      sessionEnded: true,
    });
  }
  if (res.error || !res.data?.upgradeContainer) {
    const err = new Error(res.error?.message || "Upgrade request failed");
    // A server-side GraphQL rejection (blocklist, authz, limiter) is a
    // DEFINITIVE failure — unlike a transport drop, the upgrade never
    // started. Tag it so the caller's network-recovery path can't turn
    // it into a false success.
    if (res.error?.graphQLErrors?.length) err.operationError = true;
    throw err;
  }

  return await waitForUpgradeOutcome({
    operationId: res.data.upgradeContainer.id,
    container,
    startedAt,
    timeoutMs,
    gen,
  });
}

function waitForUpgradeOutcome({ operationId, container, startedAt, timeoutMs, gen }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe = null;
    let pollTimer = null;
    let lastPollError = "";

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      if (unsubscribe) unsubscribe();
      if (pollTimer) clearInterval(pollTimer);
      fn(arg);
    };

    const timeoutTimer = setTimeout(
      () =>
        finish(
          reject,
          new Error(
            "Upgrade did not report completion in time" +
              // Without this the real cause (the status read itself was
              // failing) was thrown away and every failure looked identical.
              (lastPollError ? ` (status reads failing: ${lastPollError})` : "")
          )
        ),
      timeoutMs
    );
    const succeed = () => {
      clearTimeout(timeoutTimer);
      finish(resolve, { success: true, operationId });
    };
    const fail = (message) => {
      clearTimeout(timeoutTimer);
      // Terminal FAILED from the server: definitive, not a dropped
      // connection (see operationError in upgradeRunnerContainer).
      finish(
        reject,
        Object.assign(new Error(message || "Upgrade failed"), { operationError: true })
      );
    };
    const endSession = () => {
      clearTimeout(timeoutTimer);
      finish(
        reject,
        Object.assign(new Error("Session ended before the upgrade completed"), {
          sessionEnded: true,
        })
      );
    };

    // Primary signal: phase events scoped to this operation.
    // NOTE: urql's Client exposes `subscription()` (Observable), not `subscribe()`.
    const sub = graphqlClient
      .subscription(CONTAINER_UPGRADE_PROGRESS_SUBSCRIPTION, {})
      .subscribe((result) => {
        if (isSessionStale(gen)) {
          endSession();
          return;
        }
        const ev = result.data?.containerUpgradeProgress;
        if (!ev || ev.operationId !== operationId) return;
        if (ev.phase === "COMPLETED") succeed();
        else if (ev.phase === "FAILED") fail(ev.message);
      });
    unsubscribe = () => sub.unsubscribe();

    // Fallback signal: the Go upgrade worker writes a terminal upgradeHistory
    // row for every attempt; poll for it in case the subscription missed the
    // terminal phase event.
    pollTimer = setInterval(async () => {
      if (isSessionStale(gen)) {
        endSession();
        return;
      }
      try {
        const r = await graphqlClient
          .query(UPGRADE_HISTORY_QUERY, {
            first: 10,
            filter: { containerName: container.name, from: startedAt.toISOString() },
          })
          .toPromise();
        if (isSessionStale(gen)) {
          endSession();
          return;
        }
        if (r.error) {
          // urql resolves rather than rejects: an errored read must not be
          // mistaken for "no terminal row yet".
          lastPollError = r.error.message;
          return;
        }
        lastPollError = "";
        const rec = r.data?.upgradeHistory?.items?.find(
          (item) => item.dockerContainerId === container.id
        );
        if (!rec) return;
        if (rec.status === "SUCCESS") succeed();
        else if (rec.status === "FAILED") fail(rec.errorMessage);
      } catch (err) {
        // Transient query failure — keep polling until the timeout, but keep
        // the reason so the timeout is not silent about it.
        lastPollError = err.message || "unknown error";
      }
    }, POLL_INTERVAL_MS);
  });
}

/**
 * Authoritative upgrade outcome for a container, read from the upgradeHistory
 * the Go upgrade worker writes for every attempt. Used by the network-recovery
 * path in useContainerUpgrade: after a transport drop the client never learned
 * the operation's result, and "a same-named container exists" is NOT proof of
 * success (an upgrade that never started leaves the OLD container running).
 *
 * Returns { status: "SUCCESS" | "FAILED", errorMessage } for an attempt of
 * THIS container started at/after `startedAt`, or null when no terminal row
 * exists yet.
 */
export async function getUpgradeOutcome(container, startedAt) {
  const r = await graphqlClient
    .query(UPGRADE_HISTORY_QUERY, {
      first: 10,
      filter: { containerName: container.name, from: startedAt.toISOString() },
    })
    .toPromise();
  if (r.error) throw new Error(r.error.message);
  const rec = r.data?.upgradeHistory?.items?.find(
    (item) => item.dockerContainerId === container.id
  );
  if (!rec) return null;
  return { status: rec.status, errorMessage: rec.errorMessage ?? null };
}
