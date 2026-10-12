import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { firstDayWithSlots, loginAs, makeBusiness, publicBook, sql, type TestBusiness } from "./helpers/business";

// Stage 10: the customer's ICS file (CAL-05, BKG-16), the legal pages (CMP-03/04), no tracking without consent (CMP-01), versioned acceptance (CMP-03).
// There is deliberately no external-calendar sync (decision D23), so there is nothing here about OAuth or tokens.
const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

/** Local Israel time -> UTC instant, computed independently of the app (two refinement steps handle both sides of a DST change). */
function israelToUtc(date: string, time: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wanted = Date.UTC(y, m - 1, d, hh, mm);
  let guess = wanted;
  for (let i = 0; i < 3; i++) {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
    const shown = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
    guess += wanted - shown;
  }
  return new Date(guess);
}
const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const unfold = (s: string) => s.replace(/\r\n[ \t]/g, "");
const field = (ics: string, name: string) => unfold(ics).split("\r\n").find((l) => l.startsWith(`${name}:`))?.slice(name.length + 1);

async function booked(request: Parameters<typeof firstDayWithSlots>[0], b: TestBusiness, n = 1) {
  const f = await firstDayWithSlots(request, b);
  const bk = (await publicBook(request, b, f.date, f.times[0], n)) as { id: string; date: string; time: string; endTime: string; status: string; manageUrl: string };
  return { bk, f };
}

test.describe("ICS for the customer (CAL-05)", () => {
  test("a stable, correct, deterministic file; a changed appointment keeps its UID and raises the SEQUENCE", async ({ request, page }) => {
    const b = await makeBusiness("barber");
    const { bk } = await booked(request, b);
    const res = await request.get(`${bk.manageUrl}/calendar`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/calendar");
    expect(res.headers()["content-disposition"]).toContain("attachment");
    expect(res.headers()["cache-control"]).toContain("no-store");
    const ics = await res.text();
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).not.toMatch(/[^\r]\n/);
    // the instant is right, in UTC, whatever the local offset on that day is
    expect(field(ics, "DTSTART")).toBe(stamp(israelToUtc(bk.date, bk.time)));
    expect(field(ics, "DTEND")).toBe(stamp(israelToUtc(bk.date, bk.endTime)));
    expect(field(ics, "UID")).toBe(`${bk.id}@127.0.0.1:3100`);
    expect(field(ics, "STATUS")).toBe(bk.status === "confirmed" ? "CONFIRMED" : "TENTATIVE");
    expect(field(ics, "SUMMARY")).toContain(b.services[0].name.replace(/,/g, "\\,"));
    // nothing private rides along: the file points at the business's public page, never at the private link
    expect(ics).not.toContain(bk.manageUrl.split("/").pop()!);
    expect(field(ics, "URL")).toContain(`/book/${b.slug}`);
    expect(field(ics, "DESCRIPTION")).toContain("אסמכתא");
    for (const l of ics.split("\r\n")) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);

    // downloading again gives the very same bytes (importing twice cannot duplicate or change anything)
    expect(await (await request.get(`${bk.manageUrl}/calendar`)).text()).toBe(ics);

    // a change moves the SEQUENCE up and keeps the UID. Triggers are bypassed (replica role) only to place `updated_at` exactly: the appointment guard rightly forbids editing a booked slot.
    const touch = (when: string) => sql(`set session_replication_role = replica; update public.appointments set updated_at = ${when} where id='${bk.id}'`);
    touch("now() - interval '10 minutes'");
    const before = await (await request.get(`${bk.manageUrl}/calendar`)).text();
    touch("now()");
    const after = await (await request.get(`${bk.manageUrl}/calendar`)).text();
    expect(field(after, "UID")).toBe(field(before, "UID"));
    expect(Number(field(after, "SEQUENCE"))).toBeGreaterThan(Number(field(before, "SEQUENCE")));

    // the manage page offers the file
    await page.goto(bk.manageUrl);
    const link = page.getByTestId("manage-add-to-calendar");
    await expect(link).toHaveAttribute("href", `${bk.manageUrl}/calendar`);
    await noOverflow(page);
    expect((await axe(page)).violations).toEqual([]);
  });

  test("user-controlled text can neither break a line nor add a property (SEC-08)", async ({ request }) => {
    const b = await makeBusiness("barber");
    const { bk } = await booked(request, b);
    const evil = "x\r\nATTENDEE:mailto:evil@example.com\r\nBEGIN:VALARM, ;\\";
    sql(`set session_replication_role = replica; update public.appointments set service_snapshot = jsonb_set(service_snapshot, '{name}', to_jsonb($q$${evil}$q$::text)) where id='${bk.id}'`);
    const ics = await (await request.get(`${bk.manageUrl}/calendar`)).text();
    expect(ics.split("\r\n").some((l) => l.startsWith("ATTENDEE"))).toBe(false);
    expect(ics.split("\r\n").filter((l) => l === "BEGIN:VALARM")).toHaveLength(1); // only our own reminder
    expect(ics).toContain("\\n"); // the newline survived as an escaped one
  });

  test("a cancelled appointment, a tampered link and the wrong kind of token all give one generic 404", async ({ request }) => {
    const b = await makeBusiness("barber");
    const { bk } = await booked(request, b);
    const token = bk.manageUrl.split("/").pop()!;
    expect((await request.get(`/booking/${token}x/calendar`)).status()).toBe(404);
    expect((await request.get(`/booking/${token.split(".")[0]}.AAAA/calendar`)).status()).toBe(404);
    expect((await request.get(`/booking/garbage/calendar`)).status()).toBe(404);
    expect((await b.db.rpc("transition_appointment", { p_id: bk.id, p_action: "cancel" })).error).toBeNull();
    const gone = await request.get(`${bk.manageUrl}/calendar`);
    expect(gone.status()).toBe(404);
    expect(await gone.text()).toBe("Not found");
  });
});

