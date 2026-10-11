import Link from "next/link";
import { getTranslations } from "next-intl/server";

export const metadata = { title: "תנאי שימוש" };

// Placeholder until the legal text is drafted with counsel (docs/05 §10, stage 10).
export default async function Page() {
  const t = await getTranslations("legal");
  return (
    <main id="main" className="mx-auto max-w-2xl px-5 py-16">
      <h1 className="text-3xl font-bold">{t("termsTitle")}</h1>
      <p className="mt-3 text-muted-foreground">{t("placeholder")}</p>
      <Link href="/" className="mt-6 inline-block font-medium text-primary underline underline-offset-4">{t("home")}</Link>
    </main>
  );
}
