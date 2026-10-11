import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/patterns/page-header";
import { createClient } from "@/lib/supabase/server";

// Placeholder: real dashboard arrives in stage 5. Auth is enforced in proxy.ts
// AND re-checked here (defense in depth, docs/05 §4.2).
export default async function DashboardPage() {
  const t = await getTranslations("dashboard");
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/auth/login");

  return (
    <main id="main" className="mx-auto max-w-5xl space-y-4 p-5">
      <PageHeader title={t("title")} description={t("placeholder")} />
      <p className="text-sm text-muted-foreground">
        <bdi data-testid="whoami">{String(data.claims.email ?? "")}</bdi>
      </p>
    </main>
  );
}
