import Link from "next/link";
import { getTranslations } from "next-intl/server";

/** Links every public page carries: nobody has to hunt for the privacy policy, the terms, the cookies page or the accessibility statement. */
export async function LegalFooter() {
  const t = await getTranslations("legal.footer");
  const items = [["/privacy", t("privacy")], ["/terms", t("terms")], ["/cookies", t("cookies")], ["/accessibility", t("accessibility")]] as const;
  return (
    <footer className="border-t" data-testid="legal-footer">
      <nav aria-label={t("label")} className="mx-auto flex max-w-3xl flex-wrap justify-center gap-x-5 gap-y-1 px-4 py-4 text-sm">
        {items.map(([href, label]) => (
          <Link key={href} href={href} className="inline-flex min-h-11 items-center text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">{label}</Link>
        ))}
      </nav>
    </footer>
  );
}
