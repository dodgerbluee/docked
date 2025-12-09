/**
 * ESLint Configuration (Flat Config Format)
 * Comprehensive code quality and security scanning
 *
 * This configuration enforces:
 * - Code quality and best practices
 * - Security best practices
 * - Consistent code style
 * - Performance optimizations
 * - Proper error handling
 * - Async/await best practices
 */

module.exports = [
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        // Node.js globals
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        module: "readonly",
        require: "readonly",
        exports: "readonly",
        global: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
        setImmediate: "readonly",
        // Browser/Web API globals
        URL: "readonly",
        // Jest globals
        jest: "readonly",
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
      },
    },
    rules: {
      // ============================================
      // Code Quality & Best Practices
      // ============================================

      // Enforce const by default
      "prefer-const": "error",
      "no-var": "error",
      "prefer-arrow-callback": "warn",
      "prefer-template": "warn",
      "prefer-spread": "warn",
      "prefer-rest-params": "warn",

      // Function length and complexity
      "max-lines-per-function": ["warn", { max: 50, skipBlankLines: true, skipComments: true }],
      "max-lines": ["warn", { max: 500, skipBlankLines: true, skipComments: true }],
      complexity: ["warn", 10],
      "max-depth": ["warn", 4],
      "max-nested-callbacks": ["warn", 4],
      "max-params": ["warn", 5],

      // Error handling
      "no-throw-literal": "error",
      "prefer-promise-reject-errors": "error",
      "no-return-await": "error", // Use return instead of return await
      "require-await": "off", // Disabled: 54 occurrences - common pattern for promise wrappers

      // Async/await best practices
      "no-async-promise-executor": "error",
      "no-await-in-loop": "off", // Disabled: 89 occurrences - legitimate sequential operations
      "no-promise-executor-return": "error",

      // Best practices
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-debugger": "error",
      "no-alert": "error",
      "no-else-return": "warn",
      "no-empty-function": "warn",
      "no-implicit-coercion": "warn",
      "no-implied-eval": "error",
      "no-lone-blocks": "error",
      "no-multi-assign": "error",
      "no-new": "warn",
      "no-new-wrappers": "error",
      "no-param-reassign": "off", // Disabled: 6 occurrences - Express middleware pattern (req.user, res.json)
      "no-proto": "error",
      "no-return-assign": "error",
      "no-self-compare": "error",
      "no-sequences": "error",
      "no-unmodified-loop-condition": "warn",
      "no-unused-expressions": "error",
      "no-useless-call": "error",
      "no-useless-concat": "error",
      "no-useless-return": "warn",
      "no-void": "error",
      "prefer-named-capture-group": "warn",
      "prefer-regex-literals": "warn",
      radix: "error",
      "require-atomic-updates": "warn",
      yoda: "error",

      // ============================================
      // Unused Code Detection
      // ============================================
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          args: "after-used",
        },
      ],
      "no-unreachable": "error",
      "no-unreachable-loop": "warn",

      // ============================================
      // Code Style & Formatting
      // ============================================
      semi: ["error", "always"],
      quotes: ["error", "double", { avoidEscape: true, allowTemplateLiterals: true }],
      "comma-dangle": ["error", "always-multiline"],
      indent: ["error", 2, { SwitchCase: 1 }],
      "eol-last": ["error", "always"],
      "no-trailing-spaces": "error",
      "object-curly-spacing": ["error", "always"],
      "array-bracket-spacing": ["error", "never"],
      "comma-spacing": ["error", { before: false, after: true }],
      "comma-style": ["error", "last"],
      "key-spacing": ["error", { beforeColon: false, afterColon: true }],
      "keyword-spacing": ["error", { before: true, after: true }],
      "no-multiple-empty-lines": ["error", { max: 2, maxEOF: 1, maxBOF: 0 }],
      "no-whitespace-before-property": "error",
      "space-before-blocks": "error",
      "space-before-function-paren": [
        "error",
        { anonymous: "always", named: "never", asyncArrow: "always" },
      ],
      "space-in-parens": ["error", "never"],
      "space-infix-ops": "error",
      "space-unary-ops": ["error", { words: true, nonwords: false }],
      "spaced-comment": ["error", "always", { exceptions: ["-", "+"], markers: ["/"] }],
      "brace-style": ["error", "1tbs", { allowSingleLine: true }],
      camelcase: "off", // Disabled: 174 occurrences - database column names use snake_case (external schema)
      "new-cap": ["error", { newIsCap: true, capIsNew: false }],
      "no-array-constructor": "error",
      "no-new-object": "error",
      "one-var": ["error", "never"],
      "operator-linebreak": ["error", "after", { overrides: { "?": "before", ":": "before" } }],
      "padded-blocks": ["error", "never"],

      // ============================================
      // Security
      // ============================================
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-script-url": "error",
      "no-caller": "error",

      // ============================================
      // Performance & Optimization
      // ============================================
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-inner-declarations": "error",
      "no-loop-func": "warn",
      "no-redeclare": "error",
      "no-shadow": ["warn", { builtinGlobals: false, hoist: "functions" }],
      "no-shadow-restricted-names": "error",
      "no-undef": "error",
      "no-undef-init": "warn",
      "no-undefined": "off", // Allow undefined as it's a valid value
      "no-use-before-define": ["error", { functions: false, classes: true, variables: true }],

      // ============================================
      // Node.js Specific
      // ============================================
      "no-process-exit": "warn", // Keep as warn, disable in scripts override
      "no-sync": "off", // Disabled: 60 occurrences - necessary for setup/initialization code

      // ============================================
      // ES6+ Features
      // ============================================
      "arrow-body-style": ["warn", "as-needed"],
      "arrow-parens": ["error", "as-needed"],
      "arrow-spacing": ["error", { before: true, after: true }],
      "no-confusing-arrow": ["error", { allowParens: true }],
      "no-duplicate-imports": "error",
      "no-useless-computed-key": "error",
      "no-useless-constructor": "error",
      "no-useless-rename": "error",
      "object-shorthand": ["warn", "always"],
      "prefer-destructuring": "off", // Disabled: 17 occurrences - often less readable than direct access
      "prefer-numeric-literals": "error",
      "prefer-object-spread": "warn",
      "rest-spread-spacing": ["error", "never"],
      "symbol-description": "error",
      "template-curly-spacing": ["error", "never"],
      "yield-star-spacing": ["error", "after"],

      // ============================================
      // Potential Bugs
      // ============================================
      "array-callback-return": ["error", { allowImplicit: true }],
      "consistent-return": "off", // Disabled: 107 occurrences - Express middleware pattern, error handling
      "default-case": "warn",
      "default-case-last": "error",
      "dot-notation": "warn",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-case-declarations": "error",
      "no-div-regex": "error",
      "no-empty-pattern": "error",
      "no-extend-native": "error",
      "no-extra-bind": "error",
      "no-extra-label": "error",
      "no-fallthrough": "error",
      "no-floating-decimal": "error",
      "no-global-assign": "error",
      "no-iterator": "error",
      "no-labels": "error",
      "no-magic-numbers": "off", // Too strict for this codebase
      "no-octal": "error",
      "no-octal-escape": "error",
      "no-regex-spaces": "error",
      "no-restricted-properties": "off", // Can be enabled for specific cases
      "no-self-assign": "error",
      "no-underscore-dangle": "off", // Allow _ prefix for unused vars
      "no-unneeded-ternary": "warn",
      "no-useless-escape": "error",
      "no-warning-comments": [
        "warn",
        { terms: ["todo", "fixme", "xxx", "hack"], location: "start" },
      ],
      "prefer-exponentiation-operator": "error",
      "prefer-object-has-own": "error",
      "wrap-iife": ["error", "inside"],
    },
  },
  // Test files - more lenient rules
  {
    files: ["**/__tests__/**/*.js", "**/*.test.js"],
    rules: {
      "max-lines-per-function": "off",
      "max-lines": "off",
      "no-magic-numbers": "off",
      "require-await": "off", // Mock implementations don't need await
    },
  },
  // Script files - allow process.exit and console
  {
    files: ["**/scripts/**/*.js"],
    rules: {
      "no-process-exit": "off", // Scripts need to exit
      "no-console": "off", // Script output
    },
  },
  // Migration files - allow more flexibility
  {
    files: ["**/migrations/**/*.js"],
    rules: {
      "max-lines-per-function": "off",
      "no-magic-numbers": "off",
    },
  },
  // Config files - allow more flexibility
  {
    files: ["**/config/**/*.js"],
    rules: {
      "no-magic-numbers": "off",
    },
  },
];
