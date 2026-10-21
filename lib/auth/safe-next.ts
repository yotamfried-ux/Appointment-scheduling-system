// Only same-site relative paths are allowed as the post-confirmation target (open-redirect guard, SEC-19).
// Control characters are refused too: browsers drop tabs/newlines inside a URL, so "/\t/evil.com" would become "//evil.com".
export function safeNext(value: string | null): string {
  if (value && /^\/(?![/\\])[A-Za-z0-9\-._~/?=&%#:@+,]*$/.test(value) && !/%(?:0[0-9a-f]|1[0-9a-f]|2f|5c|7f)/i.test(value.slice(0, 3))) {
    try {
      if (new URL(decodeURIComponent(value), "https://x.invalid").origin === "https://x.invalid" && !/[\u0000-\u001f\\]/.test(decodeURIComponent(value)) && !decodeURIComponent(value).startsWith("//")) return value;
    } catch {
      /* malformed escape: fall through */
    }
  }
  return "/dashboard";
}
