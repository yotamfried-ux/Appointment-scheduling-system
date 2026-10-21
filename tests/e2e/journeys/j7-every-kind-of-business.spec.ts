import { expect, test } from "@playwright/test";
import { BUSINESS_KINDS, KIND_IDS } from "../../../modules/tenancy/business-kind";
import { admin, loginAs, makeBusiness } from "../helpers/business";
import { mail } from "../helpers/outbox";
import { axe, customerOnPhone, noOverflow, ownerAtDesk } from "./world";

// JOURNEY 7 — the product is for six kinds of small businesses. For each, a customer on a phone books through the page (with that kind's own required questions,
// vocabulary and privacy rules), and the owner sees that exact booking, with the answers, in her calendar.
test.use({ actionTimeout: 20_000 });

for (const kind of KIND_IDS) {
  test(`${kind}: a customer books with this kind's questions and the owner sees it`, async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    const k = BUSINESS_KINDS[kind];
    const b = await makeBusiness(kind);
    const desk = await ownerAtDesk(browser, baseURL!);
    const phone = await customerOnPhone(browser, baseURL!);
    const who = `לקוח ${kind}`;

    await phone.page.goto(`/book/${b.slug}`);
    await expect(phone.page.getByTestId("business-name")).toBeVisible();
    await phone.page.getByTestId(`service-${b.services[0].id}`).check({ force: true });
    await phone.page.getByTestId("continue").click();
    await phone.page.getByRole("button", { name: /הזמן הפנוי הראשון/ }).click();
    const date = (await phone.page.locator('input[name="day"]:checked').getAttribute("data-testid"))!.replace("day-", "");
    await phone.page.getByTestId("continue").click();
    await phone.page.locator('input[name="time"]').first().check({ force: true });
    await phone.page.getByTestId("continue").click();
    await phone.page.getByLabel("שם מלא").fill(who);
    await phone.page.getByLabel("טלפון נייד").fill("050-7770001");
    await phone.page.getByLabel(/אימייל/).fill(mail());
    for (const f of k.intake.filter((x) => x.required)) {
      const el = phone.page.getByTestId(`intake-${f.id}`);
      if (f.type === "select") await el.selectOption(f.options![0]);
      else await el.fill("תשובה לבדיקה");
    }
    await noOverflow(phone.page);
    expect((await axe(phone.page)).violations).toEqual([]);
    await phone.page.getByTestId("continue").click();
    await expect(phone.page.getByTestId("done-title")).toBeVisible();
    const row = (await admin().from("appointments").select("id, status, intake").eq("business_id", b.id).single()).data!;
    expect(row.status).toBe(k.defaults.requireApproval ? "pending" : "confirmed");
    for (const f of k.intake.filter((x) => x.required)) expect(Object.keys(row.intake as object)).toContain(f.id);

    await loginAs(desk.page, b.ownerEmail);
    await desk.page.goto("/dashboard");
    await desk.page.getByTestId("day-input").fill(date);
    await expect(desk.page.getByText(who).first()).toBeVisible();
    await noOverflow(desk.page);
    await desk.ctx.close();
    await phone.ctx.close();
  });
}
