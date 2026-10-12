import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { acceptLegalAction } from "@/app/legal/accept/actions";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { ACCEPTED_DOCS, LEGAL } from "@/lib/legal/config";
import { missingAcceptances } from "@/lib/legal/gate";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "עדכון תנאים", robots: { index: false, follow: false } };

// Reachable only when signed in (proxy.ts), and deliberately NOT behind the gate it serves.
export default async function AcceptPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const t = await getTranslations("legal.accept");
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/auth/login");
  if ((await missingAcceptances(supabase)).length === 0) redirect("/dashboard");
  const { error } = await searchParams;
  return (
    <div className="min-h-svh">
      <header className="border-b bg-card/60"><div className="mx-auto flex h-14 max-w-lg items-center px-4"><Logo /></div></header>
      <main id="main" className="mx-auto grid w-full max-w-lg gap-5 px-4 py-10" data-testid="legal-accept">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground">{t("intro")}</p>
        <ul className="divide-y rounded-lg border bg-card">
          {ACCEPTED_DOCS.map((d) => (
            <li key={d} className="flex flex-wrap items-center justify-between gap-2 p-4">
              <Link href={`/${d}`} target="_blank" className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4" data-testid={`legal-link-${d}`}>{t(d)}</Link>
              <span className="text-sm text-muted-foreground">{t("version", { version: LEGAL[d].version })}</span>
            </li>
          ))}
        </ul>
        <form action={acceptLegalAction} className="grid gap-4">
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" name="agree" value="yes" className="mt-0.5 size-5" aria-describedby={error ? "accept-error" : undefined} data-testid="legal-agree" />
            <span>{t("check")}</span>
          </label>
          {error ? <p id="accept-error" role="alert" className="text-sm font-medium text-destructive" data-testid="legal-error">{t("required")}</p> : null}
          <div><Button type="submit" data-testid="legal-submit">{t("submit")}</Button></div>
        </form>
      </main>
    </div>
  );
}
