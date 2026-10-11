import { ArrowLeft, Palette } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AuthButton } from "@/components/auth-button";
import { Logo } from "@/components/brand/logo";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Button } from "@/components/ui/button";

export default async function Home() {
  const t = await getTranslations("home");
  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b bg-card/60 backdrop-blur">
        <nav className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-5">
          <Link href="/" className="rounded-md">
            <Logo />
          </Link>
          <Suspense>
            <AuthButton />
          </Suspense>
        </nav>
      </header>
      <main id="main" className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center gap-5 px-5 py-16 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl">{t("title")}</h1>
        <p className="max-w-xl text-lg text-balance text-muted-foreground">{t("subtitle")}</p>
        <div className="mt-2 flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center">
          <Button asChild size="lg">
            <Link href="/auth/login">
              {t("cta")}
              <ArrowLeft aria-hidden className="rtl:rotate-0 ltr:rotate-180" />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/design">
              <Palette aria-hidden />
              {t("designLab")}
            </Link>
          </Button>
        </div>
      </main>
      <footer className="flex items-center justify-center gap-4 border-t py-5">
        <ThemeSwitcher />
      </footer>
    </div>
  );
}