const PAGES = [
  ["/privacy", "מדיניות פרטיות"],
  ["/terms", "תנאי שימוש"],
  ["/cookies", "עוגיות"],
  ["/accessibility", "הצהרת נגישות"],
] as const;

test.describe("legal pages (CMP-03/04)", () => {
  for (const [path, title] of PAGES) {
    test(`${path}: titled, versioned, flagged as a draft, linked from the footer, accessible and balanced`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
      await expect(page.getByTestId("legal-version")).toContainText("גרסה 2026-10-12");
      await expect(page.getByTestId("legal-draft")).toContainText("טרם נבדק משפטית"); // never presented as final legal text
      const links = page.getByTestId("legal-footer").getByRole("link");
      await expect(links).toHaveCount(4);
      expect(await links.evaluateAll((a) => a.map((x) => x.getAttribute("href")))).toEqual(["/privacy", "/terms", "/cookies", "/accessibility"]);
      await noOverflow(page);
      expect((await axe(page)).violations).toEqual([]);
      await page.screenshot({ path: `test-results/legal-${path.slice(1)}-${test.info().project.name}.png`, fullPage: true });
    });
  }

  test("accessibility statement: honest about limits, contact is a visible placeholder rather than an invented address; keyboard reaches the skip link first", async ({ page }) => {
    await page.goto("/accessibility");
    await expect(page.getByText("טרם בוצע ביקורת נגישות חיצונית")).toBeVisible();
    await expect(page.getByTestId("a11y-contact").locator("[data-placeholder]")).toBeVisible();
    await expect(page.getByTestId("a11y-review")).toContainText("הבדיקה האחרונה");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "דילוג לתוכן הראשי" })).toBeFocused();
  });

  test("cookies page: lists the essential cookies and says there are no optional ones; the table of contents jumps to a section", async ({ page }) => {
    await page.goto("/cookies");
    await expect(page.getByTestId("cookie-list").getByRole("listitem")).toHaveCount(3);
    await expect(page.getByTestId("consent-none")).toBeVisible();
    await page.goto("/privacy");
    await page.getByRole("navigation", { name: "תוכן העניינים" }).getByRole("link").nth(2).click();
    await expect(page).toHaveURL(/#why$/);
  });

  test("public pages carry the footer, and sign-up links to the terms and the privacy policy", async ({ page, request }) => {
    const b = await makeBusiness("barber");
    const { bk } = await booked(request, b);
    for (const path of ["/", `/book/${b.slug}`, bk.manageUrl]) {
      await page.goto(path);
      await expect(page.getByTestId("legal-footer"), path).toBeVisible();
    }
    await page.goto("/auth/sign-up");
    const note = page.getByTestId("signup-legal");
    await expect(note.getByRole("link", { name: "תנאי השימוש" })).toHaveAttribute("href", "/terms");
    await expect(note.getByRole("link", { name: "מדיניות הפרטיות" })).toHaveAttribute("href", "/privacy");
    await noOverflow(page);
  });
});

