// @ts-check
const js = require("@eslint/js");
const tseslint = require("typescript-eslint");

module.exports = tseslint.config(
  {
    ignores: ["out/**", "node_modules/**", "*.vsix", "coverage/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      // D10: `any` is permitted at HTTP body / JSON-Schema boundaries.
      // Reviewers grep for `: any` in PRs to keep it scoped.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Prefer-const is fine; let-not-mutated is noisy in state machines.
      "prefer-const": "warn",
    },
  },
  {
    // Tests have a bit more flexibility around casts and unused imports
    // than production code; keep them out of the strictest rules.
    files: ["src/__tests__/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    // The webview script runs in a browser-like context inside VS Code's
    // webview, with acquireVsCodeApi() injected. Browser globals apply.
    files: ["src/ui/media/**/*.js"],
    languageOptions: {
      globals: {
        document: "readonly",
        window: "readonly",
        navigator: "readonly",
        acquireVsCodeApi: "readonly",
      },
    },
  },
);
