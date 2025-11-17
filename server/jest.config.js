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
  transformIgnorePatterns: [
    "node_modules/(?!(nanoid)/)",
  ],
};
