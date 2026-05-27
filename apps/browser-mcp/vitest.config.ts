import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 45_000,
    reporters: ["default"],
    pool: "forks",
    // Each integration file launches its own headless Chromium. Without a cap,
    // an 8+ core machine runs too many in parallel; the contention makes
    // Chromium launch/close (in before/afterAll) exceed the hook timeout. Cap
    // concurrent workers so browser start/stop stays fast and reliable (also
    // steadier on CI). Vitest 4 renamed poolOptions.forks.maxForks → top-level
    // maxWorkers (minForks was dropped; 1 is the floor regardless).
    maxWorkers: 4,
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
