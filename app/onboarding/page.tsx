import { redirect } from "next/navigation";
import { OnboardingWizard } from "@/components/lab/onboarding/onboarding-wizard";
import { siteHost } from "@/lib/site";
import { requireUser } from "@/lib/auth/session";
import { listMyBusinesses } from "@/modules/tenancy/service";
import { createBusinessAction } from "@/app/onboarding/actions";

export const metadata = { title: "הגדרת העסק", robots: { index: false, follow: false } };

export default async function OnboardingPage() {
  const { supabase, claims } = await requireUser();
  if ((await listMyBusinesses(supabase)).length > 0) redirect("/dashboard");
  return <OnboardingWizard host={await siteHost()} onFinish={createBusinessAction} email={String(claims.email ?? "")} />;
}
