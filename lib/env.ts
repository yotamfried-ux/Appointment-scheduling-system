/**
 * "Production-like" = a Vercel production deploy OR any `NODE_ENV=production` process (a self-hosted `next start`, a Docker image).
 * Every dev/test convenience (default secrets, the design lab, test headers, the fake billing provider) is off here, so forgetting
 * VERCEL_ENV can never switch one on. The E2E server runs a production build, so it opts out explicitly with ALLOW_NON_PRODUCTION_DEFAULTS=1;
 * `check:env` refuses that flag in a real production environment.
 */
export const isProductionLike = () => process.env.VERCEL_ENV === "production" || (process.env.NODE_ENV === "production" && process.env.ALLOW_NON_PRODUCTION_DEFAULTS !== "1");
