// Mailpit/Inbucket REST helper for the local Supabase stack. Reads the REAL email the
// auth server sent — the authoritative side effect, not a UI assertion.
const BASE = process.env.MAIL_API_URL ?? "http://127.0.0.1:54324";

interface MailSummary {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

export async function messagesTo(address: string): Promise<MailSummary[]> {
  const res = await fetch(`${BASE}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`);
  if (!res.ok) throw new Error(`mail API ${res.status}`);
  const body = (await res.json()) as { messages: MailSummary[] };
  return body.messages ?? [];
}

export async function waitForMail(address: string, timeoutMs = 15_000): Promise<{ subject: string; html: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [m] = await messagesTo(address);
    if (m) {
      const full = (await (await fetch(`${BASE}/api/v1/message/${m.ID}`)).json()) as { HTML: string; Subject: string };
      return { subject: full.Subject, html: full.HTML };
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no email for ${address} within ${timeoutMs}ms`);
}

/** Returns the first link containing `contains`, re-pointed at the app under test
 *  (the email carries SiteURL from supabase/config.toml, e2e serves on another port). */
export function extractLink(html: string, contains: string): string {
  const m = [...html.matchAll(/href="([^"]+)"/g)].map((x) => x[1].replaceAll("&amp;", "&")).find((u) => u.includes(contains));
  if (!m) throw new Error(`link containing "${contains}" not found`);
  const target = new URL(process.env.E2E_BASE_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3100}`);
  const u = new URL(m);
  u.protocol = target.protocol;
  u.host = target.host;
  return u.toString();
}

export async function mailCount(address: string): Promise<number> {
  return (await messagesTo(address)).length;
}
