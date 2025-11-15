/**
 * Unit tests for BatchLogger
 */

const BatchLogger = require("../Logger");

describe("BatchLogger", () => {
  let logger;

  beforeEach(() => {
    logger = new BatchLogger("test-job");
  });

  describe("constructor", () => {
    it("should create logger with job type", () => {
      expect(logger.jobType).toBe("test-job");
      expect(logger.logs).toEqual([]);
    });

    it("should default to system job type", () => {
      const systemLogger = new BatchLogger();
      expect(systemLogger.jobType).toBe("system");
    });
  });

  describe("log", () => {
    it("should log message with timestamp and metadata", () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      logger.log("info", "Test message", { key: "value" });

      expect(logger.logs).toHaveLength(1);
      expect(logger.logs[0]).toMatchObject({
        level: "info",
        jobType: "test-job",
        message: "Test message",
        key: "value",
      });
      expect(logger.logs[0].timestamp).toBeDefined();

      consoleSpy.mockRestore();
    });

    it("should log error level to console", () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      logger.log("error", "Error message");

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("should log warn level to console", () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();

      logger.log("warn", "Warning message");

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("convenience methods", () => {
    it("should have info method", () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();
      logger.info("Info message");
      expect(logger.logs[0].level).toBe("info");
      consoleSpy.mockRestore();
    });

    it("should have warn method", () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();
      logger.warn("Warning message");
      expect(logger.logs[0].level).toBe("warn");
      consoleSpy.mockRestore();
    });

    it("should have error method", () => {
      const consoleSpy = jest.spyOn(console, "log").mockImplementation();
      logger.error("Error message");
      expect(logger.logs[0].level).toBe("error");
      consoleSpy.mockRestore();
    });
  });

  describe("getFormattedLogs", () => {
    it("should return formatted log string", () => {
      logger.info("Message 1");
      logger.error("Message 2", { error: "test" });

      const formatted = logger.getFormattedLogs();
      expect(formatted).toContain("Message 1");
      expect(formatted).toContain("Message 2");
      expect(formatted).toContain('error="test"');
    });
  });

  describe("getLogs", () => {
    it("should return copy of logs array", () => {
      logger.info("Test");
      const logs = logger.getLogs();
      expect(logs).toHaveLength(1);
      expect(logs).not.toBe(logger.logs); // Should be a copy
    });
  });

  describe("clear", () => {
    it("should clear all logs", () => {
      logger.info("Test");
      expect(logger.logs).toHaveLength(1);
      logger.clear();
      expect(logger.logs).toHaveLength(0);
    });
  });
});
