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

  it("handles empty inputs", () => {
    expect(versionsEqual("", "1.0.0")).toBe(false);
    expect(versionsEqual("1.0.0", "")).toBe(false);
  });
});
