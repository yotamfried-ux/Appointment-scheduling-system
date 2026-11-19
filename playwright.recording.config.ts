import { defineConfig } from "@playwright/test";

const baseURL = "http://127.0.0.1:3175";

export default defineConfig({
  testDir: "tests/recording",
  workers: 1,
  reporter: "list",
  timeout: 180_000,
  outputDir: process.env.TORI_CAPTURE_DIR + "/playwright",
  use: { baseURL, actionTimeout: 12_000, navigationTimeout: 20_000 },
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3175",
    url: baseURL + "/api/health",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
