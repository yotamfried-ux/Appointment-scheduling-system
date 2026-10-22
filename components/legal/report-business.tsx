import { getTranslations } from "next-intl/server";
import { LEGAL } from "@/lib/legal/config";

/** "Report this business" on a booking page: it lives on our domain, so anyone who thinks the page is not what it claims to be can tell us (docs/05 §5.11). Not shown while no contact address is configured. */
export async function ReportBusiness({ slug }: { slug: string }) {
  const contact = LEGAL.contact;
  if (!contact) return null;
  const t = await getTranslations("legal.report");
  return (
    <p className="pb-4 text-center text-sm" data-testid="report-business">
      <a href={`mailto:${contact}?subject=${encodeURIComponent(t("subject", { slug }))}`} className="inline-flex min-h-11 items-center text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">{t("label")}</a>
    </p>
  );
}
