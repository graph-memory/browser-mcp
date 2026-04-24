import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    reporters: ["default"],
    pool: "forks",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        // Bootstrap entrypoint: thin glue that only calls createApp + listen().
        // All substantive logic lives in app.ts which is tested directly.
        "src/index.ts",
      ],
      reporter: ["text", "html", "json-summary"],
      all: true,
      thresholds: {
        // Ceiling is bounded by Playwright: code inside `page.evaluate(() => …)`
        // runs in Chromium's V8, not Node's, so node-v8 coverage cannot see
        // those blocks even when the integration tests exercise them end-to-end.
        // These thresholds reflect the achievable ceiling with that constraint.
        lines: 90,
        functions: 85,
        branches: 80,
        statements: 90,
      },
    },
  },
});
