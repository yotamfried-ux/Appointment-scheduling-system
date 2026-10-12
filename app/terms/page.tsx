import { LegalPage } from "@/components/legal/legal-page";
import { TERMS } from "@/lib/legal/content";
import { LEGAL } from "@/lib/legal/config";

export const metadata = { title: "תנאי שימוש" };

export default function Page() {
  return <LegalPage testId="terms" title="תנאי שימוש" version={LEGAL.terms.version} effective={LEGAL.terms.effective} sections={TERMS} />;
}
