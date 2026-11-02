import { MapPin, Video } from "lucide-react";
import { cn } from "@/lib/utils";

export type AppointmentModality = "business" | "customer" | "online";

export function formatModalityLabel(location?: string | null): string {
  if (location === "online") return "אונליין";
  if (location === "customer") return "פרונטלי (אצל הלקוח)";
  return "פרונטלי";
}

export function ModalityBadge({
  location,
  size = "sm",
  className,
}: {
  location?: string | null;
  size?: "sm" | "md";
  className?: string;
}) {
  const mode: AppointmentModality =
    location === "online" ? "online" : location === "customer" ? "customer" : "business";
  const isOnline = mode === "online";
  const label = formatModalityLabel(mode);

  return (
    <span
      data-testid="modality-badge"
      data-modality={mode}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-medium whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs",
        isOnline
          ? "border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-300"
          : "border-emerald-600/25 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
        className,
      )}
    >
      {isOnline ? (
        <Video className="size-3.5 shrink-0" aria-hidden />
      ) : (
        <MapPin className="size-3.5 shrink-0" aria-hidden />
      )}
      <span>{label}</span>
    </span>
  );
}
