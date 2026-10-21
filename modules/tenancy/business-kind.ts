// Business kinds: how the product adapts to different types of business without forking the code.
// A kind = vocabulary (Hebrew), scheduling defaults, working-hours patterns, intake fields, location modes,
// group support and privacy posture. Everything here is *defaults*: owners can override per business (stage 2).
// Docs: 03 §5 (resource_id/staff), 04 CAT/AVL, 05 §2 (sensitive data for health-related kinds).

export const KIND_IDS = ["barber", "beauty", "nails", "trainer", "teacher", "clinic", "other"] as const;
export type BusinessKindId = (typeof KIND_IDS)[number];

export interface Vocab {
  appointment: string;
  appointments: string;
  customer: string;
  customers: string;
  service: string;
  services: string;
  provider: string;
  businessNoun: string;
  pickService: string;
  pickServiceHint: string;
  bookCta: string;
  doneTitle: string;
}

export interface ServicePreset {
  id: string;
  name: string;
  description: string;
  durationMinutes: number;
  priceNis: number;
  group?: boolean;
}

export interface TimeWindow {
  from: number; // minutes from midnight
  to: number;
}

export interface IntakeField {
  id: string;
  label: string;
  type: "text" | "select";
  options?: string[];
  required: boolean;
  /** Could reveal health-related information (docs/05 §2). */
  sensitive: boolean;
  visibleToProviderOnly: boolean;
  /** Never true: intake answers are not echoed into emails/calendar entries. */
  inMessages: boolean;
}

export type LocationMode = "business" | "customer" | "online";

export interface KindConfig {
  id: BusinessKindId;
  label: string;
  vocab: Vocab;
  presets: ServicePreset[];
  defaults: {
    slotStepMinutes: number;
    bufferMinutes: number;
    requireApproval: boolean;
    cancelUntilHours: number;
    allowLastMinute: boolean;
    noShowTracking: boolean;
  };
  /** Index 0 = Sunday … 6 = Saturday. Empty array = closed. Several windows = split day. */
  hours: TimeWindow[][];
  intake: IntakeField[];
  locations: LocationMode[];
  group: { supported: boolean; defaultCapacity: number };
  privacy: { sensitive: boolean; hideServiceNameInMessages: boolean; allowFreeTextNotesInMessages: boolean };
  sample: { businessName: string; address: string };
}

const H = (h: number, m = 0) => h * 60 + m;
const week = (sunThu: TimeWindow[], fri: TimeWindow[] = [], sat: TimeWindow[] = []): TimeWindow[][] => [sunThu, sunThu, sunThu, sunThu, sunThu, fri, sat];

const field = (f: Partial<IntakeField> & Pick<IntakeField, "id" | "label" | "type">): IntakeField => ({
  required: false,
  sensitive: false,
  visibleToProviderOnly: false,
  inMessages: false,
  ...f,
});

