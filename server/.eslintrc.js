module.exports = {
  env: {
    node: true,
    es2021: true,
    jest: true,
  },
  extends: ["eslint:recommended"],
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: "module",
  },
  rules: {
    "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    "no-console": "off", // Allow console.log for server logging
    "no-undef": "warn", // Downgrade to warning for existing codebase
    "no-unreachable": "error",
    "no-var": "warn",
    "prefer-const": "warn",
    eqeqeq: ["warn", "always"],
    curly: ["warn", "all"], // Downgrade to warning for existing codebase
    "no-case-declarations": "warn", // Downgrade to warning
    "no-self-assign": "warn", // Downgrade to warning
    "no-useless-escape": "warn", // Downgrade to warning
  },
  ignorePatterns: ["node_modules/", "coverage/", "*.test.js", "jest.config.js", "jest.setup.js"],
};
