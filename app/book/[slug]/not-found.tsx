import { getTranslations } from "next-intl/server";

export default async function NotFound() {
  const t = await getTranslations("public");
  return (
    <main id="main" className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-2 px-4 text-center" data-testid="booking-closed">
      <h1 className="text-2xl font-bold">{t("closed")}</h1>
      <p className="text-muted-foreground">{t("closedHint")}</p>
    </main>
  );
}
