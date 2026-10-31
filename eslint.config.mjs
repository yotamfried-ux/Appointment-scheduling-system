import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Guardrails come from docs/05-security-architecture.md:
//  - 5.1: the secret-key DB module (platform/system-db) must never be reachable
//    from owner-facing UI/DAL code or client components.
//  - 5.5: no raw HTML injection.
const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "react/no-danger": "error",
      "react-hooks/set-state-in-effect": "warn",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/platform/system-db", "**/platform/system-db/*"],
              message:
                "system-db uses the secret key and bypasses RLS. Only jobs, webhooks and the public booking module may import it (docs/05 §5.1).",
            },
          ],
        },
      ],
    },
  },
  {
    // JSON-LD structured schema for search engines
    files: ["app/layout.tsx", "app/book/**"],
    rules: { "react/no-danger": "off" },
  },
  {
    // The only places allowed to use the secret-key module or any in tests.
    files: [
      "platform/**",
      "app/api/jobs/{maintenance,monitor,outbox,reminders,waitlist}/route.ts",
      "app/api/webhooks/resend/route.ts",
      "modules/billing/system.ts",
      "modules/booking/public/{rate-limit,service}.ts",
      "modules/notifications/{job-health,monitor,service}.ts",
      "modules/waitlist/public.ts",
      "tests/**",
    ],
    rules: {
      "no-restricted-imports": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "scripts/**",
  ]),
]);

export default eslintConfig;
