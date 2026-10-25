import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { LogoutButton } from "@/components/logout-button";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { BRAND } from "@/config/brand";

/** The wide measure of the working pages (calendar, customers, reports): fills a laptop screen, stays readable on a very wide one. */
export const WIDE = "max-w-[88rem]";

const PLATFORM_ADMIN_EMAIL = "yotam.fried@gmail.com";

/** Signed-in chrome shared by owner pages (same header geometry as onboarding): logo at the start, account actions at the end. */
export function AppShell({
  email,
  userEmail,
  isPlatformAdmin,
  children,
  width = "max-w-2xl",
  nav,
}: {
  email?: string;
  userEmail?: string;
  isPlatformAdmin?: boolean;
  children: React.ReactNode;
  width?: string;
  nav?: React.ReactNode;
}) {
  const isAdmin =
    isPlatformAdmin ||
    userEmail?.trim().toLowerCase() === PLATFORM_ADMIN_EMAIL ||
    email?.trim().toLowerCase() === PLATFORM_ADMIN_EMAIL;

  return (
    <div className="min-h-svh">
      <header className="border-b bg-card/60 backdrop-blur">
        <div className={`mx-auto flex h-14 items-center justify-between gap-3 px-4 sm:px-6 lg:px-8 ${width}`}>
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="shrink-0 rounded-md" aria-label={BRAND.name}>
              <Logo />
            </Link>
            {isAdmin ? (
              <Link
                href="/admin"
                className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
                data-testid="nav-platform-admin"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                לוח מנהל פלטפורמה
              </Link>
            ) : null}
          </div>
          <div className="flex min-w-0 items-center gap-3">
            {email ? (
              <bdi className="hidden min-w-0 truncate rounded-md border bg-muted/50 px-2.5 py-1 text-xs font-medium text-foreground sm:block" data-testid="whoami">
                {email}
              </bdi>
            ) : null}
            <ThemeSwitcher />
            <LogoutButton />
          </div>
        </div>
      </header>
      {nav}
      <main id="main" className={`mx-auto w-full space-y-6 px-4 py-8 sm:px-6 lg:px-8 ${width}`}>
        {children}
      </main>
    </div>
  );
}
