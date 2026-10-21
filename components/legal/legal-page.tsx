import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LegalFooter } from "@/components/legal/legal-footer";
import type { LegalSection } from "@/lib/legal/content";

/** Shared frame for the legal pages: title, version, an unmissable "draft" notice, a table of contents and the sections. */
export async function LegalPage({ title, version, effective, sections, children, testId }: { title: string; version: string; effective: string; sections: LegalSection[]; children?: React.ReactNode; testId: string }) {
  const t = await getTranslations("legal");
  return (
    <div className="min-h-svh">
      <main id="main" className="mx-auto grid w-full max-w-2xl gap-6 px-5 py-12" data-testid={testId}>
        <header className="grid gap-2">
          <Link href="/" className="inline-flex min-h-11 w-fit items-center text-sm font-medium text-primary underline-offset-4 hover:underline">{t("home")}</Link>
          <h1 className="text-3xl font-bold tracking-tight text-balance">{title}</h1>
          <p className="text-sm text-muted-foreground" data-testid="legal-version">{t("version", { version, date: effective })}</p>
        </header>
        <p role="note" className="rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm font-medium text-warning-soft-foreground" data-testid="legal-draft">{t("draft")}</p>
        {sections.length > 3 ? (
          <nav aria-label={t("toc")} className="rounded-lg border bg-card p-4">
            <p className="mb-1 text-sm font-semibold">{t("toc")}</p>
            <ol className="grid gap-0.5 ps-5 text-sm [list-style:decimal]">
              {sections.map((s) => (
                <li key={s.id}><a href={`#${s.id}`} className="inline-flex min-h-8 items-center text-primary underline-offset-4 hover:underline">{s.title}</a></li>
              ))}
            </ol>
          </nav>
        ) : null}
        {sections.map((s) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-h`} className="grid scroll-mt-6 gap-2">
            <h2 id={`${s.id}-h`} className="text-xl font-semibold">{s.title}</h2>
            {s.body.map((b, i) =>
              Array.isArray(b) ? (
                <ul key={i} className="grid gap-1 ps-5 [list-style:disc]">{b.map((li) => <li key={li}>{li}</li>)}</ul>
              ) : (
                <p key={i} className="leading-relaxed">{b}</p>
              ),
            )}
          </section>
        ))}
        {children}
      </main>
      <LegalFooter />
    </div>
  );
}
