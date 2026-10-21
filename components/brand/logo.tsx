import { BRAND } from "@/config/brand";
import { cn } from "@/lib/utils";

/** Calendar-check mark. Decorative: the wordmark carries the accessible name. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-8", className)} fill="none">
      <rect x="2" y="5" width="28" height="25" rx="7" className="fill-primary" />
      <rect x="9" y="2" width="3" height="7" rx="1.5" className="fill-primary" />
      <rect x="20" y="2" width="3" height="7" rx="1.5" className="fill-primary" />
      <path d="M10.5 18.5 14.5 22.5 22 14.5" stroke="var(--primary-foreground)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 font-bold tracking-tight", className)}>
      <LogoMark />
      <span className="text-lg">{BRAND.name}</span>
    </span>
  );
}
