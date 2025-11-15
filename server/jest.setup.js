/**
 * Jest setup file
 * Runs before all tests to configure the test environment
 */

// Set NODE_ENV to test
process.env.NODE_ENV = "test";

// Set DATA_DIR to a temporary directory for tests
process.env.DATA_DIR = process.env.DATA_DIR || require("os").tmpdir() + "/docked-test-data";

// Set LOGS_DIR to a temporary directory for tests
process.env.LOGS_DIR = process.env.LOGS_DIR || require("os").tmpdir() + "/docked-test-logs";

// Disable console logging during tests to reduce noise
process.env.DISABLE_CONSOLE_LOGGING = "true";

// Clean up timers after all tests
afterAll(() => {
  // Clear any pending timers from logger
  if (global.__loggerInitTimer) {
    clearTimeout(global.__loggerInitTimer);
  }
  if (global.__loggerUpdateTimer) {
    clearInterval(global.__loggerUpdateTimer);
  }
  // Clear any pending timers
  jest.clearAllTimers();
  jest.useRealTimers();
});
