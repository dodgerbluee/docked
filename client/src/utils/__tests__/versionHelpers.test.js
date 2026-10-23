import { describe, it, expect } from "vitest";
import { hasVersionUpdate, versionsEqual } from "../versionHelpers";

describe("hasVersionUpdate", () => {
  it("does not flag format-only differences as updates", () => {
    // Missing trailing .0 and/or a leading "v" should never be a mismatch.
    expect(hasVersionUpdate("12.2.0", "v12.2")).toBe(false);
    expect(hasVersionUpdate("v12.2", "12.2.0")).toBe(false);
    expect(hasVersionUpdate("12.2", "12.2.0")).toBe(false);
    expect(hasVersionUpdate("v12.2", "v12.2.0")).toBe(false);
    expect(hasVersionUpdate("v12", "12.0.0")).toBe(false);
  });

  it("flags genuinely newer versions", () => {
    expect(hasVersionUpdate("12.2.0", "12.3.0")).toBe(true);
    expect(hasVersionUpdate("12.2", "12.2.1")).toBe(true);
    expect(hasVersionUpdate("v0.9.1", "v0.9.2")).toBe(true);
  });

  it("does not flag downgrades or equal versions", () => {
    expect(hasVersionUpdate("12.3.0", "12.2.0")).toBe(false);
    expect(hasVersionUpdate("0.9.2", "0.9.1")).toBe(false);
    expect(hasVersionUpdate("1.0.0", "1.0.0")).toBe(false);
  });

  it("handles empty inputs", () => {
    expect(hasVersionUpdate("", "1.0.0")).toBe(false);
    expect(hasVersionUpdate("1.0.0", "")).toBe(false);
  });

  it("falls back to string inequality for non-semver strings", () => {
    expect(hasVersionUpdate("abc", "def")).toBe(true);
    expect(hasVersionUpdate("abc", "abc")).toBe(false);
  });

  it("orders prereleases below the release they precede", () => {
    // The old parser truncated at major.minor.patch, so both sides looked
    // like 1.2.3 and rc -> final was never reported as an update.
    expect(hasVersionUpdate("1.2.3-rc.1", "1.2.3")).toBe(true);
    expect(hasVersionUpdate("1.2.3", "1.2.3-rc.1")).toBe(false);
    expect(hasVersionUpdate("1.2.3-rc.1", "1.2.3-rc.2")).toBe(true);
    expect(hasVersionUpdate("1.2.3-rc.2", "1.2.3-rc.1")).toBe(false);
    expect(hasVersionUpdate("3.31.0-dev", "3.31.0")).toBe(true);
  });

  it("compares numeric cores of any length", () => {
    // Truncating at three components made 1.2.3.1 and 1.2.3.2 identical.
    expect(hasVersionUpdate("1.2.3.1", "1.2.3.2")).toBe(true);
    expect(hasVersionUpdate("1.2.3.2", "1.2.3.1")).toBe(false);
    expect(hasVersionUpdate("1.2", "1.2.0.1")).toBe(true);
  });

  it("ignores build metadata, like semver does", () => {
    expect(hasVersionUpdate("1.2.3+build1", "1.2.3+build2")).toBe(false);
  });

  it("orders date-style tags by their suffix", () => {
    expect(hasVersionUpdate("2024-01-15", "2024-01-16")).toBe(true);
    expect(hasVersionUpdate("2024-01-16", "2024-01-15")).toBe(false);
  });
});

describe("versionsEqual", () => {
  it("treats format-only differences as equal", () => {
    expect(versionsEqual("12.2.0", "v12.2")).toBe(true);
    expect(versionsEqual("v12.2", "12.2.0")).toBe(true);
    expect(versionsEqual("12.2", "12.2.0")).toBe(true);
    expect(versionsEqual("v12", "12.0.0")).toBe(true);
  });

  it("distinguishes genuinely different versions", () => {
    expect(versionsEqual("12.2.0", "12.3.0")).toBe(false);
    expect(versionsEqual("12.2", "12.2.1")).toBe(false);
  });

  it("does not call a prerelease equal to its release", () => {
    expect(versionsEqual("1.2.3", "1.2.3-rc.1")).toBe(false);
    expect(versionsEqual("1.2.3.1", "1.2.3.2")).toBe(false);
  });

  it("treats build metadata as cosmetic", () => {
    expect(versionsEqual("1.2.3+build1", "1.2.3+build2")).toBe(true);
  });

  it("handles empty inputs", () => {
    expect(versionsEqual("", "1.0.0")).toBe(false);
    expect(versionsEqual("1.0.0", "")).toBe(false);
  });
});
