/**
 * The mailbox an address really delivers to, so that limits per address cannot be dodged by writing the same inbox many ways:
 * `a+1@x.com`, `a+2@x.com` and (at Gmail) `a.b@gmail.com` / `ab@gmail.com` all arrive in one place (Strix: one third-party inbox could be flooded).
 */
export function mailboxKey(email: string): string {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1) return e;
  let local = e.slice(0, at);
  let domain = e.slice(at + 1);
  local = local.split("+")[0] ?? local;
  if (domain === "gmail.com" || domain === "googlemail.com") {
    domain = "gmail.com";
    local = local.replaceAll(".", "");
  }
  return `${local}@${domain}`;
}
