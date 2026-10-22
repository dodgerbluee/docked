// runContainerSync must reject when the batch run is STILL running at the
// 5-minute timeout: resolving the stale running row made callers mark data
// fresh and show a completed scan that never finished.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runContainerSync } from "../sync";

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

beforeEach(() => {
  vi.useFakeTimers();
  handlers.mutation = () => opResult({ data: { pullContainers: { success: true } } });
});

afterEach(() => {
  handlers.mutation = handlers.query = null;
  vi.useRealTimers();
});

describe("runContainerSync", () => {
  it("resolves when the run completes", async () => {
    handlers.query = () => opResult(runRow("COMPLETED"));
    await expect(runContainerSync()).resolves.toMatchObject({ status: "completed" });
  });

  it("rejects when the run fails", async () => {
    handlers.query = () => opResult(runRow("FAILED"));
    await expect(runContainerSync()).rejects.toThrow();
  });

  it("rejects on timeout while the run is still running", async () => {
    handlers.query = () => opResult(runRow("RUNNING"));
    const p = runContainerSync();
    const assertion = expect(p).rejects.toThrow(
      "Batch job did not complete within the expected time"
    );
    await vi.advanceTimersByTimeAsync(301000);
    await assertion;
  });
});
