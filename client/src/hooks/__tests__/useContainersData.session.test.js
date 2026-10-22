import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

beforeEach(() => {
  const store = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  });
});

const queryMock = vi.fn();
vi.mock("../../graphql/client", () => ({
  graphqlClient: { query: (...args) => queryMock(...args) },
}));
const graphMock = vi.fn();
vi.mock("../../graphql/containers", () => ({
  fetchContainersGraphql: (...args) => graphMock(...args),
}));

import { useContainersData } from "../useContainersData";
import { clearAllCaches } from "../../utils/cacheRegistry";

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("useContainersData session guard", () => {
  it("drops a containers response that lands after logout", async () => {
    const d = deferred();
    graphMock.mockReturnValue(d.promise);
    queryMock.mockResolvedValue({ data: { unusedImages: [] } });

    const { result } = renderHook(() => useContainersData({ current: new Map() }));

    let fetchPromise;
    act(() => {
      fetchPromise = result.current.fetchContainers(false);
    });

    // Logout happens while the request is in flight.
    act(() => {
      clearAllCaches();
    });

    // The dead session's response arrives now.
    d.resolve({ containers: [{ id: "c1", image_name: "nginx" }], stacks: [] });
    await act(async () => {
      await fetchPromise;
    });

    expect(result.current.containers).toEqual([]);
  });

  it("accepts a response from the live session", async () => {
    graphMock.mockResolvedValue({ containers: [{ id: "c2", image_name: "redis" }], stacks: [] });
    queryMock.mockResolvedValue({ data: { unusedImages: [] } });

    const { result } = renderHook(() => useContainersData({ current: new Map() }));

    await act(async () => {
      await result.current.fetchContainers(false);
    });

    expect(result.current.containers.map((c) => c.id)).toEqual(["c2"]);
  });
});
