import { LabGate } from "@/components/lab/lab-gate";
import { OnboardingWizard } from "@/components/lab/onboarding/onboarding-wizard";

export const metadata = { title: "אונבורדינג (אב-טיפוס)", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <LabGate>
      <OnboardingWizard />
    </LabGate>
  );
}
