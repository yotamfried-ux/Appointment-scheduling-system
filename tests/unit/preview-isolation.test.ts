import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { isPreviewEnvironment, isPreviewWithoutDb, PROD_SUPABASE_REF } from "@/lib/preview-isolation";
import { createClient } from "@/lib/supabase/server";
import { systemDb } from "@/platform/system-db";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

describe("Preview Isolation & Protection", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("isPreviewEnvironment", () => {
    it("returns true when VERCEL_ENV is 'preview'", () => {
      process.env.VERCEL_ENV = "preview";
      expect(isPreviewEnvironment()).toBe(true);
    });

    it("returns false in production or local environments", () => {
      process.env.VERCEL_ENV = "production";
      expect(isPreviewEnvironment()).toBe(false);

      delete process.env.VERCEL_ENV;
      expect(isPreviewEnvironment()).toBe(false);
    });
  });

  describe("isPreviewWithoutDb", () => {
    it("returns false in production even with production Supabase URL", () => {
      process.env.VERCEL_ENV = "production";
      process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${PROD_SUPABASE_REF}.supabase.co`;
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_pub_prod";
      expect(isPreviewWithoutDb()).toBe(false);
    });

    it("returns false in local development / CI", () => {
      delete process.env.VERCEL_ENV;
      process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54321";
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_pub_local";
      expect(isPreviewWithoutDb()).toBe(false);
    });

    it("returns true in preview when Supabase URL or Key is missing", () => {
      process.env.VERCEL_ENV = "preview";
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      expect(isPreviewWithoutDb()).toBe(true);

      process.env.NEXT_PUBLIC_SUPABASE_URL = "";
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "";
      expect(isPreviewWithoutDb()).toBe(true);
    });

    it("strictly blocks connecting to the Production database ref from Preview", () => {
      process.env.VERCEL_ENV = "preview";
      process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${PROD_SUPABASE_REF}.supabase.co`;
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_pub_prod";

      // Even though variables are provided, pointing to production from preview is forbidden!
      expect(isPreviewWithoutDb()).toBe(true);
    });

    it("detects placeholder and invalid dummy URLs in preview", () => {
      process.env.VERCEL_ENV = "preview";
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://preview-isolated.local";
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "dummy_key";
      expect(isPreviewWithoutDb()).toBe(true);
    });

    it("allows a legitimate dedicated staging DB if configured in preview", () => {
      process.env.VERCEL_ENV = "preview";
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://separate-staging-project.supabase.co";
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_pub_staging_valid";
      expect(isPreviewWithoutDb()).toBe(false);
    });
  });

  describe("Fail-closed clients in isolated Preview", () => {
    it("createClient throws closed when called in preview without DB", async () => {
      process.env.VERCEL_ENV = "preview";
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

      await expect(createClient()).rejects.toThrow("Supabase is disabled in this Preview environment");
    });

    it("systemDb throws closed when called in preview without DB", () => {
      process.env.VERCEL_ENV = "preview";
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.SUPABASE_SECRET_KEY;

      expect(() => systemDb()).toThrow("system-db is disabled in Preview environment");
    });
  });

  describe("Middleware proxy gating in isolated Preview", () => {
    beforeEach(() => {
      process.env.VERCEL_ENV = "preview";
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    });

    it("allows /api/health to succeed for liveness checks", async () => {
      const req = new NextRequest("https://preview.vercel.app/api/health");
      const res = await proxy(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.status).toBe("ok");
      expect(json.environment).toBe("preview-isolated");
    });

    it("returns 503 on /api/ready signaling DB is unavailable", async () => {
      const req = new NextRequest("https://preview.vercel.app/api/ready");
      const res = await proxy(req);

      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.status).toBe("unavailable");
      expect(json.reason).toBe("preview_isolated_no_database");
    });

    it("blocks business/data API routes with 503 and no leaked info", async () => {
      const req = new NextRequest("https://preview.vercel.app/api/owner/appointments");
      const res = await proxy(req);

      expect(res.status).toBe(503);
      const json = await res.json();
      expect(json.error).toBe("preview_database_unavailable");
      expect(json.message).toContain("סביבת Preview זו מבודדת");
    });

    it("rewrites page requests to /preview-mode", async () => {
      const req = new NextRequest("https://preview.vercel.app/dashboard");
      const res = await proxy(req);

      // In Next.js middleware, rewrite sets x-middleware-rewrite header
      const rewriteHeader = res.headers.get("x-middleware-rewrite");
      expect(rewriteHeader).toContain("/preview-mode");
    });

    it("allows static informational legal pages through", async () => {
      const req = new NextRequest("https://preview.vercel.app/privacy");
      const res = await proxy(req);

      // Does not rewrite to preview-mode
      expect(res.headers.get("x-middleware-rewrite")).toBeNull();
      // Sets CSP without Supabase connection permissions
      const csp = res.headers.get("content-security-policy");
      expect(csp).toBeDefined();
      expect(csp).not.toContain("supabase.co");
    });
  });
});
