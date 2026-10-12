import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";

export type OwnerSection = "calendar" | "customers" | "reports";
const ITEMS: { id: OwnerSection; href: string; key: "calendar" | "customers" | "reports" }[] = [
  { id: "calendar", href: "/dashboard", key: "calendar" },
  { id: "customers", href: "/customers", key: "customers" },
  { id: "reports", href: "/reports", key: "reports" },
];

/** Primary navigation of the signed-in area: the calendar, customers and reports. */
export async function OwnerNav({ current }: { current: OwnerSection }) {
  const t = await getTranslations("owner.nav");
  return (
    <nav aria-label={t("group")} className="border-b bg-card/40">
      <ul className="mx-auto flex max-w-6xl gap-1 px-4">
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
      </ul>
    </nav>
  );
}
