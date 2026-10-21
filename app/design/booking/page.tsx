import { BookingFlow } from "@/components/lab/booking/booking-flow";
import { LabGate } from "@/components/lab/lab-gate";
import { kindFromParam } from "@/modules/tenancy/business-kind";

export const metadata = { title: "הזמנה (אב-טיפוס)", robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ kind?: string; session?: string; limit?: string }> }) {
  const q = await searchParams;
  const limit = Number(q.limit);
  return (
    <LabGate>
      <BookingFlow kind={kindFromParam(q.kind)} session={q.session} limit={Number.isInteger(limit) && limit > 0 ? limit : undefined} />
    </LabGate>
  );
}
