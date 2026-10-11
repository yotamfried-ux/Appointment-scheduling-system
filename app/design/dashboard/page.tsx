import { DashboardView } from "@/components/lab/dashboard/dashboard-view";
import { LabGate } from "@/components/lab/lab-gate";

export const metadata = { title: "דשבורד בעלים (אב-טיפוס)", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <LabGate>
      <DashboardView />
    </LabGate>
  );
}
