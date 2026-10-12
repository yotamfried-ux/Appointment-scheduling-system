import { getTranslations } from "next-intl/server";
import { LegalPage } from "@/components/legal/legal-page";
import { A11Y } from "@/lib/legal/content";
import { LEGAL } from "@/lib/legal/config";

export const metadata = { title: "הצהרת נגישות" };

export default async function Page() {
  const t = await getTranslations("legal.a11y");
  const contact = LEGAL.accessibilityContact;
  return (
    <LegalPage testId="accessibility" title={t("title")} version={LEGAL.accessibility.version} effective={LEGAL.accessibility.effective} sections={A11Y}>
      <p className="text-sm text-muted-foreground" data-testid="a11y-review">{t("review", { date: LEGAL.accessibility.lastReview })}</p>
      <p className="rounded-lg border bg-card p-4 text-sm" data-testid="a11y-contact">
        <span className="font-semibold">{t("coordinator")}: </span>
        {contact ? <a href={`mailto:${contact}`} className="underline underline-offset-4" dir="ltr">{contact}</a> : <span className="text-warning-soft-foreground" data-placeholder>{t("placeholder")}</span>}
      </p>
    </LegalPage>
  );
}
