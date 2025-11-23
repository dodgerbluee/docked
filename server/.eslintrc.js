/**
 * ESLint Configuration
 * Enforces code quality and consistency
 */

module.exports = {
  env: {
    node: true,
    es2022: true,
    jest: true,
  },
  extends: ["eslint:recommended"],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
  rules: {
    // Enforce const by default
    "prefer-const": "error",
    "no-var": "error",

    // Function length and complexity
    "max-lines-per-function": [
      "warn",
      { max: 50, skipBlankLines: true, skipComments: true },
    ],
    complexity: ["warn", 10],

    // Error handling
    "no-throw-literal": "error",
    "prefer-promise-reject-errors": "error",

    // Async/await
    "no-async-promise-executor": "error",
    "require-await": "warn",

    // Best practices
    "no-console": ["warn", { allow: ["warn", "error"] }],
    "no-debugger": "error",
    "no-unused-vars": [
      "error",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
      },
    ],

    // Code style
    semi: ["error", "always"],
    quotes: ["error", "double"],
    "comma-dangle": ["error", "always-multiline"],
    indent: ["error", 2],
    "eol-last": ["error", "always"],
    "no-trailing-spaces": "error",
    "object-curly-spacing": ["error", "always"],
    "array-bracket-spacing": ["error", "never"],

    // Security
    "no-eval": "error",
    "no-implied-eval": "error",
    "no-new-func": "error",
  },
};
