import { defineConfig, devices } from "@playwright/test";

// Simulation of real users against a DEPLOYED instance (the cloud test environment). No local server, no database access from the tests:
// everything goes through the browser, exactly as a customer or an owner would. CLOUD_URL is the deployment; the owner part runs only when
// CLOUD_OWNER_EMAIL and CLOUD_OWNER_PASSWORD are provided (GitHub secrets, never in a file).
const baseURL = process.env.CLOUD_URL;
if (!baseURL) throw new Error("CLOUD_URL is required (the address of the deployment to simulate against)");

export default defineConfig({
  testDir: "tests/cloud",
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 90_000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...(process.env.E2E_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.E2E_CHROMIUM_PATH } } : {}), // offline machines; CI installs its own browser
    extraHTTPHeaders: process.env.VERCEL_BYPASS ? { "x-vercel-protection-bypass": process.env.VERCEL_BYPASS } : {},
  },
  projects: [
    { name: "mobile-360", use: { ...devices["Pixel 5"], viewport: { width: 360, height: 740 } } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
});
