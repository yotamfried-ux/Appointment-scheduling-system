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
  | "owner_customer_cancelled";

export interface NotifContext {
  type: NotificationType;
  recipient: "customer" | "owner";
  appointment: { id: string; status: string; startsAt: string; endsAt: string; reference: string; serviceName: string };
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
};

const LEAD: Record<NotificationType, (name: string) => string> = {
  booking_received: () => "קיבלנו את הבקשה. בעל העסק יאשר אותה בקרוב ונעדכן אותך.",
  booking_confirmed: () => "התור אושר.",
  booking_declined: () => "לצערנו בעל העסק לא יכול לקבל את הבקשה במועד הזה. אפשר לבחור מועד אחר.",
  booking_cancelled_by_business: () => "בעל העסק ביטל את התור. מצטערים על אי הנוחות, אפשר לקבוע מועד חדש.",
  booking_cancelled_by_customer: () => "התור בוטל לפי בקשתך.",
  reminder: () => "תזכורת: מחר יש לך תור.",
  owner_new_request: (n) => `${n} ביקש/ה תור וממתין/ה לאישור שלך.`,
  owner_customer_cancelled: (n) => `${n} ביטל/ה תור.`,
};

export function render(ctx: NotifContext, opts: { appUrl: string; manageToken?: string }): Rendered {
  const k = BUSINESS_KINDS[ctx.business.kind];
  const biz = clean(ctx.business.name);
  const name = clean(ctx.customer.name);
  const when = whenLabel(ctx.appointment.startsAt, ctx.business.timezone);
  const showService = !k.privacy.hideServiceNameInMessages;
  const owner = ctx.recipient === "owner";
  const link = owner ? `${opts.appUrl}/dashboard` : opts.manageToken ? `${opts.appUrl}/booking/${opts.manageToken}` : null;
  const linkLabel = owner ? "פתיחת היומן" : "צפייה בתור או ביטולו";

  const rows: [string, string][] = [["מועד", when]];
  if (showService) rows.push(["שירות", clean(ctx.appointment.serviceName)]);
  if (owner) rows.unshift(["לקוח/ה", name]);
  else rows.unshift(["עסק", biz]);
  rows.push(["מספר אישור", ctx.appointment.reference]);

  const lead = LEAD[ctx.type](name);
  const subject = clean(SUBJECT[ctx.type](biz));
  const html = `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;background:#f4f6f5;font-family:'IBM Plex Sans Hebrew',Arial,sans-serif;color:#10201d;direction:rtl;text-align:right">
<div style="max-width:520px;margin:0 auto;padding:24px 16px">
<p style="font-size:18px;font-weight:600;margin:0 0 12px"><bdi>${esc(biz)}</bdi></p>
<p style="font-size:16px;line-height:1.6;margin:0 0 16px">${esc(lead)}</p>
<table role="presentation" style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #dde4e1;border-radius:8px">
${rows.map(([l, v]) => `<tr><td style="padding:10px 14px;color:#5b6b66;width:35%">${esc(l)}</td><td style="padding:10px 14px;font-weight:600"><bdi>${esc(v)}</bdi></td></tr>`).join("\n")}
</table>
${link ? `<p style="margin:20px 0"><a href="${esc(link)}" style="display:inline-block;background:#0b6b5d;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">${esc(linkLabel)}</a></p>` : ""}
${!owner && ctx.business.phone ? `<p style="font-size:14px;color:#5b6b66">לשאלות: <bdi>${esc(ctx.business.phone)}</bdi></p>` : ""}
</div></body></html>`;
  const text = [`${biz}`, "", lead, "", ...rows.map(([l, v]) => `${l}: ${v}`), ...(link ? ["", `${linkLabel}: ${link}`] : [])].join("\n");
  return { subject, html, text };
}
