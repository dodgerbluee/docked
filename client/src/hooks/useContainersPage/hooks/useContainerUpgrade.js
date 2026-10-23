/**
 * Hook for managing container upgrade operations
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { toast } from "../../../utils/toast";
import { getUpgradeSteps } from "../../../utils/upgradeSteps";
import { TIMING } from "../../../constants/timing";
import { upgradeRunnerContainer, getUpgradeOutcome } from "../../../graphql/upgrades";
import { getSessionGeneration, isSessionStale } from "../../../utils/cacheRegistry";

/** Auto-dismiss completed (success/error) items after this many ms (10 min) */
const COMPLETED_AUTO_DISMISS_MS = 10 * 60 * 1000;

/**
 * @typedef {Object} ActiveUpgrade
 * @property {string} key - Unique key for the upgrade (e.g. containerId-timestamp)
 * @property {Object} container - Container object
 * @property {'queued'|'in_progress'|'success'|'error'} status
 * @property {number} currentStep - Current step index
 * @property {Array<{ label: string, duration: number }>} steps
 * @property {string|null} errorMessage
 * @property {number} [completedAt] - Timestamp when status became success/error (for auto-dismiss)
 */

/**
 * Hook to manage container upgrade operations (single and batch)
 * Single upgrades use a banner above the body; batch upgrades keep the modal.
 * @param {Object} options
 * @param {Object} options.successfullyUpdatedContainersRef - Ref to track updated containers
 * @param {Function} options.onContainersUpdate - Callback to update containers
 * @param {Function} options.fetchContainers - Function to refresh containers
 * @returns {Object} Upgrade state and handlers
 */
