/**
 * Session-isolation regression tests for useExport.
 *
 * The export response auto-creates and clicks a download link. If the session
 * ends while the request is in flight, the payload belongs to the previous
 * account and must not be written to disk for the new one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const getMock = vi.fn();
vi.mock("axios", () => ({
  default: { get: (...args) => getMock(...args) },
}));

import { useExport } from "../useExport";
import { clearAllCaches } from "../../utils/cacheRegistry";

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("useExport session guard", () => {
  let createdLinks;

  beforeEach(() => {
    const store = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    });

    createdLinks = [];
    const realCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag, options) => {
      const el = realCreateElement(tag, options);
      if (tag === "a") {
        el.click = vi.fn();
        createdLinks.push(el);
      }
      return el;
    });
    URL.createObjectURL = vi.fn(() => "blob:export");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete URL.createObjectURL;
    delete URL.revokeObjectURL;
  });

  it("does not download an export that lands after logout", async () => {
    const d = deferred();
    getMock.mockReturnValue(d.promise);

    const { result } = renderHook(() => useExport());

    let run;
    act(() => {
      run = result.current.handleExport("/api/apps/export", "apps");
    });

    act(() => {
      clearAllCaches(); // logout + login while the export is in flight
    });

    d.resolve({ data: { success: true, data: [{ name: "previous-account" }] } });
    await act(async () => {
      await run;
    });

    expect(createdLinks).toHaveLength(0);
    expect(result.current.exportSuccess).toBe("");
  });

  it("still downloads for the live session (guard is not blanket)", async () => {
    getMock.mockResolvedValue({ data: { success: true, data: [{ name: "apps" }] } });

    const { result } = renderHook(() => useExport());

    await act(async () => {
      await result.current.handleExport("/api/apps/export", "apps");
    });

    expect(createdLinks).toHaveLength(1);
    expect(createdLinks[0].click).toHaveBeenCalledTimes(1);
    expect(result.current.exportSuccess).toBe("Export successful!");
  });
});
