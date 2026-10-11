import { cn } from "@/lib/utils";

/**
 * Native radio wrapped in a card: real keyboard/AT semantics (arrow keys, grouping via <fieldset>),
 * with a large (≥44px) tappable surface. Selection never relies on colour alone: border + check mark.
 */
export function ChoiceCard({
  name,
  value,
  checked,
  onChange,
  disabled,
  className,
  children,
  testId,
  variant = "card",
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
  testId?: string;
  /** card: standalone · row: inside a divided list · chip: compact (times, days) */
  variant?: "card" | "row" | "chip";
}) {
  return (
    <label
      className={cn(
        "relative flex min-h-11 cursor-pointer items-center gap-3 text-start transition-[border-color,background-color,color,box-shadow] duration-150 ease-out",
        "has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/35 has-[:focus-visible]:z-10",
        "has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-45",
        variant === "card" &&
          "rounded-lg border bg-card p-4 hover:border-foreground/40 has-[:checked]:border-primary has-[:checked]:bg-accent has-[:disabled]:hover:border-border",
        variant === "chip" &&
          "justify-center rounded-md border border-input bg-card px-2 py-2.5 hover:border-foreground/50 has-[:checked]:border-primary has-[:checked]:bg-primary has-[:checked]:text-primary-foreground has-[:disabled]:hover:border-input",
        variant === "row" &&
          "px-4 py-4 hover:bg-muted/60 has-[:checked]:bg-accent before:absolute before:inset-y-0 before:start-0 before:w-1 before:bg-primary before:opacity-0 has-[:checked]:before:opacity-100",
        className,
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
        data-testid={testId}
        className="peer sr-only"
      />
      {children}
    </label>
  );
}