export const useContainerUpgrade = ({
  successfullyUpdatedContainersRef,
  onContainersUpdate,
  fetchContainers,
}) => {
  const [upgrading, setUpgrading] = useState({});
  const [upgradeConfirmContainer, setUpgradeConfirmContainer] = useState(null);
  const [activeUpgrades, setActiveUpgrades] = useState(/** @type {ActiveUpgrade[]} */ ([]));
  // Batch: show confirm dialog, then add each container to banner (no modal)
  const [batchUpgradeConfirmContainers, setBatchUpgradeConfirmContainers] = useState([]);

  // Session + timer bookkeeping for in-flight upgrade loops.
  //
  // The generation is captured at hook mount: this hook lives inside the
  // keyed SessionApp tree, so a login/logout bumps the generation (and
  // unmounts us) — every continuation below then belongs to a dead session
  // and must not fire NEW upgrade mutations through the replacement
  // session's client, toast, or write the old session's container state.
  const sessionGenRef = useRef(getSessionGeneration());
  const mountedRef = useRef(true);
  // Step-progress timers (setTimeout/setInterval) created by in-flight
  // upgrade loops. Cleared on unmount so a queued batch cannot keep the
  // loop alive past the session boundary; each entry resolves its promise
  // so the awaiting loop resumes and exits at the next sessionActive() check.
  const progressTimersRef = useRef(new Set());

  useEffect(() => {
    mountedRef.current = true;
    const timers = progressTimersRef.current;
    return () => {
      mountedRef.current = false;
      for (const entry of timers) entry.clear();
      timers.clear();
    };
  }, []);

  const sessionActive = useCallback(
    () => mountedRef.current && !isSessionStale(sessionGenRef.current),
    []
  );

  // setTimeout that is registered in progressTimersRef (unmount-cancellable).
  const delay = useCallback(
    (ms) =>
      new Promise((resolve) => {
        const entry = {};
        entry.clear = () => {
          clearTimeout(entry.id);
          progressTimersRef.current.delete(entry);
          resolve();
        };
        entry.id = setTimeout(() => {
          progressTimersRef.current.delete(entry);
          resolve();
        }, ms);
        progressTimersRef.current.add(entry);
      }),
    []
  );

  // Dismiss a single upgrade from the section (by key). Only completed items are dismissible.
  const dismissActiveUpgrade = useCallback((key) => {
    setActiveUpgrades((prev) => prev.filter((a) => a.key !== key));
  }, []);

  // Auto-dismiss completed (success/error) items after 10 minutes
  useEffect(() => {
    const intervalId = setInterval(() => {
      const now = Date.now();
      setActiveUpgrades((prev) =>
        prev.filter((a) => {
          if (a.status !== "success" && a.status !== "error") return true;
          if (!a.completedAt) return true;
          return now - a.completedAt < COMPLETED_AUTO_DISMISS_MS;
        })
      );
    }, 60 * 1000); // check every minute
    return () => clearInterval(intervalId);
  }, []);

  // Open upgrade confirm (single container) – shows confirm dialog, then banner
  const handleUpgrade = useCallback((container) => {
    setUpgradeConfirmContainer(container);
  }, []);

  const closeUpgradeConfirm = useCallback(() => {
    setUpgradeConfirmContainer(null);
  }, []);

  // Execute upgrade API call for a given container (shared logic)
  const executeUpgradeForContainer = useCallback(
    async (container) => {
      // Never launch an upgrade mutation once the session is gone: the
      // mutation would fly through the NEW session's client for a container
      // the new user may not even own.
      if (!sessionActive()) {
        throw Object.assign(new Error("Session ended before the upgrade started"), {
          sessionEnded: true,
        });
      }
      setUpgrading((prev) => ({ ...prev, [container.id]: true }));
      try {
        // All containers are runner-backed; upgrades go through the Go GraphQL
        // API (mutation + wait for terminal outcome).
        await upgradeRunnerContainer(container);
        if (!sessionActive()) return;

        successfullyUpdatedContainersRef.current.add(container.id);
        if (onContainersUpdate) {
          onContainersUpdate((prevContainers) =>
            prevContainers.map((c) => {
              // Docker short-ids and container names are only unique WITHIN
              // a source: a same-named container on another runner must not
              // have its hasUpdate flag cleared by this upgrade.
              const sameSource =
                (c.runnerId ?? null) === (container.runnerId ?? null) &&
                (c.endpointId ?? null) === (container.endpointId ?? null);
              const matchesId =
                sameSource &&
                (c.id === container.id ||
                  c.id?.substring(0, 12) === container.id?.substring(0, 12));
              const matchesName = sameSource && c.name === container.name;
              if (matchesId || matchesName) return { ...c, hasUpdate: false };
              return c;
            })
          );
        }
        if (fetchContainers) fetchContainers();
      } finally {
        if (sessionActive()) setUpgrading((prev) => ({ ...prev, [container.id]: false }));
      }
    },
    [successfullyUpdatedContainersRef, onContainersUpdate, fetchContainers, sessionActive]
  );

  // Run upgrade for an existing list entry (by key). Used by batch after enqueueing; also by single.
  const runUpgradeForEntry = useCallback(
    async (key, container, steps) => {
      if (!sessionActive()) return;
      const containerName = container.name;
      const updateActive = (patch) => {
        setActiveUpgrades((prev) => prev.map((a) => (a.key === key ? { ...a, ...patch } : a)));
      };

      updateActive({ status: "in_progress" });
      await delay(TIMING.INITIAL_RENDER_DELAY);
      if (!sessionActive()) return;

      const isNginx =
        containerName?.toLowerCase().includes("nginx-proxy-manager") ||
        containerName?.toLowerCase().includes("npm") ||
        container.image?.toLowerCase().includes("nginx-proxy-manager");

      // Timestamp of the attempt: the authoritative upgradeHistory lookup in
      // the network-recovery path only accepts rows written for THIS attempt.
      const upgradeStartedAt = new Date();
      const apiPromise = executeUpgradeForContainer(container);
      const apiCompletedRef = { current: false };
      let apiError = null;
      apiPromise.catch((err) => {
        apiCompletedRef.current = true;
        apiError = err;
      });

      for (let i = 0; i < steps.length; i++) {
        if (!sessionActive()) return;
        updateActive({ currentStep: i });
        const stepDuration = steps[i].duration;
        const minStep = TIMING.MIN_STEP_DURATION;
        const stepStart = Date.now();
        await new Promise((resolve) => {
          const entry = {};
          entry.clear = () => {
            clearInterval(entry.id);
            progressTimersRef.current.delete(entry);
            resolve();
          };
          entry.id = setInterval(() => {
            const elapsed = Date.now() - stepStart;
            if (elapsed < minStep) return;
            if (apiCompletedRef.current || elapsed >= stepDuration) {
              clearInterval(entry.id);
              progressTimersRef.current.delete(entry);
              resolve();
            }
          }, 100);
          progressTimersRef.current.add(entry);
        });
      }
      if (!sessionActive()) return;
      updateActive({ currentStep: steps.length - 1 });
      await delay(TIMING.FINAL_STEP_DELAY);
      if (!sessionActive()) return;

      try {
        await apiPromise;
        if (!sessionActive()) return;
        updateActive({ status: "success", completedAt: Date.now() });
        toast.success(`Container ${containerName} upgraded successfully!`, 8000);
        if (fetchContainers) fetchContainers();
      } catch (err) {
        if (!sessionActive()) return;
        if (apiError && isNginx) {
          const isNetworkError =
            !apiError.operationError &&
            (apiError.code === "ECONNREFUSED" ||
              apiError.code === "ETIMEDOUT" ||
              apiError.code === "ERR_NETWORK" ||
              apiError.message?.includes("Network Error") ||
              apiError.message?.includes("Failed to fetch") ||
              !apiError.response);
          if (isNetworkError) {
            const maxWait = TIMING.RECONNECT_MAX_WAIT;
            const pollInterval = TIMING.RECONNECT_POLL_INTERVAL;
            const start = Date.now();
            while (Date.now() - start < maxWait) {
              await delay(pollInterval);
              if (!sessionActive()) return;
              try {
                // Authoritative verification, NOT mere existence: a transport
                // error with no response may mean the upgrade never started,
                // in which case the unchanged OLD container is still running
                // under the same name. Only a terminal upgradeHistory row for
                // this attempt proves the worker accepted and finished it.
                const outcome = await getUpgradeOutcome(container, upgradeStartedAt);
                if (!sessionActive()) return;
                if (outcome?.status === "SUCCESS") {
                  updateActive({ status: "success", completedAt: Date.now() });
                  toast.success(`Container ${containerName} upgraded successfully!`, 8000);
                  if (fetchContainers) fetchContainers();
                  return;
                }
                if (outcome?.status === "FAILED") {
                  updateActive({
                    status: "error",
                    errorMessage: outcome.errorMessage || "Upgrade failed",
                    completedAt: Date.now(),
                  });
                  return;
                }
                // No terminal row yet — keep polling until the timeout.
              } catch {
                if (!sessionActive()) return;
                // keep polling
              }
            }
            updateActive({
              status: "error",
              errorMessage:
                "Upgrade may have completed, but we couldn't verify. Refresh the page to check.",
              completedAt: Date.now(),
            });
            return;
          }
        }
        updateActive({
          status: "error",
          errorMessage: err.response?.data?.error || err.message || "Unknown error occurred",
          completedAt: Date.now(),
        });
      }
    },
    [executeUpgradeForContainer, fetchContainers, sessionActive, delay]
  );

  // Run upgrade in banner (add to list + step progress + API). Used by single confirm.
  const startUpgrade = useCallback(
    async (container) => {
      if (!container) return;
      const key = `${container.id}-${Date.now()}`;
      const steps = getUpgradeSteps(container);

      setActiveUpgrades((prev) => [
        ...prev,
        {
          key,
          container,
          status: "in_progress",
          currentStep: 0,
          steps,
          errorMessage: null,
        },
      ]);

      await runUpgradeForEntry(key, container, steps);
    },
    [runUpgradeForEntry]
  );

  // Confirm single upgrade and start it (close confirm dialog, then run in banner)
  const confirmAndStartUpgrade = useCallback(
    async (container) => {
      if (!container) return;
      closeUpgradeConfirm();
      await startUpgrade(container);
    },
    [closeUpgradeConfirm, startUpgrade]
  );

  const handleBatchUpgrade = useCallback((selectedContainers, aggregatedContainers) => {
    if (selectedContainers.size === 0) {
      toast.warning("Please select at least one container to upgrade");
      return null;
    }

    const containersToUpgrade = aggregatedContainers.all.filter((c) =>
      selectedContainers.has(c.id)
    );

    setBatchUpgradeConfirmContainers(containersToUpgrade);

    return {
      containerCount: containersToUpgrade.length,
      containers: containersToUpgrade,
    };
  }, []);

  const closeBatchUpgradeConfirm = useCallback(() => {
    setBatchUpgradeConfirmContainers([]);
  }, []);

  // Confirm batch: add all to Updating section as queued, then run one at a time per stack.
  const confirmAndStartBatchUpgrade = useCallback(
    async (containersToUpgrade, setSelectedContainers) => {
      if (!containersToUpgrade?.length) return;
      setBatchUpgradeConfirmContainers([]);
      if (setSelectedContainers) {
        setSelectedContainers(new Set());
      }

      // Enqueue all selected containers immediately so they appear in the Updating section
      const entries = containersToUpgrade.map((container) => {
        const key = `${container.id}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
        const steps = getUpgradeSteps(container);
        return { key, container, steps };
      });

      setActiveUpgrades((prev) => [
        ...prev,
        ...entries.map(({ key, container, steps }) => ({
          key,
          container,
          status: "queued",
          currentStep: 0,
          steps,
          errorMessage: null,
        })),
      ]);

      await delay(TIMING.INITIAL_RENDER_DELAY);
      if (!sessionActive()) return;

      // Group by stack (same stack = one at a time; different stacks = in
      // parallel). Stack names are only unique within a source, so the
      // group key includes the runner/endpoint identity.
      const byStack = entries.reduce((acc, entry) => {
        const scope = entry.container.runnerId ?? entry.container.endpointId ?? "";
        const stack = `${scope}|${entry.container.stackName || "Standalone"}`;
        if (!acc[stack]) acc[stack] = [];
        acc[stack].push(entry);
        return acc;
      }, /** @type {{ [stack: string]: typeof entries }} */ ({}));
      const stackArrays = Object.values(byStack);

      await Promise.all(
        stackArrays.map(async (stackEntries) => {
          for (const { key, container, steps } of stackEntries) {
            // A session change mid-batch must stop the queue: the NEXT entry
            // would otherwise fire a fresh upgrade mutation through the new
            // session's client for the old session's container.
            if (!sessionActive()) return;
            await runUpgradeForEntry(key, container, steps);
          }
        })
      );
    },
    [runUpgradeForEntry, sessionActive, delay]
  );

  return {
    upgrading,
    upgradeConfirmContainer,
    closeUpgradeConfirm,
    confirmAndStartUpgrade,
    startUpgrade,
    activeUpgrades,
    dismissActiveUpgrade,
    batchUpgradeConfirmContainers,
    closeBatchUpgradeConfirm,
    confirmAndStartBatchUpgrade,
    handleUpgrade,
    handleBatchUpgrade,
  };
};
