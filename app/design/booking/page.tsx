import { BookingFlow } from "@/components/lab/booking/booking-flow";
import { LabGate } from "@/components/lab/lab-gate";

export const metadata = { title: "הזמנה (אב-טיפוס)", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <LabGate>
      <BookingFlow />
    </LabGate>
  );
}
