import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import { masterRules, testOverrides } from "../eslint-rules.cjs";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: false,
        project: [
          "tsconfig.json",
          "tsconfig.test.json",
          "packages/core/tsconfig.json",
          "packages/local/tsconfig.json",
          "packages/local/tsconfig.test.json",
          "packages/cloud-proxy/tsconfig.json",
          "packages/cloud-proxy/tsconfig.test.json",
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      ...masterRules,
      // Project-specific: allow console.error in server code
      "no-console": ["error", { allow: ["error"] }],
      // Project-specific: server code has more params in tool handlers
      "no-magic-numbers": ["error", { ignore: [0, 1, 2, 3, 4, 5, 100, 200, 400, 404, 500], ignoreArrayIndexes: true }],
      // Project-specific: undefined is idiomatic in TypeScript
      "no-undefined": "off",
      // Project-specific: strict key ordering is impractical for config/schema objects
      "sort-keys": "off",
      // Project-specific: import order managed by convention
      "sort-imports": "off",
      // Project-specific: inline comments acceptable in source
      "no-inline-comments": "off",
      // Project-specific: comment casing not enforced
      "capitalized-comments": "off",
      // Project-specific: concise arrow bodies allowed
      "arrow-body-style": "off",
    },
  },
  {
    files: ["test/**/*.ts", "packages/**/test/**/*.ts"],
    rules: testOverrides,
  },
  {
    ignores: [
      "build/**",
      "node_modules/**",
      "coverage/**",
      "eslint.config.js",
      "lib/**",
      "packages/**/build/**",
      "packages/**/coverage/**",
      "packages/**/node_modules/**",
    ],
  },
);
