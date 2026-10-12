"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

// What a person sees when a page fails to render (for example while the database does not answer). Friendly, no internals; the digest is a harmless id support can look up.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("errors");
  return (
    <main id="main" className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-3 px-4 text-center" data-testid="error-page">
      <h1 className="text-2xl font-bold tracking-tight text-balance">{t("title")}</h1>
      <p className="text-muted-foreground">{t("desc")}</p>
      {error.digest ? <p className="text-xs text-muted-foreground">{t("code")}: <bdi dir="ltr" className="font-mono">{error.digest}</bdi></p> : null}
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={reset} data-testid="error-retry">{t("retry")}</Button>
        <Button asChild variant="outline"><Link href="/">{t("home")}</Link></Button>
      </div>
    </main>
  );
}
