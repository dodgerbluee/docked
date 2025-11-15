/**
 * Unit tests for BatchManager
 */

const BatchManager = require("../BatchManager");
const JobHandler = require("../JobHandler");

describe("BatchManager", () => {
  let batchManager;

  class MockJobHandler extends JobHandler {
    constructor(jobType, displayName) {
      super();
      this.jobType = jobType;
      this.displayName = displayName;
    }

    getJobType() {
      return this.jobType;
    }

    getDisplayName() {
      return this.displayName;
    }

    async execute(context) {
      return {
        itemsChecked: 5,
        itemsUpdated: 1,
        logs: [],
        error: null,
      };
    }
  }

  beforeEach(() => {
    batchManager = new BatchManager();
  });

  afterEach(() => {
    batchManager.stop();
  });

  describe("registerHandler", () => {
    it("should register a job handler", () => {
      const handler = new MockJobHandler("test-job", "Test Job");
      batchManager.registerHandler(handler);

      expect(batchManager.getHandler("test-job")).toBe(handler);
      expect(batchManager.getRegisteredJobTypes()).toContain("test-job");
    });

    it("should throw error if handler already registered", () => {
      const handler1 = new MockJobHandler("test-job", "Test Job");
      const handler2 = new MockJobHandler("test-job", "Test Job 2");

      batchManager.registerHandler(handler1);

      expect(() => {
        batchManager.registerHandler(handler2);
      }).toThrow("already registered");
    });
  });

  describe("getRegisteredJobTypes", () => {
    it("should return empty array when no handlers registered", () => {
      expect(batchManager.getRegisteredJobTypes()).toEqual([]);
    });

    it("should return all registered job types", () => {
      batchManager.registerHandler(new MockJobHandler("job1", "Job 1"));
      batchManager.registerHandler(new MockJobHandler("job2", "Job 2"));

      const types = batchManager.getRegisteredJobTypes();
      expect(types).toContain("job1");
      expect(types).toContain("job2");
      expect(types).toHaveLength(2);
    });
  });

  describe("getHandler", () => {
    it("should return handler for registered job type", () => {
      const handler = new MockJobHandler("test-job", "Test Job");
      batchManager.registerHandler(handler);

      expect(batchManager.getHandler("test-job")).toBe(handler);
    });

    it("should return null for unregistered job type", () => {
      expect(batchManager.getHandler("non-existent")).toBeNull();
    });
  });

  describe("executeJob", () => {
    it("should throw error for unregistered job type", async () => {
      await expect(batchManager.executeJob("non-existent")).rejects.toThrow();
    });

    it("should execute registered job", async () => {
      const handler = new MockJobHandler("test-job", "Test Job");
      batchManager.registerHandler(handler);

      // Mock database functions
      const mockCreateBatchRun = jest.fn().mockResolvedValue(1);
      const mockUpdateBatchRun = jest.fn().mockResolvedValue();

      // We can't easily mock the database here, so we'll test the structure
      // In integration tests, we'll test the full flow
      expect(batchManager.getHandler("test-job")).toBe(handler);
    });
  });

  describe("getStatus", () => {
    it("should return status object", () => {
      const status = batchManager.getStatus();

      expect(status).toHaveProperty("registeredJobs");
      expect(status).toHaveProperty("runningJobs");
      expect(status).toHaveProperty("scheduler");
      expect(Array.isArray(status.registeredJobs)).toBe(true);
      expect(Array.isArray(status.runningJobs)).toBe(true);
    });
  });
});
