import { defineConfig, devices } from "@playwright/test";

/**
 * E2E proof for the self-hosted / fully-offline build (VITE_SELF_HOSTED=true):
 * boots the app in selfhosted mode and asserts ZERO external network requests
 * plus hidden cloud UI. Run with `npm run test:e2e:selfhosted`.
 */
export default defineConfig({
  testDir: "./e2e-selfhosted",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  outputDir: "./e2e-selfhosted/test-results",
  use: {
    // Distinct port so a normal dev server on 5173 is never mistakenly reused.
    baseURL: "http://localhost:5183",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // PowerShell-safe: a single command, no && chaining.
    command: "npm run dev:selfhosted -- --port 5183 --strictPort",
    url: "http://localhost:5183",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
