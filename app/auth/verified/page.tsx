import { CheckCircle2, Monitor, Smartphone } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AuthCard } from "@/components/auth/auth-card";
import { Button } from "@/components/ui/button";

export default async function Page() {
  const t = await getTranslations("auth.verified");
  return (
    <AuthCard title={t("title")} description={t("description")}>
      <div className="flex items-start gap-3 rounded-lg bg-emerald-500/10 p-4 text-emerald-800 dark:text-emerald-200">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
        <p className="text-sm font-medium">{t("body")}</p>
      </div>

      <div className="space-y-4">
        {/* Option 1: Continue on computer */}
        <div className="rounded-xl border border-border p-4 space-y-2 bg-card">
          <div className="flex items-center gap-2 font-semibold text-foreground">
            <Monitor className="size-5 text-primary shrink-0" aria-hidden />
            <h3>{t("computerTitle")}</h3>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">{t("computerDescription")}</p>
        </div>

        {/* Option 2: Continue on this device (phone/tablet) */}
        <div className="rounded-xl border border-border p-4 space-y-3 bg-card">
          <div className="flex items-center gap-2 font-semibold text-foreground">
            <Smartphone className="size-5 text-primary shrink-0" aria-hidden />
            <h3>{t("thisDeviceTitle")}</h3>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">{t("thisDeviceDescription")}</p>
          <Button asChild size="lg" className="w-full">
            <Link href="/dashboard">{t("continueThisDevice")}</Link>
          </Button>
        </div>
      </div>
    </AuthCard>
  );
}
