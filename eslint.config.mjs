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
    // The only places allowed to use the secret-key module.
    files: [
      "platform/**",
      "app/api/jobs/**",
      "app/api/webhooks/**",
      "app/api/public/**",
      "modules/booking/public/**",
      "tests/**",
    ],
    rules: { "no-restricted-imports": "off" },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "coverage/**", "playwright-report/**", "test-results/**"]),
]);

export default eslintConfig;
