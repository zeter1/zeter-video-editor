import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  reporter: [["list"]],
  use: {
    // A missing UI action must fail with its locator, not consume a 4-5 minute test budget.
    // Explicit 90-second candidate-analysis assertions keep their own timeout.
    actionTimeout: 45_000,
    trace: "retain-on-failure",
  },
});
