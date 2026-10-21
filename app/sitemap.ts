import type { MetadataRoute } from "next";
import { LEGAL } from "@/lib/legal/config";
import { appUrl } from "@/modules/notifications/config";

// Only what a search engine may index (the same set robots.ts allows); absolute canonical addresses of the configured site.
// A discovery hint, not a promise of indexing. Private pages, booking pages and tokens never appear here.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = appUrl();
  const date = (iso: string) => new Date(`${iso}T00:00:00Z`);
  return [
    { url: `${base}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${base}/privacy`, lastModified: date(LEGAL.privacy.version), changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/terms`, lastModified: date(LEGAL.terms.version), changeFrequency: "yearly", priority: 0.3 },
    { url: `${base}/cookies`, lastModified: date(LEGAL.cookies.version), changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/accessibility`, lastModified: date(LEGAL.accessibility.version), changeFrequency: "yearly", priority: 0.2 },
  ];
}
