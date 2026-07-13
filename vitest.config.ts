import { defineConfig } from "vitest/config";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the "@/..." path alias (from tsconfig) for tests. The regex only matches
// imports that start with "@/", so scoped packages like "@anthropic-ai/sdk" are untouched.
const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: `${root}/` }],
  },
});
