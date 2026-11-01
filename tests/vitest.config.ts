import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./global-setup.ts"],
    // Every test file uses the same database, and each test empties it first.
    fileParallelism: false,
  },
});
