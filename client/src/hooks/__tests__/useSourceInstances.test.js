/**
 * Source-instance selection tests for useSourceInstances.
 *
 * The source list used to be derived from the container groupings alone, so a
 * runner that currently reports no containers disappeared from the picker -
 * and with it the unused-image management UI for that runner.
 */
import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";

import { useSourceInstances } from "../useSourceInstances";

const container = (over = {}) => ({
  id: "c1",
  name: "svc",
  source: "runner",
  runnerId: 3,
  runnerName: "toybox",
  hasUpdate: false,
  ...over,
});

describe("useSourceInstances", () => {
  it("keeps a runner with no containers in the source list", () => {
    const { result } = renderHook(() =>
      useSourceInstances({ containers: [], runners: [{ id: "3", name: "toybox" }] })
    );

    expect(result.current.sourceInstances).toEqual([
      {
        name: "toybox",
        url: "runner:3",
        isRunner: true,
        runnerId: 3,
        containers: [],
        withUpdates: [],
        upToDate: [],
      },
    ]);
  });

  it("merges the container grouping into the runner entry", () => {
    const { result } = renderHook(() =>
      useSourceInstances({
        containers: [container({ id: "a", hasUpdate: true }), container({ id: "b" })],
        runners: [{ id: 3, name: "toybox" }],
      })
    );

    const [instance] = result.current.sourceInstances;
    expect(instance.url).toBe("runner:3");
    expect(instance.containers.map((c) => c.id)).toEqual(["a", "b"]);
    expect(instance.withUpdates.map((c) => c.id)).toEqual(["a"]);
    expect(instance.upToDate.map((c) => c.id)).toEqual(["b"]);
  });

  it("still shows a source for containers whose runner row is missing", () => {
    const { result } = renderHook(() =>
      useSourceInstances({ containers: [container({ runnerId: 9 })], runners: [] })
    );

    expect(result.current.sourceInstances.map((i) => i.url)).toEqual(["runner:9"]);
  });

  it("sorts instances by name", () => {
    const { result } = renderHook(() =>
      useSourceInstances({
        containers: [],
        runners: [
          { id: 1, name: "zeta" },
          { id: 2, name: "alpha" },
        ],
      })
    );

    expect(result.current.sourceInstances.map((i) => i.name)).toEqual(["alpha", "zeta"]);
  });
});
