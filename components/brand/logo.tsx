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

export function Logo({ className, showSubtitle = false }: { className?: string; showSubtitle?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-3 tracking-tight", className)}>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] border bg-card">
        <svg className="size-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </span>
      <span className="grid leading-tight">
        <span className="text-sm font-bold">{BRAND.name}</span>
        {showSubtitle ? <span className="text-xs font-normal text-muted-foreground">{BRAND.tagline}</span> : null}
      </span>
    </span>
  );
}
