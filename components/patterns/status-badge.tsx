import { Check, CircleOff, Clock, UserX, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type AppointmentStatus =
  | "pending"
  | "confirmed"
  | "completed"
  | "noShow"
  | "cancelled"
  | "cancellationRequested"
  | "available";

// One colour rule: status is never told by colour. Every status is the same quiet outline pill; the meaning is the word,
// and each exception also carries its own icon or line-through (WCAG 1.4.1). The brand colour stays for what is selected or next.
const ICONS: Record<AppointmentStatus, LucideIcon | null> = {
  pending: Clock,
  confirmed: Check,
  completed: Check,
  noShow: UserX,
  cancelled: CircleOff,
  cancellationRequested: Clock,
  available: null,
};

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: AppointmentStatus;
  label: string;
  className?: string;
}) {
  const Icon = ICONS[status];
  return (
    <Badge
      variant="outline"
      className={cn("border-border bg-transparent font-medium text-foreground", status === "cancelled" && "text-muted-foreground line-through decoration-1", className)}
      data-status={status}
    >
      {Icon ? <Icon aria-hidden="true" /> : null}
      {label}
    </Badge>
  );
}
