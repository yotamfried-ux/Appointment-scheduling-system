import "server-only";
import { headers } from "next/headers";

/** The address people really use to reach this deployment (shown to owners as their booking link). Configured address first, otherwise the host this very request came to; never a placeholder. */
export async function siteHost(): Promise<string> {
  for (const v of [process.env.APP_URL, process.env.NEXT_PUBLIC_SITE_URL]) {
    try {
      if (v) return new URL(v).host;
    } catch {
      /* a malformed value falls through to the request host */
    }
  }
  const h = await headers();
  return (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
}

export const bookingUrl = (host: string, slug: string) => `${/^(localhost|127\.|\[::1\])/.test(host) ? "http" : "https"}://${host}/book/${slug}`;
