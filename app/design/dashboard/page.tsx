import { DashboardView } from "@/components/lab/dashboard/dashboard-view";
import { LabGate } from "@/components/lab/lab-gate";
import { kindFromParam } from "@/modules/tenancy/business-kind";

export const metadata = { title: "דשבורד בעלים (אב-טיפוס)", robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ kind?: string; session?: string }> }) {
  const q = await searchParams;
  return (
    <LabGate>
      <DashboardView kind={kindFromParam(q.kind)} session={q.session} />
    </LabGate>
  );
}
