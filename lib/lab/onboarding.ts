import { normalizePhone } from "@/lib/phone";

// Prototype logic for the onboarding wizard (stage 1). Pure, unit-tested; reused when the real
// onboarding is wired to the database in stage 2.

export type OnboardingStep = "business" | "services" | "hours" | "done";
export const ONBOARDING_STEPS: OnboardingStep[] = ["business", "services", "hours", "done"];

export const BUSINESS_TYPES = [
  { id: "barber", label: "מספרה" },
  { id: "beauty", label: "קוסמטיקה" },
  { id: "trainer", label: "מאמן אישי" },
  { id: "teacher", label: "הוראה" },
  { id: "clinic", label: "טיפול ורפואה" },
  { id: "other", label: "אחר" },
] as const;

export interface OnboardingService {
  id: string;
  name: string;
  durationMinutes: number;
  priceNis: number;
}
export interface DayHours {
  weekday: number; // 0 = Sunday
  open: boolean;
  from: string;
  to: string;
}

export interface OnboardingState {
  step: OnboardingStep;
  business: { name: string; type: string; phone: string };
  services: OnboardingService[];
  hours: DayHours[];
}

export const DEFAULT_HOURS: DayHours[] = Array.from({ length: 7 }, (_, weekday) => ({
  weekday,
  open: weekday <= 4,
  from: "09:00",
  to: weekday === 5 ? "13:00" : "18:00",
})).map((h) => (h.weekday === 5 ? { ...h, open: true } : h));

export const initialOnboarding: OnboardingState = {
  step: "business",
  business: { name: "", type: "barber", phone: "" },
  services: [{ id: "s1", name: "", durationMinutes: 30, priceNis: 0 }],
  hours: DEFAULT_HOURS,
};

const RESERVED = new Set(["admin", "api", "login", "auth", "book", "app", "www", "dashboard", "settings", "design", "static"]);

const HE: Record<string, string> = {
  א: "a", ב: "b", ג: "g", ד: "d", ה: "h", ו: "v", ז: "z", ח: "ch", ט: "t", י: "y", כ: "k", ך: "k", ל: "l", מ: "m", ם: "m",
  נ: "n", ן: "n", ס: "s", ע: "a", פ: "p", ף: "f", צ: "tz", ץ: "tz", ק: "k", ר: "r", ש: "sh", ת: "t",
};

/** ASCII, URL-safe, ≤40 chars, never a reserved route (ACC-06). Final uniqueness is enforced by the DB. */
export function suggestSlug(name: string): string {
  const latin = Array.from(name.trim().toLowerCase())
    .map((c) => HE[c] ?? c)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  const slug = latin || "business";
  return RESERVED.has(slug) ? `${slug}-1` : slug;
}

export function serviceValid(s: OnboardingService): boolean {
  return s.name.trim().length >= 2 && s.durationMinutes > 0 && s.priceNis > 0;
}

export function hoursValid(hours: DayHours[]): boolean {
  const open = hours.filter((h) => h.open);
  return open.length > 0 && open.every((h) => h.from < h.to);
}

export function canContinueOnboarding(s: OnboardingState): boolean {
  switch (s.step) {
    case "business":
      return s.business.name.trim().length >= 2 && normalizePhone(s.business.phone) !== null;
    case "services":
      return s.services.length > 0 && s.services.every(serviceValid);
    case "hours":
      return hoursValid(s.hours);
    default:
      return false;
  }
}

export type OnboardingAction =
  | { type: "setBusiness"; business: OnboardingState["business"] }
  | { type: "addService"; service?: Omit<OnboardingService, "id"> }
  | { type: "removeService"; id: string }
  | { type: "updateService"; id: string; patch: Partial<Omit<OnboardingService, "id">> }
  | { type: "toggleDay"; weekday: number }
  | { type: "setHours"; weekday: number; from: string; to: string }
  | { type: "next" }
  | { type: "back" };

let seq = 1;
const newId = () => `s${++seq}-${seq}`;

export function onboardingReducer(s: OnboardingState, a: OnboardingAction): OnboardingState {
  switch (a.type) {
    case "setBusiness":
      return { ...s, business: a.business };
    case "addService":
      return { ...s, services: [...s.services, { id: newId(), ...(a.service ?? { name: "", durationMinutes: 30, priceNis: 0 }) }] };
    case "removeService":
      return s.services.length <= 1 ? s : { ...s, services: s.services.filter((x) => x.id !== a.id) };
    case "updateService":
      return { ...s, services: s.services.map((x) => (x.id === a.id ? { ...x, ...a.patch } : x)) };
    case "toggleDay":
      return { ...s, hours: s.hours.map((h) => (h.weekday === a.weekday ? { ...h, open: !h.open } : h)) };
    case "setHours":
      return { ...s, hours: s.hours.map((h) => (h.weekday === a.weekday ? { ...h, from: a.from, to: a.to } : h)) };
    case "next": {
      if (!canContinueOnboarding(s)) return s;
      return { ...s, step: ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(s.step) + 1] };
    }
    case "back": {
      if (s.step === "done") return s;
      return { ...s, step: ONBOARDING_STEPS[Math.max(0, ONBOARDING_STEPS.indexOf(s.step) - 1)] };
    }
  }
}
