import { LegalPage } from "@/components/legal/legal-page";
import { PRIVACY } from "@/lib/legal/content";
import { LEGAL } from "@/lib/legal/config";

export const metadata = { title: "מדיניות פרטיות", alternates: { canonical: "/privacy" } };

export default function Page() {
  return <LegalPage testId="privacy" title="מדיניות פרטיות" version={LEGAL.privacy.version} effective={LEGAL.privacy.effective} sections={PRIVACY} />;
}
