import { chromium, type FullConfig } from "@playwright/test";

// Vercel "shareable link" (a temporary token, valid ~23h, no repository setting changed): opening it once sets the access cookie, which every test then reuses.
// CLOUD_SHARE is the token only (the value after `_vercel_share=`). Without it nothing happens (an unprotected deployment, or VERCEL_BYPASS header).
export default async function setup(config: FullConfig) {
  const token = process.env.CLOUD_SHARE;
  if (!token) return;
  const browser = await chromium.launch(config.projects[0].use.launchOptions);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${process.env.CLOUD_URL}/?_vercel_share=${encodeURIComponent(token)}`);
  await ctx.storageState({ path: "test-results/cloud-share-state.json" });
  await browser.close();
}
