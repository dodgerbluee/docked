/**
 * Reconciliation correlation tests for useOperationTasks.
 *
 * When an operation's SSE stream drops, the task is finalized from the runner's
 * persisted `lastRun`. That is only sound if the persisted run is OUR run: a
 * POST that never reached the runner used to be "reconciled" against the
 * previous run's exit code and reported as Completed (exit 0).
 */
import { describe, it, expect } from "vitest";

import { reconcileOutcome } from "../useOperationTasks";

const task = (over = {}) => ({
  startedAt: "2026-10-23T00:00:00Z",
  priorRunId: null,
  ...over,
});

describe("reconcileOutcome", () => {
  it("rejects a lastRun still carrying the id recorded before we started", () => {
    expect(reconcileOutcome(task({ priorRunId: 22 }), { id: 22, exitCode: 0 })).toBeNull();
  });

  it("accepts a run with a newer id", () => {
    expect(reconcileOutcome(task({ priorRunId: 22 }), { id: 23, exitCode: 0 })).toBe(0);
    expect(reconcileOutcome(task({ priorRunId: 22 }), { id: 23, exitCode: 7 })).toBe(7);
  });

  it("treats the first recorded run as ours", () => {
    expect(reconcileOutcome(task(), { id: 1, exitCode: 3 })).toBe(3);
  });

  it("falls back to the finish time when the agent reports no run ids", () => {
    const daysOld = { exitCode: 0, finishedAt: "2026-10-20T00:00:00Z" };
    expect(reconcileOutcome(task(), daysOld)).toBeNull();

    const fresh = { exitCode: 0, finishedAt: "2026-10-23T00:01:00Z" };
    expect(reconcileOutcome(task(), fresh)).toBe(0);
  });

  it("has no result to reconcile when the runner reports none", () => {
    expect(reconcileOutcome(task(), undefined)).toBeNull();
    expect(reconcileOutcome(task({ priorRunId: 5 }), null)).toBeNull();
  });

  it("reports a missing exit code as a failure, never as success", () => {
    expect(reconcileOutcome(task({ priorRunId: 1 }), { id: 2 })).toBe(1);
  });
});
