import { getTranslations } from "next-intl/server";
import { MfaEnroll } from "@/app/settings/security/mfa-enroll";
import { PageHeader } from "@/components/patterns/page-header";
import { requireUser } from "@/lib/auth/session";

export const metadata = { title: "אבטחת החשבון", robots: { index: false, follow: false } };

export default async function SecurityPage() {
  const t = await getTranslations("auth.mfa");
  const { supabase } = await requireUser();
  const { data } = await supabase.auth.mfa.listFactors();
  const enrolled = (data?.totp ?? []).some((f) => f.status === "verified");
  return (
    <main id="main" className="mx-auto max-w-xl space-y-6 p-5">
      <PageHeader title={t("settingsTitle")} />
      <MfaEnroll enrolled={enrolled} />
    </main>
  );
}
