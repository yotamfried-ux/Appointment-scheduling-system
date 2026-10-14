import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

// A mistyped or outdated address: say so plainly and offer the two places a person may have wanted (no raw code, no dead end).
export default async function NotFound() {
  const t = await getTranslations("errors");
  return (
    <main id="main" className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 px-4 text-center" data-testid="not-found">
      <Link href="/" className="rounded-md"><Logo /></Link>
      <h1 className="text-2xl font-bold tracking-tight text-balance">{t("notFoundTitle")}</h1>
      <p className="text-muted-foreground text-pretty">{t("notFoundDesc")}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild><Link href="/">{t("home")}</Link></Button>
        <Button asChild variant="outline"><Link href="/auth/login">{t("toLogin")}</Link></Button>
      </div>
    </main>
  );
}
