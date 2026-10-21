import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clientNamespacesFor, pickNamespaces } from "@/i18n/client-messages";
import he from "../../messages/he.json";

// A page that ships only some message namespaces must not contain a client component that reads another one (it would show a raw key like "booking.day.title").
const ROOT = join(__dirname, "../..");
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx$/.test(n) ? [p] : [];
  });
const namespacesRead = (file: string): string[] => {
  const src = readFileSync(file, "utf8");
  if (!/^["']use client["']/m.test(src)) return [];
  const out = [...src.matchAll(/useTranslations\(\s*(?:"([^"]*)")?\s*\)/g)].map((m) => (m[1] === undefined ? "*" : m[1].split(".")[0]));
  if (/\buseFormatter\b|\buseMessages\b/.test(src)) out.push("*");
  return out;
};

const SHARED_FILES = ["components/legal/consent-banner.tsx", "components/theme-switcher.tsx", "components/logout-button.tsx", "app/error.tsx", "components/auth-button.tsx", "components/ui/toast.tsx", "components/brand/booking-preview.tsx"];
const GROUPS: Record<string, { path: string; files: string[] }> = {
  booking: { path: "/book/x", files: [...SHARED_FILES, ...walk(join(ROOT, "app/book")).map((f) => f.slice(ROOT.length + 1)), ...walk(join(ROOT, "components/lab/booking")).map((f) => f.slice(ROOT.length + 1)), ...walk(join(ROOT, "components/waitlist")).map((f) => f.slice(ROOT.length + 1))] },
};

describe("trimmed message catalogs cover what the page's client components read", () => {
  for (const [name, g] of Object.entries(GROUPS)) {
    it(`${name}: ${g.path}`, () => {
      const allowed = clientNamespacesFor(g.path)!;
      expect(allowed).not.toBeNull();
      for (const f of g.files) {
        for (const ns of namespacesRead(join(ROOT, f))) {
          expect(ns, `${f} reads the whole catalog`).not.toBe("*");
          expect(allowed, `${f} reads "${ns}" which is not shipped to ${g.path}`).toContain(ns);
        }
      }
    });
  }

  it("every listed namespace exists, and unknown paths keep everything", () => {
    for (const p of ["/book/x"]) for (const ns of clientNamespacesFor(p)!) expect(Object.keys(he), `${ns} in ${p}`).toContain(ns);
    for (const p of ["/", "/auth/login", "/auth/sign-up", "/dashboard", "/settings/team", "/customers", "/design", "/booking/abc", "/waitlist/abc", "/legal/accept"]) expect(clientNamespacesFor(p)).toBeNull();
    expect(pickNamespaces(he, null)).toBe(he);
  });

  it("the booking page ships far less than the whole catalog", () => {
    const size = (o: unknown) => JSON.stringify(o).length;
    expect(size(pickNamespaces(he, clientNamespacesFor("/book/x")))).toBeLessThan(size(he) / 2);
  });
});
