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

// Each status = soft background + AA-checked foreground + an icon-free text label,
// so meaning never relies on colour alone (WCAG 1.4.1).
const STYLES: Record<AppointmentStatus, string> = {
  pending: "bg-warning-soft text-warning-soft-foreground",
  confirmed: "bg-success-soft text-success-soft-foreground",
  completed: "bg-info-soft text-info-soft-foreground",
  noShow: "bg-destructive-soft text-destructive-soft-foreground",
  cancelled: "bg-neutral-soft text-neutral-soft-foreground line-through decoration-1",
  cancellationRequested: "bg-warning-soft text-warning-soft-foreground",
  available: "bg-success-soft text-success-soft-foreground",
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
  return (
    <Badge variant="outline" className={cn("border-transparent font-medium", STYLES[status], className)} data-status={status}>
      {label}
    </Badge>
  );
}
