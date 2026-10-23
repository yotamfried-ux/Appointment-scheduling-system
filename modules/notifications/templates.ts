import { BUSINESS_KINDS, type BusinessKindId } from "@/modules/tenancy/business-kind";

// Message templates: plain functions with explicit escaping (no HTML injection from names), right-to-left, one design.
// Privacy (docs/05 §2): the subject never names the service; the body names it only when the business kind allows.
export type NotificationType =
  | "booking_received"
  | "booking_confirmed"
  | "booking_declined"
  | "booking_cancelled_by_business"
  | "booking_cancelled_by_customer"
  | "reminder"
  | "owner_new_request"
  | "owner_customer_cancelled"
  | "booking_rescheduled"
  | "owner_customer_rescheduled"
  | "owner_unconfirmed"
  | "owner_digest"
  | "booking_moved_by_business"
  | "owner_trial_ending"
  | "owner_trial_last_day"
  | "owner_payment_failed"
  | "waitlist_offer"
  | "waitlist_offer_expired";

export interface NotifContext {
  type: NotificationType;
  recipient: "customer" | "owner";
  /** Set for booking messages; null for waitlist messages. */
  appointment: { id: string; status: string; startsAt: string; endsAt: string; reference: string; serviceName: string; /** Only in a business with two or more people. */ personName?: string | null } | null;
  /** Set for the owner's daily digest only. */
  /** Set for the owner's subscription notices only. */
  billing?: { status: string; trialEndsAt: string | null; graceUntil: string | null } | null;
  digest?: { date: string; cancelledYesterday: number; unmarked: number; tomorrow: number } | null;
  /** Set for waitlist messages; null for booking messages. */
  offer: { id: string; status: string; slotStartsAt: string; expiresAt: string; serviceName: string; entryId: string; personName?: string | null } | null;
  business: { name: string; slug: string; kind: BusinessKindId; timezone: string; phone: string | null };
  customer: { name: string; email: string | null };
  owner: { email: string | null };
}

