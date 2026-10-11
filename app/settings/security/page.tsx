import { getTranslations } from "next-intl/server";
import { MfaEnroll } from "@/app/settings/security/mfa-enroll";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/patterns/page-header";
import { requireUser } from "@/lib/auth/session";

export const metadata = { title: "אבטחת החשבון", robots: { index: false, follow: false } };

export default async function SecurityPage() {
  const t = await getTranslations("auth.mfa");
  const { supabase, claims } = await requireUser();
  const { data } = await supabase.auth.mfa.listFactors();
  const enrolled = (data?.totp ?? []).some((f) => f.status === "verified");
  return (
    <AppShell email={String(claims.email ?? "")}>
      <PageHeader title={t("settingsTitle")} />
      <section className="rounded-lg border bg-card p-5 sm:p-6">
        <MfaEnroll enrolled={enrolled} />
      </section>
    </AppShell>
  );
}
