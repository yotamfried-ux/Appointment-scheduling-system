import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/brand/logo";
import { Check } from "lucide-react";
import { BRAND } from "@/config/brand";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("authShell");
  return (
    <div className="grid min-h-svh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="flex flex-col px-5 py-6 sm:px-10 sm:py-10">
        <div className="mx-auto w-full max-w-md">
          <Link href="/" className="block w-fit rounded-md" aria-label={BRAND.name}>
            <Logo />
          </Link>
        </div>
        <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col justify-start py-8 sm:justify-center sm:py-10">
          {children}
        </main>
      </div>
      <aside className="dark relative hidden bg-background text-foreground lg:flex lg:flex-col lg:justify-between lg:px-14 lg:py-12" aria-label={t("aside")}>
        <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-between">
          <p className="text-sm font-medium text-muted-foreground">{t("eyebrow")}</p>
          <div className="grid gap-10">
            <h2 className="text-5xl leading-[1.1] font-bold tracking-tight text-balance">{t("headline")}</h2>
            <ul className="grid gap-6" data-testid="auth-benefits">
              {(t.raw("benefits") as { title: string; body: string }[]).map((b) => (
                <li key={b.title} className="flex items-start gap-4">
                  <span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground" aria-hidden>
                    <Check className="size-4" strokeWidth={3} />
                  </span>
                  <div>
                    <p className="text-lg font-semibold">{b.title}</p>
                    <p className="text-muted-foreground">{b.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-base text-muted-foreground">{t("footnote")}</p>
        </div>
      </aside>
    </div>
  );
}
