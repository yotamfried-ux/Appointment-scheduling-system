import { expect, test, type Page } from "@playwright/test";
import { admin, firstDayWithSlots, loginAs, makeBusiness, publicBook, sql } from "./helpers/business";
import { auth, byType, drain, mail, rows } from "./helpers/outbox";

// NSH-01/02/06 and NTF-09/11 on the real stack: the customer says "I am coming", the owner is told about the ones who have not, overdue visits can close themselves,
// and a daily digest arrives only when there is something to say and never at night.
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
type Booked = { id: string; manageUrl: string };
const runJob = (page: Page, now: Date) => page.request.post(`/api/jobs/reminders?now=${encodeURIComponent(now.toISOString())}`, { headers: auth });
const resetBucket = () => sql(`delete from public.job_runs where job_name = 'reminders'`);

test.describe("attendance confirmation (NSH-01/02)", () => {
  test("the customer confirms with one tap: the status is untouched, the page remembers, a second tap changes nothing, a forged link does nothing", async ({ page, request }) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b);
    const a = (await publicBook(request, b, f.date, f.times[0], 1, 0, mail())) as unknown as Booked;
    await page.goto(a.manageUrl);
    await noOverflow(page);
    await page.getByTestId("attend-confirm").click();
    await expect(page.getByTestId("attend-confirmed")).toBeVisible();
    await expect(page.getByTestId("attend-confirm")).toHaveCount(0);
    const row = (await admin().from("appointments").select("status, attendance_confirmed_at").eq("id", a.id).single()).data!;
    expect(row.status).toBe("confirmed");
    expect(row.attendance_confirmed_at).not.toBeNull();
    await page.reload();
    await expect(page.getByTestId("attend-confirmed")).toBeVisible();
    expect((await admin().from("appointments").select("attendance_confirmed_at").eq("id", a.id).single()).data!.attendance_confirmed_at).toBe(row.attendance_confirmed_at); // unchanged
    await page.goto(`/booking/garbage/reschedule`);
    await expect(page.getByTestId("manage-invalid")).toBeVisible();
  });

  test("the owner is alerted once about a visit nobody confirmed, not about a confirmed one, not when switched off", async ({ page, request }) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b);
    const unconfirmed = (await publicBook(request, b, f.date, f.times[0], 1, 0, mail())) as unknown as Booked;
    const confirmed = (await publicBook(request, b, f.date, f.times[3], 2, 0, mail())) as unknown as Booked;
    sql(`update public.appointments set attendance_confirmed_at = now() where id = '${confirmed.id}'`);
    const starts = new Date((await admin().from("appointments").select("starts_at").eq("id", unconfirmed.id).single()).data!.starts_at);
    const now = new Date(starts.getTime() - 60 * 60_000);

    resetBucket();
    expect((await runJob(page, now)).status()).toBe(200);
    expect(sql(`select count(*) from public.notification_log where business_id='${b.id}' and type='owner_unconfirmed'`), "off by default").toBe("0");

    sql(`update public.businesses set attendance_alert_minutes = 120 where id='${b.id}'`);
    resetBucket();
    await runJob(page, now);
    resetBucket();
    await runJob(page, new Date(now.getTime() + 5 * 60_000)); // the job runs every 5 minutes
    await drain(request, async () => byType(await rows(b), "owner_unconfirmed").some((r) => r.status === "sent"));
    const alerts = byType(await rows(b), "owner_unconfirmed");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ appointment_id: unconfirmed.id, recipient: "owner", status: "sent" });
    expect(alerts[0].preview!.subject).not.toMatch(/לקוח בדיקה/); // no customer name in the subject
  });
});

test.describe("overdue visits and the digest (NSH-06, NTF-09/11)", () => {
  test("an overdue visit is completed by itself only when the business chose that, after the chosen number of hours, and never as a no-show", async ({ page, request }) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b);
    const old = (await publicBook(request, b, f.date, f.times[0], 1, 0, mail())) as unknown as Booked;
    const recent = (await publicBook(request, b, f.date, f.times[4], 2, 0, mail())) as unknown as Booked;
    const mv = (id: string, hours: number) => sql(`set session_replication_role = replica; update public.appointments set starts_at = now() - interval '${hours} hours', ends_at = now() - interval '${hours} hours' + interval '30 minutes', blocked_until = now() - interval '${hours} hours' + interval '30 minutes' where id = '${id}'; set session_replication_role = origin;`);
    mv(old.id, 30); mv(recent.id, 3);
    resetBucket(); await runJob(page, new Date());
    expect(sql(`select status from public.appointments where id='${old.id}'`), "off by default").toBe("confirmed");
    await loginAs(page, b.ownerEmail);
    await page.goto("/settings/booking");
    await page.getByTestId("rules-auto-complete").fill("24");
    await page.getByTestId("rules-save").click();
    await expect(page.getByTestId("rules-status")).toHaveText("נשמר.");
    resetBucket(); await runJob(page, new Date());
    expect(sql(`select status from public.appointments where id='${old.id}'`)).toBe("completed");
    expect(sql(`select status from public.appointments where id='${recent.id}'`)).toBe("confirmed");
    expect(sql(`select count(*) from public.audit_log where business_id='${b.id}' and action='appointments.auto_completed'`)).toBe("1");
  });

  test("the digest: opt-in, once per local day, only between 07:00 and 21:00, never empty; it counts tomorrow's visits and links to the calendar", async ({ page, request }) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b);
    await publicBook(request, b, f.date, f.times[1], 1, 0, mail());
    const noon = (d: string, h: number) => new Date(`${sql(`select to_char(((('${d}'::date + interval '${h} hours') at time zone 'Asia/Jerusalem') at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`)}`); // local wall-clock hour h on day d
    const dayBefore = sql(`select ('${f.date}'::date - 1)::text`);
    resetBucket(); await runJob(page, noon(dayBefore, 12));
    expect(sql(`select count(*) from public.notification_log where business_id='${b.id}' and type='owner_digest'`), "opt-in").toBe("0");

    await loginAs(page, b.ownerEmail);
    await page.goto("/settings/booking");
    await page.getByTestId("rules-digest").selectOption("daily");
    await page.getByTestId("rules-save").click();
    await expect(page.getByTestId("rules-status")).toHaveText("נשמר.");
    resetBucket(); await runJob(page, noon(dayBefore, 4)); // 04:00 local
    resetBucket(); await runJob(page, noon(dayBefore, 22)); // 22:00 local
    expect(sql(`select count(*) from public.notification_log where business_id='${b.id}' and type='owner_digest'`), "quiet hours").toBe("0");
    resetBucket(); await runJob(page, noon(dayBefore, 12));
    resetBucket(); await runJob(page, noon(dayBefore, 13)); // same local day
    await drain(request, async () => byType(await rows(b), "owner_digest").some((r) => r.status === "sent"));
    const d = byType(await rows(b), "owner_digest");
    expect(d).toHaveLength(1);
    expect(d[0].preview!.text).toContain("תורים מחר: 1");
    expect(d[0].preview!.text).toContain("/dashboard");

    // a business with nothing to report gets nothing
    const quiet = await makeBusiness("barber");
    sql(`update public.businesses set digest_frequency='daily' where id='${quiet.id}'`);
    resetBucket(); await runJob(page, noon(dayBefore, 12));
    expect(sql(`select count(*) from public.notification_log where business_id='${quiet.id}' and type='owner_digest'`)).toBe("0");
  });
});
