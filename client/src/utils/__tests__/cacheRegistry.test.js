import { describe, it, expect } from "vitest";
import {
  registerCacheClear,
  clearAllCaches,
  getSessionGeneration,
  isSessionStale,
} from "../cacheRegistry";

describe("session generation guard", () => {
  it("bumps the generation on clearAllCaches and marks older captures stale", () => {
    let cleared = 0;
    registerCacheClear(() => {
      cleared += 1;
    });

    const gen = getSessionGeneration();
    expect(isSessionStale(gen)).toBe(false);

    clearAllCaches();

    expect(cleared).toBe(1);
    // Anything captured before the flush is now stale…
    expect(isSessionStale(gen)).toBe(true);
    // …while the live session's generation is current.
    expect(isSessionStale(getSessionGeneration())).toBe(false);
  });
});
