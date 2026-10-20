import { getTranslations } from "next-intl/server";
import { LEGAL } from "@/lib/legal/config";

/** Who runs the service and how to reach them. Shown on the privacy and terms pages; an unset contact is a visible placeholder, never an invented address. */
export async function Operator() {
  const t = await getTranslations("legal.operator");
  const contact = LEGAL.contact;
  return (
    <section aria-labelledby="operator-h" className="grid gap-2 rounded-lg border bg-card p-4" data-testid="operator">
      <h2 id="operator-h" className="text-xl font-semibold">{t("title")}</h2>
      <p>{t("name", { name: LEGAL.operator.name })}</p>
      <p>
        <span className="font-semibold">{t("contact")}: </span>
        {contact ? <a href={`mailto:${contact}`} className="underline underline-offset-4" dir="ltr">{contact}</a> : <span className="text-warning-soft-foreground" data-placeholder>{t("placeholder")}</span>}
      </p>
    </section>
  );
}
