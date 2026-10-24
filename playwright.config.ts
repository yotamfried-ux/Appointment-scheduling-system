import { defineConfig, devices } from "@playwright/test";
import { acceptedStorageState } from "./tests/e2e/helpers/terms";
import { BILLING_WEBHOOK_SECRET, CRON_SECRET, RESEND_WEBHOOK_SECRET } from "./tests/e2e/helpers/secrets";

const PORT = Number(process.env.PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

// Placeholder Supabase values: the stage-0 pages never reach the network when
// there is no session cookie. Real-DB journeys run against a Supabase branch (later stages).
const env = {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_e2e_placeholder",
  SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY ?? "",
  BOOKING_TOKEN_SECRET: process.env.BOOKING_TOKEN_SECRET ?? "e2e-booking-token-secret-0123456789abcdef",
  ALLOW_NON_PRODUCTION_DEFAULTS: "1", // the E2E server is a production build; this opts out of the production-like lockdown (check:env refuses it in production)
  ALLOW_TEST_LIMIT_HEADER: "1", // lets E2E lower rate limits per request; ignored when VERCEL_ENV=production
  CRON_SECRET,
  RESEND_WEBHOOK_SECRET,
  ALLOW_TEST_LEGAL_GATE: "1", // lets one test switch the terms gate on for its own requests; ignored when VERCEL_ENV=production
  BILLING_PROVIDER: "fake", // the plug-in provider used in CI; a real one is another adapter
  BILLING_WEBHOOK_SECRET,
  EMAIL_PROVIDER: "fake", // nothing leaves the machine; failures are injected through the recipient address
  OUTBOX_KICK: "0", // specs trigger the runner explicitly so attempt counts are deterministic
  ALLOW_TEST_CLOCK: "1", // lets the reminder job take ?now=; refused when VERCEL_ENV=production
  PORT: String(PORT),
};

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0, // a retry-pass is reported FLAKY, never silently green
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    // Every browser starts as one that already accepted the current terms (the booking form shows no box); specs about the box start empty with test.use({ storageState: { cookies: [], origins: [] } }).
    storageState: acceptedStorageState(new URL(baseURL).origin), trace: "retain-on-failure", screenshot: "only-on-failure", locale: "he-IL", timezoneId: "Asia/Jerusalem",
    // optional: run against an already-installed Chromium (offline machines); CI installs the matching browser itself
    ...(process.env.E2E_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.E2E_CHROMIUM_PATH } } : {}),
  },
  projects: [
    { name: "mobile-360", testIgnore: /journeys\//, use: { ...devices["Pixel 5"], viewport: { width: 360, height: 740 } } },
    { name: "desktop", testIgnore: /journeys\//, use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    // User-journey simulations: each test brings its own browsers (an owner at a desk, customers on phones), so one project is enough.
    { name: "journeys", testMatch: /journeys\/.*\.spec\.ts/, fullyParallel: false, use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run start -- --keepAliveTimeout 65000", // the test client reuses connections; Node closes idle ones after 5 s by default, which showed up as ECONNRESET / "socket hang up" in otherwise passing tests
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env,
      },
});