export interface Rendered {
  subject: string;
  html: string;
  text: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const clean = (s: string) => s.replace(/[\r\n]+/g, " ").trim(); // header injection: no line breaks in anything that reaches a subject

const FONT = "'Segoe UI',Heebo,Arial,Helvetica,sans-serif";
const BRAND = "#0b6b5d";

/** One right-to-left e-mail layout for every message: business name on top, one card, one button, a quiet footer. Inline styles and tables only (mail clients ignore the rest). */
function shell(o: { subject: string; preheader: string; title: string; lead: string; rows?: [string, string][]; button?: { href: string; label: string }; note?: string }): string {
  const rows = o.rows?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 20px;border-top:1px solid #e3e9e6">
${o.rows.map(([l, v]) => `<tr><td style="padding:11px 0;border-bottom:1px solid #e3e9e6;font-size:14px;color:#5b6b66;width:34%">${esc(l)}</td><td style="padding:11px 0;border-bottom:1px solid #e3e9e6;font-size:15px;font-weight:600;color:#10201d"><bdi>${esc(v)}</bdi></td></tr>`).join("\n")}
</table>`
    : "";
  const button = o.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 8px"><tr><td style="border-radius:10px;background:${BRAND}"><a href="${esc(o.button.href)}" style="display:inline-block;padding:14px 26px;font-family:${FONT};font-size:16px;font-weight:600;line-height:1;color:#ffffff;text-decoration:none;border-radius:10px">${esc(o.button.label)}</a></td></tr></table>`
    : "";
  const note = o.note ? `<p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:#5b6b66">${o.note}</p>` : "";
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(o.subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f6f5;font-family:${FONT};direction:rtl;text-align:right">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(o.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f5"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="padding:0 4px 14px;font-family:${FONT};font-size:18px;font-weight:700;color:${BRAND};text-align:right"><bdi>${esc(o.title)}</bdi></td></tr>
<tr><td style="background:#ffffff;border:1px solid #dde4e1;border-radius:14px;padding:26px 24px;font-family:${FONT};text-align:right;direction:rtl">
<p style="margin:0 0 20px;font-size:17px;line-height:1.65;color:#10201d">${esc(o.lead)}</p>
${rows}${button}${note}
</td></tr>
<tr><td style="padding:14px 4px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:#5b6b66;text-align:right">ההודעה נשלחה אוטומטית דרך "תורים". אין צורך להשיב לה.</td></tr>
</table></td></tr></table>
</body></html>`;
}

export function whenLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("he-IL", { timeZone, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
}

const SUBJECT: Record<NotificationType, (b: string) => string> = {
  booking_received: (b) => `הבקשה שלך התקבלה · ${b}`,
  booking_confirmed: (b) => `התור שלך אושר · ${b}`,
  booking_declined: (b) => `לא הצלחנו לאשר את התור · ${b}`,
  booking_cancelled_by_business: (b) => `התור שלך בוטל · ${b}`,
  booking_cancelled_by_customer: (b) => `ביטלת את התור · ${b}`,
  reminder: (b) => `תזכורת לתור שלך · ${b}`,
  owner_new_request: () => "בקשת תור חדשה ממתינה לאישור",
  owner_customer_cancelled: () => "לקוח ביטל תור",
  booking_rescheduled: (b) => `התור שלך הועבר · ${b}`,
  owner_customer_rescheduled: () => "לקוח העביר תור",
  owner_unconfirmed: () => "לקוח עוד לא אישר הגעה",
  owner_digest: () => "סיכום יומי מהיומן",
  booking_moved_by_business: (b) => `העסק העביר את התור שלך · ${b}`,
  owner_trial_ending: () => "תקופת הניסיון שלך מסתיימת בקרוב",
  owner_trial_last_day: () => "היום האחרון של תקופת הניסיון",
  owner_payment_failed: () => "התשלום על המנוי לא עבר",
  waitlist_offer: (b) => `התפנה תור בשבילך · ${b}`,
  waitlist_offer_expired: (b) => `ההצעה לתור פגה · ${b}`,
};

const LEAD: Record<NotificationType, (name: string) => string> = {
  booking_received: () => "קיבלנו את הבקשה. העסק יאשר אותה בקרוב ונעדכן אותך.",
  booking_confirmed: () => "התור אושר.",
  booking_declined: () => "לצערנו העסק לא יכול לקבל את הבקשה במועד הזה. אפשר לבחור מועד אחר.",
  booking_cancelled_by_business: () => "העסק ביטל את התור. מצטערים על אי הנוחות, אפשר לקבוע מועד חדש.",
  booking_cancelled_by_customer: () => "התור בוטל לפי בקשתך.",
  reminder: () => "תזכורת: מחר יש לך תור.",
  owner_new_request: (n) => `${n} ביקש/ה תור וממתין/ה לאישור שלך.`,
  owner_customer_cancelled: (n) => `${n} ביטל/ה תור.`,
  booking_rescheduled: () => "התור הועבר למועד החדש. המועד המעודכן מופיע למטה.",
  owner_customer_rescheduled: (n) => `${n} העביר/ה תור למועד אחר.`,
  owner_unconfirmed: (n) => `${n} עדיין לא אישר/ה הגעה לתור הקרוב. אולי כדאי לשלוח הודעה.`,
  owner_digest: () => "מה חשוב לדעת היום:",
  owner_trial_ending: () => "תקופת הניסיון מסתיימת בקרוב. כדי שדף ההזמנות ימשיך לקבל תורים חדשים צריך לבחור חבילה.",
  owner_trial_last_day: () => "היום תקופת הניסיון מסתיימת. אחרי זה דף ההזמנות לא יקבל תורים חדשים עד שתבחרו חבילה (התורים הקיימים והמידע נשמרים).",
  owner_payment_failed: () => "לא הצלחנו לגבות את התשלום האחרון. הכול ממשיך לעבוד בתקופת חסד, אבל כדאי לעדכן את אמצעי התשלום.",
  booking_moved_by_business: () => "העסק העביר את התור שלך למועד אחר (המועד החדש למטה). אם המועד לא מתאים, אפשר לבטל בקישור בלי שום תנאי.",
  waitlist_offer: () => "התפנה תור בזמן שביקשת. התור שמור לך לזמן קצר, ואחר כך עובר לממתין הבא.",
  waitlist_offer_expired: () => "ההצעה לא נענתה בזמן והתור עבר לממתין הבא. נשארת ברשימת ההמתנה ונשלח הצעה נוספת כשיתפנה תור אחר.",
};

function renderDigest(ctx: NotifContext, opts: { appUrl: string }): Rendered {
  const d = ctx.digest!;
  const biz = clean(ctx.business.name);
  const rows: [string, string][] = [];
  if (d.tomorrow > 0) rows.push(["תורים מחר", String(d.tomorrow)]);
  if (d.cancelledYesterday > 0) rows.push(["ביטולים אתמול", String(d.cancelledYesterday)]);
  if (d.unmarked > 0) rows.push(["תורים שעברו וממתינים לסימון", String(d.unmarked)]);
  const subject = clean(SUBJECT.owner_digest(biz));
  const lead = LEAD.owner_digest("");
  const link = `${opts.appUrl}/dashboard`;
  const html = shell({ subject, preheader: lead, title: biz, lead, rows, button: { href: link, label: "פתיחת היומן" } });
  const text = [biz, "", lead, "", ...rows.map(([l, v]) => `${l}: ${v}`), "", `פתיחת היומן: ${link}`].join("\n");
  return { subject, html, text };
}

const dayLabel = (iso: string, tz: string) => new Intl.DateTimeFormat("he-IL", { timeZone: tz, day: "numeric", month: "long" }).format(new Date(iso));

function renderBilling(ctx: NotifContext, opts: { appUrl: string }, now: Date): Rendered {
  const b = ctx.billing!;
  const biz = clean(ctx.business.name);
  const rows: [string, string][] = [];
  if (ctx.type !== "owner_payment_failed" && b.trialEndsAt) {
    const days = Math.max(0, Math.ceil((new Date(b.trialEndsAt).getTime() - now.getTime()) / 86_400_000));
    rows.push(["סיום הניסיון", dayLabel(b.trialEndsAt, ctx.business.timezone)]);
    if (ctx.type === "owner_trial_ending") rows.push(["ימים שנותרו", String(days)]);
  }
  if (ctx.type === "owner_payment_failed" && b.graceUntil) rows.push(["תקופת החסד עד", dayLabel(b.graceUntil, ctx.business.timezone)]);
  const subject = clean(SUBJECT[ctx.type](biz));
  const lead = LEAD[ctx.type]("");
  const link = `${opts.appUrl}/settings/billing`;
  const html = shell({ subject, preheader: lead, title: biz, lead, rows, button: { href: link, label: "למנוי ולחיוב" } });
  const text = [biz, "", lead, "", ...rows.map(([l, v]) => `${l}: ${v}`), "", `למנוי ולחיוב: ${link}`].join("\n");
  return { subject, html, text };
}

export function render(ctx: NotifContext, opts: { appUrl: string; manageToken?: string }, now: Date = new Date()): Rendered {
  if (ctx.digest) return renderDigest(ctx, opts);
  if (ctx.billing) return renderBilling(ctx, opts, now);
  const k = BUSINESS_KINDS[ctx.business.kind];
  const biz = clean(ctx.business.name);
  const name = clean(ctx.customer.name);
  const offer = ctx.offer;
  const when = whenLabel(ctx.appointment?.startsAt ?? offer!.slotStartsAt, ctx.business.timezone);
  const serviceName = ctx.appointment?.serviceName ?? offer!.serviceName;
  const showService = !k.privacy.hideServiceNameInMessages;
  const owner = ctx.recipient === "owner";
  const link = owner ? `${opts.appUrl}/dashboard` : opts.manageToken ? `${opts.appUrl}/${offer ? "waitlist" : "booking"}/${opts.manageToken}` : null;
  const linkLabel = owner ? "פתיחת היומן" : ctx.type === "waitlist_offer" ? "לצפייה ולאישור התור" : offer ? "מצב ההמתנה שלי" : "צפייה בתור או ביטולו";

  const rows: [string, string][] = [["מועד", when]];
  if (showService) rows.push(["שירות", clean(serviceName)]);
  const person = ctx.appointment?.personName ?? offer?.personName;
  if (person) rows.push(["אצל", clean(person)]);
  if (owner) rows.unshift(["לקוח/ה", name]);
  else rows.unshift(["עסק", biz]);
  if (ctx.type === "waitlist_offer" && offer) rows.push(["תקף עד", new Intl.DateTimeFormat("he-IL", { timeZone: ctx.business.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(offer.expiresAt))]);
  if (ctx.appointment) rows.push(["מספר אישור", ctx.appointment.reference]);

  const lead = LEAD[ctx.type](name);
  const subject = clean(SUBJECT[ctx.type](biz));
  const html = shell({
    subject,
    preheader: lead,
    title: biz,
    lead,
    rows,
    ...(link ? { button: { href: link, label: linkLabel } } : {}),
    ...(!owner && ctx.business.phone ? { note: `לשאלות: <bdi>${esc(ctx.business.phone)}</bdi>` } : {}),
  });
  const text = [`${biz}`, "", lead, "", ...rows.map(([l, v]) => `${l}: ${v}`), ...(link ? ["", `${linkLabel}: ${link}`] : [])].join("\n");
  return { subject, html, text };
}
