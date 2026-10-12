import type { MetadataRoute } from "next";

// Search engines may read the public pages (home, legal, accessibility); everything that is a person's own page or a working surface is off limits.
// Booking and manage pages are additionally marked noindex in their metadata, which is the stronger signal.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/", "/privacy", "/terms", "/cookies", "/accessibility"], disallow: ["/api/", "/auth/", "/dashboard", "/customers", "/reports", "/settings", "/legal/", "/billing", "/booking/", "/waitlist/", "/onboarding"] }],
  };
}
