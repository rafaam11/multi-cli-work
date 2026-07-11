import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  preserveOutput: "always",
  reporter: "list",
  use: {
    trace: "retain-on-failure",
  },
});
