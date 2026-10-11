// Zod at the boundary (docs/05 §5.5). The browser never sends tenant ids or slugs: the slug is derived on the server
// from the name, and the tenant comes from the session (SEC-02).
import { z } from "zod";
import { suggestSlug, windowsValid } from "@/lib/lab/onboarding";
import { normalizePhone } from "@/lib/phone";
import { KIND_IDS } from "@/modules/tenancy/business-kind";

const HHmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const OnboardingServiceInput = z.object({
  name: z.string().trim().min(2).max(80),
  durationMinutes: z.number().int().min(5).max(480),
  priceNis: z.number().int().min(1).max(100_000),
});

export const OnboardingHoursInput = z
  .array(
    z.object({
      weekday: z.number().int().min(0).max(6),
      open: z.boolean(),
      windows: z.array(z.object({ from: HHmm, to: HHmm })).min(1).max(3),
    }),
  )
  .length(7)
  .refine((days) => days.some((d) => d.open) && days.filter((d) => d.open).every((d) => windowsValid(d.windows)), "invalid hours");

export const CreateBusinessInput = z
  .object({
    name: z.string().trim().min(2).max(80),
    kind: z.enum(KIND_IDS),
    phone: z.string().transform((v, ctx) => {
      const n = normalizePhone(v);
      if (!n) ctx.addIssue({ code: "custom", message: "invalid phone" });
      return n ?? "";
    }),
    services: z.array(OnboardingServiceInput).min(1).max(30),
    hours: OnboardingHoursInput,
  })
  .strict();
export type CreateBusinessInput = z.infer<typeof CreateBusinessInput>;

const trim = (s: string, room: number) => s.slice(0, 40 - room).replace(/-+$/, "");
const pad = (s: string) => (s.length < 3 ? `${s}-biz` : s);

/**
 * Candidate slugs tried in order when the preferred one is taken: base, base-2 … base-5, then base-<random> so a very
 * common name (every "מספרת הדר") can never be locked out. ≤ 40 chars each; `rand` is injectable for tests.
 */
export function slugCandidates(name: string, rand: () => number = Math.random): string[] {
  const base = suggestSlug(name);
  const numbered = [2, 3, 4, 5].map((n) => `${trim(base, String(n).length + 1)}-${n}`);
  const random = [0, 1, 2].map(() => `${trim(base, 5)}-${Math.floor(rand() * 36 ** 4).toString(36).padStart(4, "0")}`);
  return [base, ...numbered, ...random].map(pad);
}

export function toSettings(input: CreateBusinessInput) {
  return { onboarding: { services: input.services, hours: input.hours } };
}
