/**
 * Jest setup file
 * Runs before all tests to configure the test environment
 */

// Mock jose to avoid ES module issues in tests (jose v6 is ESM-only)
jest.mock("jose", () => ({
  createRemoteJWKSet: jest.fn(() => jest.fn()),
  jwtVerify: jest.fn(),
}));

// Mock nanoid to avoid ES module issues in tests
jest.mock("nanoid", () => {
  const customAlphabet = (alphabet, size) => () => {
    let result = "";
    for (let i = 0; i < size; i++) {
      result += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return result;
  };
  return { customAlphabet };
});

// Set NODE_ENV to test
process.env.NODE_ENV = "test";

// Set DATA_DIR to a temporary directory for tests
process.env.DATA_DIR = process.env.DATA_DIR || `${require("os").tmpdir()}/docked-test-data`;

// Set LOGS_DIR to a temporary directory for tests
process.env.LOGS_DIR = process.env.LOGS_DIR || `${require("os").tmpdir()}/docked-test-logs`;

// Disable console logging during tests to reduce noise
process.env.DISABLE_CONSOLE_LOGGING = "true";

// Suppress dotenv messages in test mode
// This is done by setting quiet mode when dotenv is loaded
// The config/index.js file already uses { quiet: true }

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
