// Session-boundary regression tests for runContainerSync: a login/logout
// mid-flight must stop the poll loop (and reject) instead of firing queries
// through the replacement session's client.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runContainerSync } from "../sync";
import { clearAllCaches } from "../../utils/cacheRegistry";

const handlers = { mutation: null, query: null };

vi.mock("../client", () => ({
  graphqlClient: {
    mutation: (doc, vars) => handlers.mutation(doc, vars),
    query: (doc, vars) => handlers.query(doc, vars),
  },
}));

const opResult = (payload) => ({ toPromise: () => Promise.resolve(payload) });

const runRow = (status) => ({
  data: { batchRuns: { items: [{ id: "7", status, jobType: "DOCKER_HUB_PULL" }] } },
});

// Drain pending microtasks (fake timers leave Promise chains intact).
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

let queryCalls;

beforeEach(() => {
  vi.useFakeTimers();
  queryCalls = 0;
  handlers.mutation = () => opResult({ data: { pullContainers: { success: true } } });
});

afterEach(() => {
  handlers.mutation = handlers.query = null;
  vi.useRealTimers();
});

describe("runContainerSync session guard", () => {
  it("stops polling and rejects once the session ends mid-flight", async () => {
    handlers.query = () => {
      queryCalls++;
      return opResult(runRow("RUNNING"));
    };

    const p = runContainerSync();
    const assertion = expect(p).rejects.toThrow(
      "Session ended before the container sync completed"
    );
    await flush(); // trigger + first poll settle, sleep(1000) registered
    clearAllCaches();
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;

    // The dead session must not keep querying through the new client.
    expect(queryCalls).toBe(1);
  });

  it("rejects when the session ends while the trigger mutation is in flight", async () => {
    let resolveMutation;
    handlers.mutation = () => ({
      toPromise: () =>
        new Promise((r) => {
          resolveMutation = r;
        }),
    });

    const p = runContainerSync();
    await flush();
    clearAllCaches();
    resolveMutation({ data: { pullContainers: { success: true } } });

    const err = await p.catch((e) => e);
    expect(err.sessionEnded).toBe(true);
    expect(err.message).toBe("Session ended before the container sync completed");
    expect(queryCalls).toBe(0);
  });

  it("keeps polling while the session is live (non-vacuity control)", async () => {
    handlers.query = () => {
      queryCalls++;
      return opResult(runRow(queryCalls >= 3 ? "COMPLETED" : "RUNNING"));
    };

    const p = runContainerSync();
    await vi.advanceTimersByTimeAsync(5000);

    await expect(p).resolves.toMatchObject({ status: "completed" });
    expect(queryCalls).toBe(3);
  });
});
