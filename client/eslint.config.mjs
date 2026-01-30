/**
 * ESLint 9 flat config (replaces package.json "eslintConfig" / react-app).
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
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...globals.browser,
      },
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
      ...react.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
    },
  },
  // react-hooks flat config (ESLint 9 compatible; v7+)
  ...(reactHooks.configs?.flat?.recommended ? [reactHooks.configs.flat.recommended] : []),
];
