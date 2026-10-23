// Session-boundary regression tests for the upgrade watcher: a login/logout
// mid-flight must tear the watcher down (unsubscribe + stop the history poll)
// instead of letting it run against the replacement session's client, and
// getUpgradeOutcome is the authoritative history lookup the network-recovery
// path relies on.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { upgradeRunnerContainer, getUpgradeOutcome } from "../upgrades";
import { clearAllCaches } from "../../utils/cacheRegistry";

const handlers = { mutation: null, query: null, subscription: null };
const calls = { subscription: 0, unsubscribes: 0, queries: 0 };

vi.mock("../client", () => ({
  graphqlClient: {
    query: (doc, vars) => {
      calls.queries++;
      return handlers.query(doc, vars);
    },
    mutation: (doc, vars) => handlers.mutation(doc, vars),
    subscription: (doc, opts) => {
      calls.subscription++;
      return handlers.subscription(doc, opts);
    },
  },
}));

const source = { id: "abc123def456", image: "img:1", name: "famOS", runnerId: 16 };

const opResult = (payload) => ({ toPromise: () => Promise.resolve(payload) });

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

const okMutation = () => {
  handlers.mutation = () => opResult({ data: { upgradeContainer: { id: "op-1" } } });
};

beforeEach(() => {
  vi.useFakeTimers();
  calls.subscription = calls.unsubscribes = calls.queries = 0;
  handlers.query = () => opResult({ data: { upgradeHistory: { items: [] } } });
});

afterEach(() => {
  handlers.mutation = handlers.query = handlers.subscription = null;
  vi.useRealTimers();
});

describe("upgradeRunnerContainer session guard", () => {
  it("creates no subscription when the session ends before the mutation lands", async () => {
    let resolveMutation;
    handlers.mutation = () => ({
      toPromise: () =>
        new Promise((r) => {
          resolveMutation = r;
        }),
    });

    const p = upgradeRunnerContainer(source);
    await flush();
    clearAllCaches();
    resolveMutation({ data: { upgradeContainer: { id: "op-1" } } });

    const err = await p.catch((e) => e);
    expect(err.sessionEnded).toBe(true);
    expect(err.message).toBe("Session ended before the upgrade completed");
    // No socket, no poll timer: nothing may be created through the new client.
    expect(calls.subscription).toBe(0);
    expect(calls.queries).toBe(0);
  });

  it("settles the watcher once the session ends: unsubscribes and stops polling", async () => {
    okMutation();
    handlers.subscription = () => ({
      subscribe: () => ({
        unsubscribe: () => {
          calls.unsubscribes++;
        },
      }),
    });

    const p = upgradeRunnerContainer(source, { timeoutMs: 60000 });
    await flush();
    clearAllCaches();
    // Handler attached BEFORE the tick: the poll rejects this promise inside
    // advanceTimersByTimeAsync, and a rejection with no handler yet attached
    // is reported as an unhandled rejection even though it is caught below.
    const settled = p.catch((e) => e);
    await vi.advanceTimersByTimeAsync(3000); // poll tick observes the dead session

    const err = await settled;
    expect(err.sessionEnded).toBe(true);
    expect(calls.unsubscribes).toBe(1);
    // The poll tick short-circuits BEFORE issuing the history query.
    expect(calls.queries).toBe(0);
  });

  it("settles (instead of resolving) a progress event that arrives after logout", async () => {
    okMutation();
    let onEvent = null;
    handlers.subscription = () => ({
      subscribe: (cb) => {
        onEvent = cb;
        return {
          unsubscribe: () => {
            calls.unsubscribes++;
          },
        };
      },
    });

    const p = upgradeRunnerContainer(source, { timeoutMs: 60000 });
    await flush();
    clearAllCaches();
    // A late COMPLETED event from the dead session's socket must not resolve
    // the upgrade as a success for the new session.
    onEvent({ data: { containerUpgradeProgress: { operationId: "op-1", phase: "COMPLETED" } } });

    const err = await p.catch((e) => e);
    expect(err.sessionEnded).toBe(true);
    expect(calls.unsubscribes).toBe(1);
  });

  it("still resolves for the live session (non-vacuity control)", async () => {
    okMutation();
    handlers.subscription = () => ({
      subscribe: (cb) => {
        cb({ data: { containerUpgradeProgress: { operationId: "op-1", phase: "COMPLETED" } } });
        return { unsubscribe: () => {} };
      },
    });

    await expect(upgradeRunnerContainer(source)).resolves.toEqual({
      success: true,
      operationId: "op-1",
    });
  });
});

describe("getUpgradeOutcome", () => {
  const startedAt = new Date("2026-01-01T00:00:00.000Z");

  const history = (items) => {
    handlers.query = () => opResult({ data: { upgradeHistory: { items } } });
  };

  it("returns the terminal SUCCESS row for this container's attempt", async () => {
    history([
      {
        dockerContainerId: source.id,
        status: "SUCCESS",
        errorMessage: null,
        source: { id: "16" },
      },
    ]);
    await expect(getUpgradeOutcome(source, startedAt)).resolves.toEqual({
      status: "SUCCESS",
      errorMessage: null,
    });
  });

  it("returns the terminal FAILED row with its message", async () => {
    history([
      {
        dockerContainerId: source.id,
        status: "FAILED",
        errorMessage: "pull denied",
        source: { id: "16" },
      },
    ]);
    await expect(getUpgradeOutcome(source, startedAt)).resolves.toEqual({
      status: "FAILED",
      errorMessage: "pull denied",
    });
  });

  it("returns null when no terminal row exists for this attempt", async () => {
    // A row for a DIFFERENT container (same name, other runner) is not proof.
    history([{ dockerContainerId: "other99999", status: "SUCCESS", errorMessage: null }]);
    await expect(getUpgradeOutcome(source, startedAt)).resolves.toBeNull();
  });

  // Container names are not unique across runners. A row carrying this
  // container's pre-recreate docker id but recorded against another host must
  // not stand in for an attempt that never happened here.
  it("ignores a same-named row recorded against a different runner", async () => {
    history([
      {
        dockerContainerId: source.id,
        status: "SUCCESS",
        errorMessage: null,
        source: { id: "17" },
      },
    ]);
    await expect(getUpgradeOutcome(source, startedAt)).resolves.toBeNull();
  });

  it("scopes the history read to the container's runner", async () => {
    let seen = null;
    handlers.query = (doc, vars) => {
      seen = vars;
      return opResult({ data: { upgradeHistory: { items: [] } } });
    };
    await getUpgradeOutcome(source, startedAt);
    expect(seen.filter.runnerId).toBe("16");
    expect(seen.filter.containerName).toBe("famOS");
  });

  it("throws on a query error so the caller keeps polling", async () => {
    handlers.query = () => opResult({ error: { message: "boom" } });
    await expect(getUpgradeOutcome(source, startedAt)).rejects.toThrow("boom");
  });
});
