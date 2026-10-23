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

// pullContainers registers the run and answers with its id as "batch-<runId>";
// the poll then follows exactly that run through batchRun(id:).
const pullTrigger = (id = "batch-7") => ({
  data: { pullContainers: { id, type: "PULL_CONTAINERS", status: "RUNNING" } },
});

const runRow = (status) => ({
  data: { batchRun: { id: "7", status, jobType: "DOCKER_HUB_PULL" } },
});

beforeEach(() => {
  vi.useFakeTimers();
  handlers.mutation = () => opResult(pullTrigger());
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

  // Following "the newest docker-hub-pull run" let an overlapping scheduled
  // sync decide this call's outcome. The poll must carry the id the mutation
  // returned, and must not fall back to a list query.
  it("polls the run the mutation returned, not the newest run of the job type", async () => {
    const seen = [];
    handlers.query = (doc, vars) => {
      seen.push(vars);
      return opResult(runRow("COMPLETED"));
    };
    await runContainerSync();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual({ id: "7" });
  });

  it("rejects when the mutation does not report a run to follow", async () => {
    handlers.mutation = () =>
      opResult({ data: { pullContainers: { id: null, status: "RUNNING" } } });
    handlers.query = () => opResult(runRow("COMPLETED"));
    await expect(runContainerSync()).rejects.toThrow("did not report a run to follow");
  });
});
