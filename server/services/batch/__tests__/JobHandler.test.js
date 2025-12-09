/**
 * Unit tests for JobHandler base class
 */

const JobHandler = require("../JobHandler");

describe("JobHandler", () => {
  class TestJobHandler extends JobHandler {
    getJobType() {
      return "test-job";
    }

    getDisplayName() {
      return "Test Job";
    }

    async execute(_context) {
      return {
        itemsChecked: 10,
        itemsUpdated: 2,
        logs: [],
        error: null,
      };
    }
  }

  let handler;

  beforeEach(() => {
    handler = new TestJobHandler();
  });

  describe("getJobType", () => {
    it("should return job type identifier", () => {
      expect(handler.getJobType()).toBe("test-job");
    });
  });

  describe("getDisplayName", () => {
    it("should return display name", () => {
      expect(handler.getDisplayName()).toBe("Test Job");
    });
  });

  describe("validateConfig", () => {
    it("should validate correct config", () => {
      const config = { enabled: true, intervalMinutes: 60 };
      const result = handler.validateConfig(config);
      expect(result.valid).toBe(true);
    });

    it("should reject invalid config - not an object", () => {
      const result = handler.validateConfig(null);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("object");
    });

    it("should reject invalid config - missing enabled", () => {
      const config = { intervalMinutes: 60 };
      const result = handler.validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("enabled");
    });

    it("should reject invalid config - invalid intervalMinutes", () => {
      const config = { enabled: true, intervalMinutes: 0 };
      const result = handler.validateConfig(config);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("intervalMinutes");
    });
  });

  describe("getDefaultConfig", () => {
    it("should return default configuration", () => {
      const config = handler.getDefaultConfig();
      expect(config).toEqual({
        enabled: false,
        intervalMinutes: 60,
      });
    });
  });

  describe("execute", () => {
    it("should execute job and return result", async () => {
      const context = { logger: { info: jest.fn() } };
      const result = await handler.execute(context);

      expect(result.itemsChecked).toBe(10);
      expect(result.itemsUpdated).toBe(2);
      expect(result.error).toBeNull();
    });
  });
});
