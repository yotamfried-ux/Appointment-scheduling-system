import { getTranslations } from "next-intl/server";
import { ConsentPreferences } from "@/components/legal/consent-banner";
import { LegalPage } from "@/components/legal/legal-page";
import { COOKIES_ESSENTIAL } from "@/lib/legal/content";
import { LEGAL } from "@/lib/legal/config";

export const metadata = { title: "עוגיות" };

export default async function Page() {
  const t = await getTranslations("legal.cookiesPage");
  return (
    <LegalPage testId="cookies" title={t("title")} version={LEGAL.cookies.version} effective={LEGAL.cookies.effective} sections={[{ id: "summary", title: t("summaryTitle"), body: [t("summary")] }]}>
      <section aria-labelledby="essential-h" className="grid gap-3" id="essential">
        <h2 id="essential-h" className="text-xl font-semibold">{t("essentialTitle")}</h2>
        <p>{t("essentialIntro")}</p>
        <ul className="grid gap-3" data-testid="cookie-list">
          {COOKIES_ESSENTIAL.map((c) => (
            <li key={c.name} className="rounded-lg border bg-card p-4 text-sm">
              <p className="font-mono font-semibold" dir="ltr">{c.name}</p>
              <p className="mt-1">{c.purpose}</p>
              <p className="mt-1 text-muted-foreground">{t("duration")}: {c.duration}</p>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="optional-h" className="grid gap-3" id="optional">
        <h2 id="optional-h" className="text-xl font-semibold">{t("optionalTitle")}</h2>
        <ConsentPreferences />
      </section>
    </LegalPage>
  );
}
