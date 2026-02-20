/**
 * ESLint 9 flat config (replaces package.json "eslintConfig" / react-app).
 * Aligned with Create React App's react-app config: mostly "warn", no prop-types/display-name.
 * @see https://eslint.org/docs/latest/use/configure/migration-guide
 */

import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";

export default [
  { ignores: ["build/**", "node_modules/**", "public/**", "**/*.module.css"] },
  js.configs.recommended,
  // Vitest and Node globals for tests and mocks
  {
    files: ["**/__tests__/**", "**/__mocks__/**", "**/*.test.js", "**/*.test.jsx"],
    languageOptions: {
      globals: {
        ...globals.jest,
        ...globals.node,
        vi: "readonly",
      },
    },
  },
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
        // Injected by CRA/webpack or used in code
        process: "readonly",
        Buffer: "readonly",
      },
    },
    rules: {
      // Match react-app: prefer warn, not error
      "no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", args: "none", ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ["**/*.js", "**/*.jsx"],
    plugins: {
      react,
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
    },
    settings: {
      react: {
        version: "detect",
      },
    },
    rules: {
      // Same rule set as react-app; avoid full "recommended" which adds prop-types/display-name
      ...react.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      // CRA did not enable these (causes many new errors)
      "react/prop-types": "off",
      "react/display-name": "off",
      // Downgrade to warn to match react-app
      "react/jsx-no-target-blank": "warn",
      "react/no-danger-with-children": "warn",
      "react/no-direct-mutation-state": "warn",
      "react/no-typos": "warn",
      "react/require-render-return": "warn",
      "react/style-prop-object": "warn",
      // CRA did not enable these; react-hooks v7 and strict jsx-a11y add many errors
      "react/no-unescaped-entities": "warn",
      "jsx-a11y/click-events-have-key-events": "off",
      "jsx-a11y/no-static-element-interactions": "off",
      "jsx-a11y/label-has-associated-control": "off",
      "jsx-a11y/no-autofocus": "off",
      "jsx-a11y/no-noninteractive-element-interactions": "off",
    },
  },
  // react-hooks flat config (ESLint 9 compatible; v7+)
  ...(reactHooks.configs?.flat?.recommended ? [reactHooks.configs.flat.recommended] : []),
  // Override react-hooks v7 rules that CRA never had (set-state-in-effect, purity)
  {
    files: ["**/*.js", "**/*.jsx"],
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "react-hooks/static-components": "off",
      "no-useless-catch": "warn",
    },
  },
];
