"use client";

import { BarChart3, CalendarDays, ChevronsUpDown, LayoutDashboard, LogOut, Settings, Users, Hourglass, CreditCard } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { LogoMark } from "@/components/brand/logo";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { BRAND } from "@/config/brand";

export function AppSidebar({ waitlistCount }: { waitlistCount: number }) {
  const t = useTranslations("owner");
  const items = [
    { key: "today", icon: LayoutDashboard, active: true },
    { key: "calendar", icon: CalendarDays },
    { key: "customers", icon: Users },
    { key: "waitlist", icon: Hourglass, badge: waitlistCount },
    { key: "stats", icon: BarChart3 },
    { key: "settings", icon: Settings },
  ] as const;

  return (
    <Sidebar side="right" collapsible="icon">
      <SidebarHeader>
        <Link href="/design/dashboard" className="flex h-10 items-center gap-2.5 overflow-hidden rounded-md px-1.5 font-bold" aria-label={BRAND.name}>
          <LogoMark className="size-7 shrink-0" />
          <span className="truncate text-base group-data-[collapsible=icon]:hidden">{BRAND.name}</span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t("nav.group")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.key}>
                  <SidebarMenuButton asChild isActive={"active" in item} tooltip={t(`nav.${item.key}`)}>
                    <a href={"active" in item ? "#main" : "#"} aria-current={"active" in item ? "page" : undefined} onClick={(e) => !("active" in item) && e.preventDefault()}>
                      <item.icon aria-hidden />
                      <span>{t(`nav.${item.key}`)}</span>
                    </a>
                  </SidebarMenuButton>
                  {"badge" in item && item.badge > 0 ? <SidebarMenuBadge>{item.badge}</SidebarMenuBadge> : null}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" aria-label={t("account.menu")} className="data-[state=open]:bg-sidebar-accent">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-foreground text-sm font-bold text-background" aria-hidden>ה</span>
              <span className="grid min-w-0 flex-1 text-start leading-tight">
                <span className="truncate text-sm font-semibold">מספרת הדר</span>
                <span className="truncate text-xs text-muted-foreground">{t("account.trial")}</span>
              </span>
              <ChevronsUpDown className="ms-auto size-4 text-muted-foreground" aria-hidden />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="min-w-56">
            <DropdownMenuItem><Settings aria-hidden />{t("account.profile")}</DropdownMenuItem>
            <DropdownMenuItem><CreditCard aria-hidden />{t("account.billing")}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive"><LogOut aria-hidden />{t("account.signOut")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
