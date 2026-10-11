import Link from "next/link";
import { CalendarCheck, Clock, ShieldCheck } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/brand/logo";
import { BRAND } from "@/config/brand";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("authShell");
  return (
    <div className="grid min-h-svh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="flex flex-col px-5 py-6 sm:px-10 sm:py-10">
        <Link href="/" className="w-fit rounded-md" aria-label={BRAND.name}>
          <Logo />
        </Link>
        <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
          {children}
        </main>
      </div>
      <aside className="relative hidden overflow-hidden bg-primary text-primary-foreground lg:flex lg:flex-col lg:justify-center lg:px-16" aria-hidden="true">
        <div className="pointer-events-none absolute -end-24 -top-24 size-96 rounded-full bg-primary-foreground/10" />
        <div className="pointer-events-none absolute -start-16 bottom-0 size-72 rounded-full bg-primary-foreground/10" />
        <h2 className="relative max-w-md text-4xl leading-tight font-bold text-balance">{t("headline")}</h2>
        <ul className="relative mt-10 grid max-w-md gap-6">
          {[
            { icon: CalendarCheck, text: t("point1") },
            { icon: Clock, text: t("point2") },
            { icon: ShieldCheck, text: t("point3") },
          ].map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-4">
              <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-foreground/15">
                <Icon className="size-5" />
              </span>
              <span className="text-lg/relaxed">{text}</span>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
