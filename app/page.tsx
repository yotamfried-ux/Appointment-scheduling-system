import { ArrowLeft, ChevronDown } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AuthButton } from "@/components/auth-button";
import { Logo } from "@/components/brand/logo";
import { LegalFooter } from "@/components/legal/legal-footer";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/config/brand";
import { BUSINESS_KINDS, KIND_IDS } from "@/modules/tenancy/business-kind";

type Step = { title: string; body: string };
type Item = { title: string; body: string };
type Faq = { q: string; a: string };
type Pillar = { code: string; title: string; body: string };
type Fact = { label: string; title: string; body: string };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("home");
  const title = "מערכת ניהול יומן ותורים";
  const description = t("hero.subtitle");
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: "/" },
    openGraph: { type: "website", locale: "he_IL", siteName: BRAND.name, title, description, url: "/" },
  };
}

export default async function Home() {
  const t = await getTranslations("home");
  const steps = t.raw("how.steps") as Step[];
  const features = t.raw("features.items") as Item[];
  const faq = t.raw("faq.items") as Faq[];
  const pillars = t.raw("why.pillars") as Pillar[];
  const facts = t.raw("hero.facts") as Fact[];

  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      {/* 1. TOP NAVIGATION BAR (Real Destinations Only) */}
      <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between gap-4 px-5 sm:px-8">
          <Link href="/" className="rounded-md">
            <Logo showSubtitle />
          </Link>

          <nav className="hidden items-center gap-7 text-xs font-medium text-muted-foreground md:flex" aria-label="ניווט ראשי">
            <a href="#why" className="rounded-md transition hover:text-foreground">{t("nav.why")}</a>
            <a href="#how" className="rounded-md transition hover:text-foreground">{t("nav.how")}</a>
            <a href="#capabilities" className="rounded-md transition hover:text-foreground">{t("nav.capabilities")}</a>
            <a href="#faq" className="rounded-md transition hover:text-foreground">{t("nav.faq")}</a>
          </nav>

          <div className="flex items-center gap-3">
            <Suspense>
              <AuthButton />
            </Suspense>
          </div>
        </div>
      </header>

      <main id="main" className="flex-1">
        {/* 2. HERO SECTION — SWISS EDITORIAL ASYMMETRIC HIERARCHY */}
        <section className="border-b">
          <div className="mx-auto grid w-full max-w-5xl grid-cols-1 items-end gap-10 px-5 py-12 sm:px-8 sm:py-16 lg:grid-cols-[1.25fr_0.75fr]">
            <div className="space-y-5">
              <p className="text-xs font-semibold tracking-wide text-primary">{t("hero.eyebrow")}</p>
              <h1
                className="text-3xl leading-[1.12] font-bold tracking-tight text-balance sm:text-5xl"
                data-testid="home-title"
              >
                {(() => {
                  const [first, ...rest] = t("hero.title").split(". ");
                  return rest.length ? (<>{first}.{" "}<br className="hidden sm:block" />{rest.join(". ")}</>) : first;
                })()}
              </h1>
              <p className="max-w-xl text-sm leading-relaxed text-pretty text-muted-foreground sm:text-base">
                {t("hero.subtitle")}
              </p>

              <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center">
                <Button asChild size="lg" className="font-bold">
                  <Link href="/auth/sign-up" data-testid="home-cta">
                    {t("hero.cta")}
                    <ArrowLeft aria-hidden className="rtl:rotate-0 ltr:rotate-180" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="font-semibold">
                  <a href="#how">{t("hero.ctaSecondary")}</a>
                </Button>
              </div>

              <p className="pt-1 text-xs text-muted-foreground">{t("hero.fine")}</p>
            </div>

            {/* Editorial Summary Column: Typography-Driven Key Facts (No cluttered fake UI) */}
            <div className="space-y-4 rounded-[14px] border bg-card p-5" data-testid="customer-mock">
              {facts.map((fact, idx) => (
                <div key={fact.title} className={idx < facts.length - 1 ? "border-b pb-3.5" : undefined}>
                  <div className="text-xs font-medium text-muted-foreground">{fact.label}</div>
                  <div className="mt-0.5 text-sm font-bold">{fact.title}</div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{fact.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 3. WHY SWITCH: ASYMMETRIC EDITORIAL SECTION (HAIRLINES INSTEAD OF BOXES) */}
        <section id="why" aria-labelledby="why-title" className="scroll-mt-16 border-b">
          <div className="mx-auto grid w-full max-w-5xl grid-cols-1 items-start gap-8 px-5 py-12 sm:px-8 lg:grid-cols-[0.8fr_1.2fr]">
            <div className="space-y-2">
              <p className="text-xs font-semibold text-primary">{t("why.eyebrow")}</p>
              <h2 id="why-title" className="text-xl font-bold tracking-tight sm:text-2xl">
                {t("why.title")}
              </h2>
              <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm">{t("why.subtitle")}</p>
            </div>

            <div className="divide-y">
              {pillars.map((pillar, idx) => (
                <div
                  key={pillar.code}
                  className={
                    idx === 0
                      ? "space-y-1.5 pb-5"
                      : idx === pillars.length - 1
                        ? "space-y-1.5 pt-5"
                        : "space-y-1.5 py-5"
                  }
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-sm font-bold sm:text-base">{pillar.title}</h3>
                    <span className="text-xs font-semibold text-primary">{pillar.code}</span>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm">{pillar.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* 4. WHO IT IS FOR (ADAPTIVE TO REAL BUSINESS KINDS IN THE CODEBASE) */}
        <section id="kinds" aria-labelledby="for-title" className="border-b bg-card">
          <div className="mx-auto flex w-full max-w-5xl flex-col justify-between gap-6 px-5 py-10 sm:px-8 md:flex-row md:items-center">
            <div className="max-w-xl space-y-1">
              <h2 id="for-title" className="text-lg font-bold tracking-tight sm:text-xl">
                {t("for.title")}
              </h2>
              <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm">{t("for.subtitle")}</p>
            </div>

            <ul className="flex flex-wrap gap-2 text-xs font-semibold" data-testid="home-kinds">
              {KIND_IDS.filter((k) => k !== "other").map((k) => (
                <li key={k} className="rounded-full border bg-background px-3.5 py-1.5">
                  {BUSINESS_KINDS[k].label}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 5. HOW IT WORKS (#how) — 3 STEPS */}
        <section id="how" aria-labelledby="how-title" className="scroll-mt-16 border-b">
          <div className="mx-auto w-full max-w-5xl px-5 py-12 sm:px-8">
            <div className="mb-8 space-y-2">
              <p className="text-xs font-semibold text-primary">{t("how.eyebrow")}</p>
              <h2 id="how-title" className="text-xl font-bold tracking-tight sm:text-2xl">
                {t("how.title")}
              </h2>
            </div>

            <ol className="grid grid-cols-1 gap-6 md:grid-cols-3">
              {steps.map((s, i) => (
                <li key={s.title} className="space-y-2.5 rounded-[14px] border bg-card p-5">
                  <span
                    className="inline-flex size-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
                    aria-hidden
                  >
                    {i + 1}
                  </span>
                  <h3 className="text-sm font-bold sm:text-base">{s.title}</h3>
                  <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* 6. CAPABILITIES GRID (#capabilities) — CLEAN HAIRLINE MATRIX */}
        <section id="capabilities" aria-labelledby="features-title" className="scroll-mt-16 border-b">
          <div className="mx-auto w-full max-w-5xl px-5 py-12 sm:px-8">
            <div className="mb-8 space-y-2">
              <p className="text-xs font-semibold text-primary">{t("features.eyebrow")}</p>
              <h2 id="features-title" className="text-xl font-bold tracking-tight sm:text-2xl">
                {t("features.title")}
              </h2>
            </div>

            <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f) => (
                <li key={f.title} className="space-y-1.5">
                  <h3 className="text-sm font-bold">{f.title}</h3>
                  <p className="text-xs leading-relaxed text-muted-foreground">{f.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 7. FAQ (#faq) — FACTUAL, HONEST ANSWERS */}
        <section id="faq" aria-labelledby="faq-title" className="scroll-mt-16 border-b bg-card">
          <div className="mx-auto w-full max-w-3xl space-y-6 px-5 py-12 sm:px-8">
            <h2 id="faq-title" className="text-xl font-bold tracking-tight sm:text-2xl">
              {t("faq.title")}
            </h2>

            <div className="divide-y overflow-hidden rounded-[14px] border bg-background">
              {faq.map((f) => (
                <details key={f.q} className="group p-4">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-xs font-bold sm:text-sm [&::-webkit-details-marker]:hidden">
                    <span>{f.q}</span>
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
                  </summary>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground sm:text-sm">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* 8. FINAL CALL TO ACTION (REAL ROUTES ONLY) */}
        <section className="mx-auto w-full max-w-3xl space-y-4 px-5 py-12 text-center sm:px-8">
          <h2 className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">{t("final.title")}</h2>
          <p className="mx-auto max-w-md text-xs text-muted-foreground sm:text-sm">{t("final.subtitle")}</p>
          <div className="flex flex-col items-center justify-center gap-3 pt-1 sm:flex-row">
            <Button asChild size="lg" className="font-bold">
              <Link href="/auth/sign-up">
                {t("final.cta")}
                <ArrowLeft aria-hidden className="rtl:rotate-0 ltr:rotate-180" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="font-semibold">
              <Link href="/auth/login">{t("final.login")}</Link>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("final.fine")}</p>
        </section>
      </main>

      <footer className="flex items-center justify-center gap-4 border-t py-5">
        <ThemeSwitcher />
      </footer>
      <LegalFooter />
    </div>
  );
}
