import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/server";
import { isPlatformAdmin } from "@/modules/admin/service";

export type OwnerSection = "calendar" | "customers" | "reports" | "settings" | "admin";
const ITEMS: { id: OwnerSection; href: string; key: "calendar" | "customers" | "reports" | "settings" }[] = [
  { id: "calendar", href: "/dashboard", key: "calendar" },
  { id: "customers", href: "/customers", key: "customers" },
  { id: "reports", href: "/reports", key: "reports" },
  { id: "settings", href: "/settings/services", key: "settings" },
];

/** Primary navigation of the signed-in area: the calendar, customers, reports and platform admin if authorized. */
export async function OwnerNav({ current }: { current: OwnerSection }) {
  const t = await getTranslations("owner.nav");
  const supabase = await createClient();
  const isAdmin = await isPlatformAdmin(supabase).catch(() => false);

  return (
    <nav aria-label={t("group")} className="border-b bg-card/40">
      <ul className="mx-auto flex max-w-[88rem] gap-1 px-4 sm:px-6 lg:px-8">
        {ITEMS.map((i) => (
          <li key={i.id}>
            <Link
              href={i.href}
              aria-current={i.id === current ? "page" : undefined}
              data-testid={`nav-${i.id}`}
              className={cn(
                "inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium transition-colors",
                i.id === current ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t(i.key)}
            </Link>
          </li>
        ))}
        {isAdmin ? (
          <li>
            <Link
              href="/admin"
              aria-current={current === "admin" ? "page" : undefined}
              data-testid="nav-admin"
              className={cn(
                "inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-semibold transition-colors gap-2",
                current === "admin"
                  ? "border-primary text-foreground"
                  : "border-transparent text-primary hover:text-primary/80",
              )}
            >
              <span className="flex h-2 w-2 rounded-full bg-emerald-500" />
              לוח מנהל
            </Link>
          </li>
        ) : null}
      </ul>
    </nav>
  );
}
