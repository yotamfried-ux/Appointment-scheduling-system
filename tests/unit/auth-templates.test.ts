import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// SIM 7 (templates): the account mails carry one button and nothing else that looks like a link. Old behaviour: a "the button does not open?" line
// followed by the raw address pasted as text, which was the part that broke in some mail apps and read as clutter.
const DIR = join(process.cwd(), "supabase", "templates");
const files = readdirSync(DIR).filter((f) => f.endsWith(".html"));
const LINK_TEMPLATES = files.filter((f) => f !== "reauthentication.html"); // the re-authentication mail carries a code, not a link

describe("supabase account mail templates", () => {
  it("finds every template", () => expect(files.sort()).toEqual(["confirmation.html", "email_change.html", "invite.html", "magic_link.html", "reauthentication.html", "recovery.html"]));

  for (const f of files) {
    const html = readFileSync(join(DIR, f), "utf8");

    it(`${f}: no "button does not open" fallback`, () => {
      expect(html).not.toContain("הכפתור לא נפתח");
      expect(html).not.toMatch(/אם הכפתור|לא נפתח|העתיקו (את )?הקישור|copy and paste/i);
    });

    it(`${f}: no raw address pasted as visible text`, () => {
      const withoutAttributes = html.replace(/href="[^"]*"/g, 'href=""');
      expect(withoutAttributes).not.toMatch(/\{\{\s*\.(SiteURL|ConfirmationURL|RedirectTo)\s*\}\}/);
      expect(withoutAttributes).not.toMatch(/https?:\/\//);
    });
  }

  for (const f of LINK_TEMPLATES) {
    it(`${f}: exactly one call-to-action link, to /auth/confirm with the token hash`, () => {
      const html = readFileSync(join(DIR, f), "utf8");
      const anchors = html.match(/<a\s[^>]*>/g) ?? [];
      expect(anchors).toHaveLength(1);
      expect(anchors[0]).toMatch(/href="\{\{ \.SiteURL \}\}\/auth\/confirm\?token_hash=\{\{ \.TokenHash \}\}&amp;type=[a-z_]+/);
      expect(html.match(/auth\/confirm\?token_hash=/g)).toHaveLength(1);
    });
  }

  it("reauthentication.html: a code, no link", () => {
    const html = readFileSync(join(DIR, "reauthentication.html"), "utf8");
    expect(html).toContain("{{ .Token }}");
    expect(html.match(/<a\s/g) ?? []).toHaveLength(0);
  });
});
