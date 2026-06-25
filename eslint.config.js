import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";

/**
 * Core boundary modules that must remain Ink-free.
 * These directories contain pure data logic and must never import
 * from Ink or React (the presentation layer).
 *
 * W1: src/utils added — error handler and output router are core utilities
 * that must not pull in Ink/React, keeping the agent path clean (REQ-2).
 */
const INK_FREE_CORE_DIRS = [
  "src/client",
  "src/queries",
  "src/types",
  "src/mapping",
  "src/health",
  "src/utils",
];

const restrictedZones = INK_FREE_CORE_DIRS.map((dir) => ({
  target: dir,
  from: ["node_modules/ink", "node_modules/react", "src/renderers/ink"],
  message:
    "Ink-free boundary violation: core modules (client, queries, types, mapping, health) must NOT import Ink or React.",
}));

export default [
  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    plugins: {
      "@typescript-eslint": tseslint,
      import: importPlugin,
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    rules: {
      // Ink-free core boundary enforcement (REQ-2)
      "import/no-restricted-paths": [
        "error",
        {
          zones: restrictedZones,
        },
      ],

      // TypeScript recommended rules (subset)
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
];
