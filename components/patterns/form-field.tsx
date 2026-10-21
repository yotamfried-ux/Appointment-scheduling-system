import { useId } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface FieldA11y {
  id: string;
  "aria-invalid": boolean | undefined;
  "aria-describedby": string | undefined;
}

/**
 * Visible label + hint + error wired with aria-describedby / aria-invalid (docs: UX forms).
 * Errors live next to the field, never only in a banner.
 */
export function FormField({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  className?: string;
  children: (a11y: FieldA11y) => React.ReactNode;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("grid gap-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {error ? (
        <p id={errorId} role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
