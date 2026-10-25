import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { checkSession } from "@/lib/auth/live-session";
import { isPlatformAdmin, getDashboardMetrics, listBusinesses, getSystemErrors } from "@/modules/admin/service";
import { AppShell, WIDE } from "@/components/app-shell";
import { OwnerNav } from "@/components/owner/owner-nav";
import { AdminDashboardClient } from "./admin-dashboard-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export const metadata = {
  title: "לוח מנהל פלטפורמה · ניהול יומן ותורים",
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const gate = claimsData?.claims ? await checkSession(supabase, claimsData.claims) : null;

  if (!gate?.live) {
    redirect("/auth/login?next=/admin");
  }

  const { data: userData } = await supabase.auth.getUser();
  const userEmail = userData.user?.email ?? "";

  const isAdmin = await isPlatformAdmin(supabase);
  if (!isAdmin) {
    return (
      <AppShell email={userEmail} width="max-w-xl">
        <Card className="mt-12 text-right" dir="rtl">
          <CardHeader>
            <CardTitle className="text-xl text-destructive">גישה חסומה (403 Forbidden)</CardTitle>
            <CardDescription>
              לוח הניהול מוגבל למפעיל הפלטפורמה (yotam.fried@gmail.com) בלבד.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              התחברת עם החשבון <span className="font-semibold text-foreground">{userEmail}</span>, שאינו מוגדר כמנהל מערכת.
            </p>
            <div className="flex gap-3">
              <Button asChild variant="outline">
                <Link href="/dashboard">חזרה ליומן שלי</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  const [metrics, businesses, errors] = await Promise.all([
    getDashboardMetrics(supabase),
    listBusinesses(supabase, { limit: 100 }),
    getSystemErrors(supabase, 50),
  ]);

  const deploymentCommit =
    process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
    "cd648d1";

  return (
    <AppShell email={userEmail} userEmail={userEmail} isPlatformAdmin={true} width={WIDE} nav={<OwnerNav current="admin" />}>
      <AdminDashboardClient
        metrics={metrics}
        businesses={businesses}
        errors={errors}
        operatorEmail={userEmail}
        deploymentCommit={deploymentCommit}
      />
    </AppShell>
  );
}
