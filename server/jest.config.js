module.exports = {
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.js"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  collectCoverageFrom: [
    "**/*.js",
    "!**/node_modules/**",
    "!**/__tests__/**",
    "!jest.config.js",
    "!jest.setup.js",
  ],
  coverageThreshold: {
    global: {
      branches: 8,
      functions: 19,
      lines: 14,
      statements: 14,
    },
  },
};
