import { BellRing, CalendarCheck } from "lucide-react";

/** What a customer sees on the booking page, drawn with plain markup (decorative for assistive technology: the text beside it says the same). No invented customers or numbers. */
export function BookingPreview({ business, service, pick, confirm, notice }: { business: string; service: string; pick: string; confirm: string; notice: string }) {
  const times = ["09:00", "09:30", "10:30", "11:00", "13:00", "14:30"];
  return (
    <div className="relative mx-auto w-full max-w-sm pb-10" aria-hidden data-testid="booking-preview">
      <div className="rounded-2xl border bg-card p-6 shadow-pop">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CalendarCheck className="size-5" />
          </span>
          <div>
            <p className="text-sm text-muted-foreground">{business}</p>
            <p className="font-semibold">{service}</p>
          </div>
        </div>
        <p className="mb-2 text-sm font-medium">{pick}</p>
        <div className="grid grid-cols-3 gap-2 text-center text-sm font-medium tabular-nums">
          {times.map((h, i) => (
            <span key={h} className={i === 2 ? "rounded-lg bg-primary py-2.5 text-primary-foreground" : "rounded-lg border py-2.5"}>
              {h}
            </span>
          ))}
        </div>
        <p className="mt-5 rounded-lg bg-primary py-3 text-center text-sm font-semibold text-primary-foreground">{confirm}</p>
      </div>
      <div className="absolute -bottom-0 start-4 flex items-center gap-2.5 rounded-xl border bg-background px-4 py-3 text-sm font-medium shadow-pop">
        <BellRing className="size-4 text-primary" />
        {notice}
      </div>
    </div>
  );
}
