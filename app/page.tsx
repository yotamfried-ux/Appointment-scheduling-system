import { ArrowLeft, Bell, CalendarCheck, Check, ChevronDown, Hourglass, ShieldCheck, Smartphone, UserX, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { AuthButton } from "@/components/auth-button";
import { Logo } from "@/components/brand/logo";
import { BookingPreview } from "@/components/brand/booking-preview";
import { LegalFooter } from "@/components/legal/legal-footer";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Button } from "@/components/ui/button";
import { BUSINESS_KINDS, KIND_IDS } from "@/modules/tenancy/business-kind";

const FEATURE_ICONS = [Smartphone, Bell, Hourglass, Users, UserX, ShieldCheck] as const;

type Step = { title: string; body: string };
type Item = { title: string; body: string };
type Faq = { q: string; a: string };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("home");
  const title = "תורים · הזמנת תורים אונליין לעסק שלך"; // the browser tab: short and says what the product is
  const description = t("hero.subtitle");
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: "/" },
    openGraph: { type: "website", locale: "he_IL", siteName: "תורים", title, description, url: "/" },
  };
}

export default async function Home() {
  const t = await getTranslations("home");
  const steps = t.raw("how.steps") as Step[];
  const features = t.raw("features.items") as Item[];
  const faq = t.raw("faq.items") as Faq[];

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <nav className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-5" aria-label={t("nav.how")}>
          <Link href="/" className="rounded-md">
            <Logo />
          </Link>
          <div className="hidden items-center gap-6 text-sm font-medium text-muted-foreground md:flex">
            <a href="#how" className="rounded-md hover:text-foreground">{t("nav.how")}</a>
            <a href="#customer-title" className="rounded-md hover:text-foreground">{t("nav.customer")}</a>
          </div>
          <div className="flex items-center gap-2">
            <Suspense>
              <AuthButton />
            </Suspense>
          </div>
        </nav>
      </header>

      <main id="main" className="flex-1">
        {/* hero */}
        <section className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 py-14 sm:py-20 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <div className="grid gap-6">
            <p className="text-sm font-semibold text-primary">{t("hero.eyebrow")}</p>
            <h1 className="text-4xl leading-[1.12] font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl" data-testid="home-title">{t("hero.title")}</h1>
            <p className="max-w-xl text-lg leading-relaxed text-pretty text-muted-foreground">{t("hero.subtitle")}</p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button asChild size="lg">
                <Link href="/auth/sign-up" data-testid="home-cta">
                  {t("hero.cta")}
                  <ArrowLeft aria-hidden className="rtl:rotate-0 ltr:rotate-180" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href="#how">{t("hero.ctaSecondary")}</a>
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">{t("hero.fine")}</p>
            <p className="text-sm">
              <Link href="/auth/login" className="font-semibold text-primary underline underline-offset-4">{t("hero.login")}</Link>
            </p>
          </div>
          <div className="mx-auto w-full max-w-md lg:max-w-none">
            <BookingPreview business={t("customer.mockBusiness")} service={t("customer.mockService")} pick={t("customer.mockPick")} confirm={t("customer.mockConfirm")} notice={t("hero.notice")} />
          </div>
        </section>

        {/* who it is for */}
        <section aria-labelledby="for-title" className="border-y bg-card/50">
          <div className="mx-auto grid w-full max-w-6xl gap-6 px-5 py-12">
            <div className="grid gap-2">
              <h2 id="for-title" className="text-2xl font-bold tracking-tight sm:text-3xl">{t("for.title")}</h2>
              <p className="max-w-2xl text-muted-foreground">{t("for.subtitle")}</p>
            </div>
            <ul className="flex flex-wrap gap-2.5" data-testid="home-kinds">
              {KIND_IDS.filter((k) => k !== "other").map((k) => (
                <li key={k} className="rounded-full border bg-background px-4 py-2 text-sm font-medium">{BUSINESS_KINDS[k].label}</li>
              ))}
            </ul>
          </div>
        </section>

        {/* how it works */}
        <section id="how" aria-labelledby="how-title" className="mx-auto w-full max-w-6xl scroll-mt-20 px-5 py-16">
          <h2 id="how-title" className="mb-8 text-2xl font-bold tracking-tight sm:text-3xl">{t("how.title")}</h2>
          <ol className="grid gap-4 md:grid-cols-3">
            {steps.map((s, i) => (
              <li key={s.title} className="grid content-start gap-3 rounded-lg border bg-card p-6">
                <span className="flex size-9 items-center justify-center rounded-full bg-primary text-base font-bold text-primary-foreground" aria-hidden>{i + 1}</span>
                <h3 className="text-lg font-semibold">{s.title}</h3>
                <p className="leading-relaxed text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* features */}
        <section aria-labelledby="features-title" className="border-y bg-card/50">
          <div className="mx-auto w-full max-w-6xl px-5 py-16">
            <h2 id="features-title" className="mb-8 text-2xl font-bold tracking-tight sm:text-3xl">{t("features.title")}</h2>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f, i) => {
                const Icon = FEATURE_ICONS[i] ?? CalendarCheck;
                return (
                  <li key={f.title} className="grid content-start gap-3 rounded-lg border bg-background p-6">
                    <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden>
                      <Icon className="size-5" />
                    </span>
                    <h3 className="text-base font-semibold">{f.title}</h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">{f.body}</p>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* what the customer sees */}
        <section aria-labelledby="customer-title" className="mx-auto grid w-full max-w-6xl items-center gap-10 px-5 py-16 lg:grid-cols-2">
          <div className="grid gap-4">
            <h2 id="customer-title" className="text-2xl font-bold tracking-tight sm:text-3xl">{t("customer.title")}</h2>
            <p className="leading-relaxed text-muted-foreground">{t("customer.body")}</p>
            <ul className="grid gap-2 text-sm">
              {(t.raw("customer.points") as string[]).map((pt) => (
                <li key={pt} className="flex items-start gap-2">
                  <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                  {pt}
                </li>
              ))}
            </ul>
          </div>
          <ul className="mx-auto grid w-full max-w-sm gap-3" aria-hidden data-testid="customer-mock">
            {(t.raw("customer.messages") as { when: string; text: string }[]).map((m) => (
              <li key={m.text} className="rounded-xl border bg-card px-4 py-3 shadow-sm">
                <p className="text-xs text-muted-foreground">{m.when}</p>
                <p className="mt-0.5 text-sm font-medium">{m.text}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* faq */}
        <section aria-labelledby="faq-title" className="border-y bg-card/50">
          <div className="mx-auto w-full max-w-3xl px-5 py-16">
            <h2 id="faq-title" className="mb-6 text-2xl font-bold tracking-tight sm:text-3xl">{t("faq.title")}</h2>
            <div className="divide-y overflow-hidden rounded-lg border bg-background">
              {faq.map((f) => (
                <details key={f.q} className="group px-5 py-4">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-semibold [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
                  </summary>
                  <p className="pt-2 leading-relaxed text-muted-foreground">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* final call */}
        <section className="mx-auto grid w-full max-w-3xl justify-items-center gap-4 px-5 py-16 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-balance sm:text-4xl">{t("final.title")}</h2>
          <Button asChild size="lg">
            <Link href="/auth/sign-up">
              {t("final.cta")}
              <ArrowLeft aria-hidden className="rtl:rotate-0 ltr:rotate-180" />
            </Link>
          </Button>
          <p className="text-sm text-muted-foreground">{t("final.fine")}</p>
        </section>
      </main>

      <footer className="flex items-center justify-center gap-4 border-t py-5">
        <ThemeSwitcher />
      </footer>
      <LegalFooter />
    </div>
  );
}
