import { expect, test } from "@playwright/test";
import { loginAs, makeBusiness } from "./helpers/business";

// Round trips to the database/auth server per owner request (the API reports them in Server-Timing outside production). A silent fallback to a slower query path once added a call to every owner request unnoticed (the joined membership read was missing a column; the fallback hid it, and cost one extra round trip on every owner page and API call). With the fallback in use this reads 5.
test("the owner context costs one read: /api/owner/version makes exactly four database calls (context 1 + the three version reads)", async ({ page }) => {
  const c = await makeBusiness("barber");
  await loginAs(page, c.ownerEmail);
  await page.request.get("/api/owner/version"); // warm-up
  const r = await page.request.get("/api/owner/version");
  expect(r.status()).toBe(200);
  const timing = r.headers()["server-timing"] ?? "";
  expect(timing).toMatch(/db;dur=[\d.]+;desc="4 calls"/);
});
