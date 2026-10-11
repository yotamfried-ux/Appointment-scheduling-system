import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { LogoutButton } from "@/components/logout-button";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { BRAND } from "@/config/brand";

/** Signed-in chrome shared by owner pages (same header geometry as onboarding): logo at the start, account actions at the end. */
export function AppShell({ email, children, width = "max-w-2xl" }: { email?: string; children: React.ReactNode; width?: string }) {
  return (
    <div className="min-h-svh">
      <header className="border-b bg-card/60 backdrop-blur">
        <div className={`mx-auto flex h-14 items-center justify-between gap-3 px-4 ${width}`}>
          <Link href="/dashboard" className="shrink-0 rounded-md" aria-label={BRAND.name}>
            <Logo />
          </Link>
          <div className="flex min-w-0 items-center gap-3">
            {email ? <bdi className="hidden min-w-0 truncate text-sm text-muted-foreground sm:block" data-testid="whoami">{email}</bdi> : null}
            <ThemeSwitcher />
            <LogoutButton />
          </div>
        </div>
      </header>
      <main id="main" className={`mx-auto w-full space-y-6 px-4 py-8 ${width}`}>
        {children}
      </main>
    </div>
  );
}
