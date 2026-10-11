import { CalendarDays, LayoutDashboard, Rocket } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LabGate } from "@/components/lab/lab-gate";
import { StyleguideDemos } from "@/components/lab/styleguide-demos";
import { PageHeader } from "@/components/patterns/page-header";
import { ThemeSwitcher } from "@/components/theme-switcher";

export const metadata = { title: "מעבדת עיצוב", robots: { index: false, follow: false } };

const SWATCHES = [
  ["background", "רקע"], ["card", "כרטיס"], ["primary", "ראשי"], ["secondary", "משני"], ["accent", "הדגשה"], ["muted", "עמום"],
  ["success", "הצלחה"], ["warning", "אזהרה"], ["destructive", "הרסני"], ["info-soft", "מידע"], ["neutral-soft", "נייטרלי"], ["border", "גבול"],
] as const;

const TYPE = [
  ["text-4xl font-bold", "כותרת ראשית"], ["text-2xl font-bold", "כותרת משנית"], ["text-lg font-semibold", "כותרת קטנה"],
  ["text-base", "טקסט גוף — הוא קריא ומרווח, 16px לפחות."], ["text-sm text-muted-foreground", "טקסט משני ותיאורים"],
] as const;

export default async function DesignLab() {
  const t = await getTranslations("lab");
  const screens = [
    { href: "/design/booking", title: t("booking"), desc: t("bookingDesc"), icon: CalendarDays },
    { href: "/design/dashboard", title: t("dashboard"), desc: t("dashboardDesc"), icon: LayoutDashboard },
    { href: "/design/onboarding", title: t("onboarding"), desc: t("onboardingDesc"), icon: Rocket },
  ];
  return (
    <LabGate>
      <main id="main" className="mx-auto grid w-full max-w-5xl gap-12 px-5 py-10">
        <div className="flex items-start justify-between gap-4">
          <PageHeader title={t("title")} description={t("subtitle")} />
          <ThemeSwitcher />
        </div>

        <section aria-labelledby="lab-screens" className="grid gap-4">
          <h2 id="lab-screens" className="text-xl font-bold">{t("screens")}</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {screens.map(({ href, title, desc, icon: Icon }) => (
              <Link key={href} href={href} className="group rounded-xl border bg-card p-5 shadow-card transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-pop">
                <span className="mb-3 flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground"><Icon className="size-5" aria-hidden /></span>
                <span className="block font-semibold">{title}</span>
                <span className="block text-sm text-muted-foreground">{desc}</span>
              </Link>
            ))}
          </div>
        </section>

        <section aria-labelledby="lab-tokens" className="grid gap-4">
          <h2 id="lab-tokens" className="text-xl font-bold">{t("tokens")}</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {SWATCHES.map(([token, label]) => (
              <li key={token} className="overflow-hidden rounded-lg border bg-card text-sm">
                <div className="h-14" style={{ background: `var(--${token})` }} />
                <div className="p-2"><p className="font-medium">{label}</p><p className="font-mono text-xs text-muted-foreground"><bdi>--{token}</bdi></p></div>
              </li>
            ))}
          </ul>
          <div className="grid gap-2 rounded-xl border bg-card p-5">
            {TYPE.map(([cls, text]) => <p key={cls} className={cls}>{text}</p>)}
          </div>
        </section>

        <section aria-labelledby="lab-components" className="grid gap-4">
          <h2 id="lab-components" className="text-xl font-bold">{t("components")}</h2>
          <StyleguideDemos />
        </section>
      </main>
    </LabGate>
  );
}
