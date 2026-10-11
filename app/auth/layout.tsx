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
        <div className="mx-auto w-full max-w-md">
          <Link href="/" className="block w-fit rounded-md" aria-label={BRAND.name}>
            <Logo />
          </Link>
        </div>
        <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
          {children}
        </main>
      </div>
      <aside className="dark relative hidden bg-background text-foreground lg:flex lg:flex-col lg:justify-between lg:px-14 lg:py-12" aria-label={t("aside")}>
        <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-between">
          <p className="text-sm font-medium text-muted-foreground">{t("eyebrow")}</p>
          <div className="grid gap-10">
            <h2 className="text-5xl leading-[1.1] font-bold tracking-tight text-balance">{t("headline")}</h2>
            <ProductPeek title={t("peekTitle")} dayLabel={t("peekDay")} />
          </div>
          <p className="text-base text-muted-foreground">{t("footnote")}</p>
        </div>
      </aside>
    </div>
  );
}
