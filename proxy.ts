import { type NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { buildCsp, generateNonce } from "@/lib/security/csp";
import { isPreviewWithoutDb } from "@/lib/preview-isolation";

// Static informational pages allowed in Preview without a database
const PREVIEW_STATIC_ALLOWED_PREFIXES = [
  "/preview-mode",
  "/privacy",
  "/terms",
  "/cookies",
  "/accessibility",
  "/robots.txt",
  "/sitemap.xml",
  "/opengraph-image",
];

export async function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const pathname = request.nextUrl.pathname;

  // Centralized Fail-Closed Preview Isolation:
  // When running in Vercel Preview without an authorized isolated DB, block all DB access
  if (isPreviewWithoutDb()) {
    // 1. Health checks: liveness passes, readiness reports unavailable
    if (pathname === "/api/health") {
      return NextResponse.json(
        { status: "ok", environment: "preview-isolated" },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
    if (pathname === "/api/ready") {
      return NextResponse.json(
        { status: "unavailable", reason: "preview_isolated_no_database" },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }

    // 2. All other API routes fail closed with 503 (no DB access, no secrets, no production leakage)
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        {
          error: "preview_database_unavailable",
          message: "סביבת Preview זו מבודדת ואינה מחוברת למסד נתונים. פעולות מערכת אינן זמינות בסביבה זו.",
        },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }

    // 3. Static public informational pages are allowed to render normally
    const isAllowedStatic = PREVIEW_STATIC_ALLOWED_PREFIXES.some(
      (p) => pathname === p || pathname.startsWith(`${p}/`)
    );

    const csp = buildCsp({
      nonce,
      isDev: false,
      supabaseUrl: undefined, // Never connect to external DB in isolated preview
    });

    if (isAllowedStatic) {
      const response = NextResponse.next({ request });
      response.headers.set("x-nonce", nonce);
      response.headers.set("x-pathname", pathname);
      response.headers.set("content-security-policy", csp);
      return response;
    }

    // 4. Any other page (/, /dashboard, /book, /auth, etc.) rewrites to the dedicated Preview Notice screen
    const previewUrl = request.nextUrl.clone();
    previewUrl.pathname = "/preview-mode";
    const response = NextResponse.rewrite(previewUrl, { request });
    response.headers.set("x-nonce", nonce);
    response.headers.set("x-pathname", "/preview-mode");
    response.headers.set("content-security-policy", csp);
    return response;
  }

  // Standard Production / Development flow:
  const csp = buildCsp({
    nonce,
    isDev: process.env.NODE_ENV === "development",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });

  // The CSP + nonce must be on the *request* too so Next.js can stamp the nonce
  // onto its own scripts during rendering.
  request.headers.set("x-nonce", nonce);
  request.headers.set("x-pathname", pathname);
  request.headers.set("content-security-policy", csp);

  const response = await updateSession(request);
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