export const BUSINESS_KINDS: Record<BusinessKindId, KindConfig> = {
  barber: {
    id: "barber",
    label: "מספרה",
    vocab: { appointment: "תור", appointments: "תורים", customer: "לקוח", customers: "לקוחות", service: "שירות", services: "שירותים", provider: "ספר/ית", businessNoun: "מספרה", pickService: "איזה שירות תרצו?", pickServiceHint: "בחרו שירות כדי לראות זמנים פנויים.", bookCta: "אישור התור", doneTitle: "התור נקבע!" },
    presets: [
      { id: "haircut", name: "תספורת גברים", description: "תספורת מדויקת כולל שטיפה ועיצוב", durationMinutes: 30, priceNis: 80 },
      { id: "color", name: "צבע שיער", description: "צביעה מלאה עם טיפול הזנה", durationMinutes: 90, priceNis: 280 },
      { id: "beard", name: "עיצוב זקן", description: "עיצוב וגילוח במספרה", durationMinutes: 20, priceNis: 40 },
      { id: "kids", name: "תספורת ילדים", description: "עד גיל 12", durationMinutes: 20, priceNis: 60 },
    ],
    defaults: { slotStepMinutes: 30, bufferMinutes: 5, requireApproval: false, cancelUntilHours: 12, allowLastMinute: true, noShowTracking: true },
    hours: week([{ from: H(9), to: H(18) }], [{ from: H(9), to: H(13) }]),
    intake: [],
    locations: ["business"],
    group: { supported: false, defaultCapacity: 1 },
    privacy: { sensitive: false, hideServiceNameInMessages: false, allowFreeTextNotesInMessages: false },
    sample: { businessName: "מספרת הדר", address: "הרצל 12, תל אביב" },
  },
  beauty: {
    id: "beauty",
    label: "קוסמטיקה",
    vocab: { appointment: "תור", appointments: "תורים", customer: "לקוח/ה", customers: "לקוחות", service: "טיפול", services: "טיפולים", provider: "מטפל/ת", businessNoun: "סטודיו", pickService: "איזה טיפול תרצו?", pickServiceHint: "בחרו טיפול כדי לראות זמנים פנויים.", bookCta: "אישור התור", doneTitle: "התור נקבע!" },
    presets: [
      { id: "facial", name: "טיפול פנים", description: "ניקוי עמוק, פילינג ומסכה", durationMinutes: 60, priceNis: 220 },
      { id: "lashes", name: "הרמת ריסים", description: "הרמה וצביעה", durationMinutes: 90, priceNis: 250 },
      { id: "manicure", name: "מניקור ג׳ל", description: "כולל עיצוב צורה", durationMinutes: 45, priceNis: 110 },
    ],
    defaults: { slotStepMinutes: 30, bufferMinutes: 10, requireApproval: false, cancelUntilHours: 24, allowLastMinute: true, noShowTracking: true },
    hours: week([{ from: H(9, 30), to: H(19) }], [{ from: H(9), to: H(14) }]),
    intake: [],            // owner decision 2026-10-20: no sensitive intake fields are collected
    locations: ["business"],
    group: { supported: false, defaultCapacity: 1 },
    privacy: { sensitive: true, hideServiceNameInMessages: true, allowFreeTextNotesInMessages: false },
    sample: { businessName: "סטודיו נוי", address: "דיזנגוף 80, תל אביב" },
  },
  nails: {
    id: "nails",
    label: "מניקוריסט/ית",
    vocab: { appointment: "תור", appointments: "תורים", customer: "לקוח/ה", customers: "לקוחות", service: "טיפול", services: "טיפולים", provider: "מניקוריסט/ית", businessNoun: "סטודיו", pickService: "איזה טיפול תרצו?", pickServiceHint: "בחרו טיפול כדי לראות זמנים פנויים.", bookCta: "אישור התור", doneTitle: "התור נקבע!" },
    presets: [
      { id: "gel", name: "לק ג׳ל", description: "הכנת הציפורן, לק ג׳ל וייבוש במנורה", durationMinutes: 60, priceNis: 120 },
      { id: "build", name: "בניית ציפורניים", description: "בניית ג׳ל או אקריליק, כולל עיצוב צורה", durationMinutes: 120, priceNis: 250 },
      { id: "manicure", name: "מניקור", description: "טיפוח ציפורניים וגזירת קוטיקולה", durationMinutes: 45, priceNis: 90 },
      { id: "pedicure", name: "פדיקור", description: "טיפוח כפות הרגליים והציפורניים", durationMinutes: 60, priceNis: 130 },
      { id: "removal", name: "הסרת ג׳ל", description: "הסרה עדינה, בלי פגיעה בציפורן", durationMinutes: 30, priceNis: 50 },
    ],
    defaults: { slotStepMinutes: 30, bufferMinutes: 10, requireApproval: false, cancelUntilHours: 24, allowLastMinute: true, noShowTracking: true },
    hours: week([{ from: H(9, 30), to: H(19) }], [{ from: H(9), to: H(14) }]),
    intake: [],            // owner decision 2026-10-20: no sensitive intake fields are collected
    locations: ["business", "customer"],
    group: { supported: false, defaultCapacity: 1 },
    privacy: { sensitive: true, hideServiceNameInMessages: true, allowFreeTextNotesInMessages: false },
    sample: { businessName: "נייל סטודיו", address: "הרצל 12, רמת גן" },
  },
  trainer: {
    id: "trainer",
    label: "מאמן אישי",
    vocab: { appointment: "אימון", appointments: "אימונים", customer: "מתאמן/ת", customers: "מתאמנים", service: "סוג אימון", services: "סוגי אימון", provider: "מאמן/ת", businessNoun: "סטודיו", pickService: "איזה אימון תרצו?", pickServiceHint: "בחרו סוג אימון כדי לראות זמנים פנויים.", bookCta: "אישור האימון", doneTitle: "האימון נקבע!" },
    presets: [
      { id: "pt", name: "אימון אישי", description: "אימון מותאם אישית, 1 על 1", durationMinutes: 60, priceNis: 200 },
      { id: "pair", name: "אימון זוגי", description: "לשניים, באותו מכשור", durationMinutes: 60, priceNis: 280 },
      { id: "group", name: "אימון קבוצתי", description: "עד 8 משתתפים", durationMinutes: 45, priceNis: 60, group: true },
    ],
    defaults: { slotStepMinutes: 60, bufferMinutes: 0, requireApproval: false, cancelUntilHours: 24, allowLastMinute: false, noShowTracking: true },
    hours: week([{ from: H(6), to: H(10) }, { from: H(17), to: H(21) }], [{ from: H(7), to: H(11) }]),
    intake: [],            // owner decision 2026-10-20: no sensitive intake fields are collected
    locations: ["business", "customer", "online"],
    group: { supported: true, defaultCapacity: 8 },
    privacy: { sensitive: false, hideServiceNameInMessages: false, allowFreeTextNotesInMessages: false },
    sample: { businessName: "בלנס · אימון אישי", address: "אצלי בסטודיו או אצלכם" },
  },
  teacher: {
    id: "teacher",
    label: "מורה פרטי/ת",
    vocab: { appointment: "שיעור", appointments: "שיעורים", customer: "תלמיד/ה", customers: "תלמידים", service: "שיעור", services: "סוגי שיעורים", provider: "מורה", businessNoun: "מרכז לימוד", pickService: "איזה שיעור תרצו?", pickServiceHint: "בחרו שיעור כדי לראות מועדים פנויים.", bookCta: "אישור השיעור", doneTitle: "השיעור נקבע!" },
    presets: [
      { id: "private", name: "שיעור פרטי", description: "מותאם לתלמיד, 1 על 1", durationMinutes: 60, priceNis: 150 },
      { id: "small", name: "שיעור קבוצתי קטן", description: "עד 5 תלמידים", durationMinutes: 90, priceNis: 80, group: true },
      { id: "bagrut", name: "הכנה לבגרות", description: "מיקוד בחומר ובתרגול", durationMinutes: 60, priceNis: 180 },
    ],
    defaults: { slotStepMinutes: 30, bufferMinutes: 0, requireApproval: false, cancelUntilHours: 24, allowLastMinute: false, noShowTracking: true },
    hours: week([{ from: H(14), to: H(20) }]),
    intake: [
      field({ id: "studentName", label: "שם התלמיד/ה (אם מזמינים עבורו/ה)", type: "text" }),
      field({ id: "level", label: "כיתה או רמה", type: "text", required: true }),
    ],
    locations: ["business", "customer", "online"],
    group: { supported: true, defaultCapacity: 5 },
    privacy: { sensitive: false, hideServiceNameInMessages: false, allowFreeTextNotesInMessages: false },
    sample: { businessName: "שיעורים עם יעל", address: "אונליין או בבית התלמיד" },
  },
  clinic: {
    id: "clinic",
    label: "טיפול ורפואה",
    vocab: { appointment: "תור", appointments: "תורים", customer: "מטופל/ת", customers: "מטופלים", service: "טיפול", services: "טיפולים", provider: "מטפל/ת", businessNoun: "קליניקה", pickService: "איזה טיפול תרצו?", pickServiceHint: "בחרו סוג טיפול כדי לראות זמנים פנויים.", bookCta: "אישור התור", doneTitle: "התור נקבע" },
    presets: [
      { id: "first", name: "טיפול ראשון", description: "היכרות והערכה ראשונית", durationMinutes: 60, priceNis: 300 },
      { id: "followup", name: "טיפול המשך", description: "מפגש טיפולי", durationMinutes: 45, priceNis: 250 },
      { id: "short", name: "ייעוץ קצר", description: "שיחת התייעצות", durationMinutes: 20, priceNis: 120 },
    ],
    defaults: { slotStepMinutes: 30, bufferMinutes: 10, requireApproval: true, cancelUntilHours: 24, allowLastMinute: false, noShowTracking: true },
    hours: week([{ from: H(8), to: H(16) }], [{ from: H(8), to: H(12) }]),
    intake: [],            // owner decision 2026-10-20: no sensitive intake fields are collected
    locations: ["business", "online"],
    group: { supported: false, defaultCapacity: 1 },
    privacy: { sensitive: true, hideServiceNameInMessages: true, allowFreeTextNotesInMessages: false },
    sample: { businessName: "קליניקת אור", address: "ויצמן 5, רעננה" },
  },
  other: {
    id: "other",
    label: "אחר",
    vocab: { appointment: "תור", appointments: "תורים", customer: "לקוח/ה", customers: "לקוחות", service: "שירות", services: "שירותים", provider: "נותן/ת שירות", businessNoun: "עסק", pickService: "איזה שירות תרצו?", pickServiceHint: "בחרו שירות כדי לראות זמנים פנויים.", bookCta: "אישור התור", doneTitle: "התור נקבע!" },
    presets: [{ id: "meeting", name: "פגישה", description: "פגישה אישית", durationMinutes: 30, priceNis: 100 }],
    defaults: { slotStepMinutes: 30, bufferMinutes: 0, requireApproval: false, cancelUntilHours: 24, allowLastMinute: true, noShowTracking: true },
    hours: week([{ from: H(9), to: H(17) }]),
    intake: [],
    locations: ["business"],
    group: { supported: false, defaultCapacity: 1 },
    privacy: { sensitive: false, hideServiceNameInMessages: false, allowFreeTextNotesInMessages: false },
    sample: { businessName: "העסק שלי", address: "" },
  },
};

export const DEFAULT_KIND: BusinessKindId = "barber";

export function getKind(id: BusinessKindId): KindConfig {
  return BUSINESS_KINDS[id];
}

/** Parses untrusted input (query/path param). Anything unknown — including prototype keys — falls back safely. */
export function kindFromParam(value: unknown): BusinessKindId {
  return typeof value === "string" && (KIND_IDS as readonly string[]).includes(value) ? (value as BusinessKindId) : DEFAULT_KIND;
}
