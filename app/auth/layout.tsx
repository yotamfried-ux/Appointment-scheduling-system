import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/brand/logo";
import { ProductPeek } from "@/components/brand/product-peek";
import { BRAND } from "@/config/brand";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("authShell");
  return (
    <div className="grid min-h-svh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="flex flex-col px-5 py-6 sm:px-10 sm:py-10">
        <Link href="/" className="w-fit rounded-md" aria-label={BRAND.name}>
          <Logo />
        </Link>
        <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
          {children}
        </main>
      </div>
      <aside className="dark relative hidden bg-background text-foreground lg:flex lg:flex-col lg:justify-between lg:px-14 lg:py-12" aria-label={t("aside")}>
        <p className="text-sm font-medium text-muted-foreground">{t("eyebrow")}</p>
        <div className="grid gap-10">
          <h2 className="max-w-lg text-5xl leading-[1.1] font-bold tracking-tight text-balance">{t("headline")}</h2>
          <div className="max-w-lg">
            <ProductPeek title={t("peekTitle")} dayLabel={t("peekDay")} />
          </div>
        </div>
        <p className="max-w-md text-base text-muted-foreground">{t("footnote")}</p>
      </aside>
    </div>
  );
}
