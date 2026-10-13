"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/settings/services", key: "services" },
  { href: "/settings/hours", key: "hours" },
  { href: "/settings/team", key: "team" },
  { href: "/settings/booking", key: "booking" },
  { href: "/settings/billing", key: "billing" },
  { href: "/settings/security", key: "security" },
  { href: "/settings/account", key: "account" },
] as const;

/** Section tabs for owner settings. A real <nav> of links (not ARIA tabs): each section is its own page. */
export function SettingsNav() {
  const t = useTranslations("settings.nav");
  const path = usePathname();
  return (
    <nav aria-label={t("label")} className="-mx-1 overflow-x-auto">
      <ul className="flex gap-1 border-b px-1">
        {ITEMS.map((i) => {
          const active = path === i.href;
          return (
            <li key={i.href}>
              <Link
                href={i.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex min-h-11 items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors",
                  active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {t(i.key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