test.describe("no tracking without consent (CMP-01, BKG-17)", () => {
  test("anonymous visitors get no cookies and the browser talks to no one but this site; owners get only the session cookie", async ({ page, request, context }) => {
    const b = await makeBusiness("barber");
    const { bk } = await booked(request, b);
    const origin = new URL(page.url() === "about:blank" ? "http://127.0.0.1:3100" : page.url()).host;
    const foreign = new Set<string>();
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (!["http:", "https:"].includes(u.protocol)) return; // data: and blob: stay inside the browser
      if (u.host !== origin) foreign.add(u.host);
    });
    for (const path of ["/", "/privacy", "/terms", "/cookies", "/accessibility", "/auth/login", "/auth/sign-up", `/book/${b.slug}`, bk.manageUrl]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
    }
    expect(await context.cookies(), "anonymous browsing sets no cookies at all").toEqual([]);
    expect(await page.evaluate(() => document.cookie)).toBe("");
    expect(await page.evaluate(() => localStorage.length + sessionStorage.length), "and no tracking identifiers in web storage").toBeLessThanOrEqual(2); // next-themes' theme key only
    expect([...foreign], "no request to any other host").toEqual([]);
    expect(await page.getByTestId("consent-banner").count()).toBe(0); // nothing optional exists, so nothing to ask

    await loginAs(page, b.ownerEmail);
    for (const path of ["/dashboard", "/customers", "/reports", "/settings/billing"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
    }
    const cookies = await context.cookies();
    expect(cookies.length).toBeGreaterThan(0);
    for (const c of cookies) {
      expect(c.name, "only the auth session cookie").toMatch(/^sb-.+-auth-token(\.\d+)?$/);
      expect(c.httpOnly).toBe(true);
      expect(c.sameSite).toBe("Lax");
    }
    expect([...foreign].filter((h) => !h.startsWith("127.0.0.1:54321")), "owners' pages talk to this site (and at most the auth host)").toEqual([]);
  });
});

test.describe("accepting a new version of the terms (CMP-03)", () => {
  test("an owner who has not accepted the current versions is taken to the acceptance page; accepting records them; a newer version asks again", async ({ page, context }) => {
    const b = await makeBusiness("barber");
    await loginAs(page, b.ownerEmail);
    const uid = sql(`select user_id from public.business_members where business_id='${b.id}' limit 1`);
    const rows = () => sql(`select doc || ':' || version from public.legal_acceptances where user_id='${uid}' order by doc, version`);

    // the gate is off by default outside production: the normal flow is not interrupted
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/dashboard$/);

    await context.setExtraHTTPHeaders({ "x-test-legal-gate": "on" });
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/legal\/accept$/);
    await expect(page.getByTestId("legal-accept")).toBeVisible();
    await expect(page.getByTestId("legal-link-terms")).toHaveAttribute("href", "/terms");
    await expect(page.getByTestId("legal-link-privacy")).toHaveAttribute("href", "/privacy");
    expect((await axe(page)).violations).toEqual([]);
    await noOverflow(page);
    await page.screenshot({ path: `test-results/legal-accept-${test.info().project.name}.png`, fullPage: true });
    // other owner pages are gated the same way
    await page.goto("/reports");
    await expect(page).toHaveURL(/\/legal\/accept$/);

    // submitting without agreeing records nothing and says why
    await page.getByTestId("legal-submit").click();
    await expect(page.getByTestId("legal-error")).toBeVisible();
    expect(rows()).toBe("");

    // agreeing records the CURRENT versions (the version comes from the server, not the form) and continues
    await page.getByTestId("legal-agree").check();
    await page.getByTestId("legal-submit").click();
    await expect(page).toHaveURL(/\/dashboard$/);
    expect(rows()).toBe("privacy:2026-10-12\nterms:2026-10-12");
    await page.goto("/reports");
    await expect(page).toHaveURL(/\/reports$/);

    // a newer version (simulated: the old acceptance is all that is on record) asks again, and history is kept
    sql(`update public.legal_acceptances set version = '2026-01-01' where user_id='${uid}' and doc='terms'`);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/legal\/accept$/);
    await page.getByTestId("legal-agree").check();
    await page.getByTestId("legal-submit").click();
    await expect(page).toHaveURL(/\/dashboard$/);
    expect(rows()).toBe("privacy:2026-10-12\nterms:2026-01-01\nterms:2026-10-12");

    // the page is closed to people who are not signed in; the API is not blocked by the gate (it guards the screens)
    const anon = await context.browser()!.newContext();
    const ap = await anon.newPage();
    await ap.goto("/legal/accept");
    await expect(ap).toHaveURL(/\/auth\/login/);
    await anon.close();
  });
});
