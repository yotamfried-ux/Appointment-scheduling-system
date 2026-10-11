// What leaves the system by email (docs/05 §2/§5.12). Pure, so privacy rules are unit-testable.
import { getKind, type BusinessKindId } from "@/modules/tenancy/business-kind";

export interface EmailPreview {
  to: string;
  subject: string;
  body: string;
}

export function buildBookingEmail(args: {
  kind: BusinessKindId;
  businessName: string;
  serviceName: string;
  customerName: string;
  customerEmail: string;
  dateLabel: string;
  time: string;
  reference: string;
  status: "confirmed" | "pending";
}): EmailPreview {
  const k = getKind(args.kind);
  const { vocab, privacy } = k;
  const noun = vocab.appointment;
  // Sensitive kinds never name the service/treatment in a message that may sit in a shared inbox.
  const what = privacy.hideServiceNameInMessages ? "" : ` · ${args.serviceName}`;
  const subject = args.status === "pending" ? `בקשת ${noun} התקבלה` : `אישור ${noun}`;
  const lines = [
    `שלום ${args.customerName},`,
    args.status === "pending" ? `הבקשה שלכם התקבלה וממתינה לאישור של ${args.businessName}.` : `ה${noun} שלכם ב${args.businessName} נקבע.`,
    `${args.dateLabel} בשעה ${args.time}${what}`,
    `מספר אישור: ${args.reference}`,
    `לביטול או לשינוי השתמשו בקישור האישי שמופיע באתר ההזמנה.`,
  ];
  return { to: args.customerEmail, subject, body: lines.join("\n") };
}
