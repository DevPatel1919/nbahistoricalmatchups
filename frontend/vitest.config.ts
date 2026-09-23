import { defineConfig } from "vitest/config";

// Unit tests only. Playwright owns tests/e2e and runs against a dev server.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
  },
});
