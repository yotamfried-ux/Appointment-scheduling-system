import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth/auth-card";
import { ResendConfirmation } from "@/components/auth/resend-confirmation";
import { Button } from "@/components/ui/button";

// Only a fixed set of reasons is rendered — never reflect arbitrary query text (docs/05 §5.5).
const REASONS = new Set(["expired"]);

export default async function Page({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const t = await getTranslations("auth.error");
  const { reason } = await searchParams;
  const expired = Boolean(reason && REASONS.has(reason));
  const body = expired ? t("linkExpired") : t("unspecified");
  return (
    <AuthCard title={expired ? t("expiredTitle") : t("title")} description={body}>
      {expired ? <ResendConfirmation /> : null}
      <Button asChild size="lg">
        <Link href="/auth/login">{t("toLogin")}</Link>
      </Button>
    </AuthCard>
  );
}
