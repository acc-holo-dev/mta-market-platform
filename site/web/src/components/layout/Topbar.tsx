// PLAN-015 §7: Topbar — продуктивная контрольная панель.
// Состав: burger (mobile) · SidebarToggle · Logo · GlobalSearch ·
// ContextCreate · Live · Theme · Notifications · Account+Balance.
// Каждый элемент имеет назначение; без декоративных иконок (§7).
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Bell, Gauge, LogOut, PanelLeft } from "lucide-react";
import { useAuthStore } from "@/store/auth";
import { fetchNotifications } from "@/lib/api-ext";
import { GlobalSearch } from "@/components/search/GlobalSearch";
import { ContextCreate } from "@/components/layout/ContextCreate";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { LiveChip } from "@/components/layout/LiveChip";
import { SidebarDrawer } from "@/components/layout/Sidebar";

export function Topbar({ onToggleSidebar }: { onToggleSidebar?: () => void }) {
  const pathname = usePathname();
  const { user, accessToken } = useAuthStore();
  const authed = accessToken !== null && Boolean(user);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const quickLogout = () => {
    useAuthStore.getState().clearAuth();
    // Hard navigation (как в PLAN-002 Navbar): гарантированный выход без
    // гонок клиентского роутера (E2E полагается на «Войти» после выхода).
    window.location.assign("/");
  };

  // Unread badge (reuse PLAN-005 M).
  const { data: notifData } = useQuery({
    queryKey: ["notifications", "badge"],
    queryFn: () => fetchNotifications("unread"),
    enabled: authed,
    staleTime: 60_000,
    retry: false,
    refetchInterval: 120_000,
  });
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line bg-background/85 backdrop-blur-md">
        <div className="flex h-14 items-center gap-3 px-3 sm:px-4">
          {/* Sidebar toggle — desktop; burger — mobile */}
          {onToggleSidebar ? (
            <button
              type="button"
              onClick={onToggleSidebar}
              aria-label="Показать или скрыть меню"
              className="hidden h-9 w-9 items-center justify-center rounded-md text-content-secondary transition-colors duration-fast hover:bg-surface-hover hover:text-content lg:inline-flex"
            >
              <PanelLeft className="h-[18px] w-[18px]" aria-hidden />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Открыть меню"
            aria-expanded={drawerOpen}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-content-secondary transition-colors duration-fast hover:bg-surface-hover hover:text-content lg:hidden"
          >
            <Gauge className="h-5 w-5" aria-hidden />
          </button>

          <Link
            href="/"
            className="flex flex-shrink-0 items-center gap-2"
            aria-label="MTA Market — на главную"
          >
            <span className="text-base font-extrabold tracking-tight sm:text-lg">
              MTA&nbsp;<span className="mta-brand-text-gradient">MARKET</span>
            </span>
          </Link>

          {/* Global search — основная ширина topbar */}
          <div className="ml-1 hidden flex-1 justify-center md:flex">
            <GlobalSearch />
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            {authed ? <ContextCreate /> : null}
            <LiveChip />
            <ThemeToggle />
            {authed ? (
              <Link
                href="/notifications"
                className="relative hidden h-9 w-9 items-center justify-center rounded-md text-content-secondary transition-colors duration-fast hover:bg-surface-hover hover:text-content sm:inline-flex"
                aria-label={`Уведомления${notifData?.unreadCount ? ` (${notifData.unreadCount} непрочитанных)` : ""}`}
                title="Уведомления"
              >
                <Bell className="h-[18px] w-[18px]" aria-hidden />
                {notifData && notifData.unreadCount > 0 ? (
                  <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-on-accent tabular-nums">
                    {notifData.unreadCount > 9 ? "9+" : notifData.unreadCount}
                  </span>
                ) : null}
              </Link>
            ) : null}
            {/* Быстрый выход — стабильная видимая кнопка (E2E + клавиатура) */}
            {authed ? (
              <button
                type="button"
                onClick={quickLogout}
                aria-label="Выход"
                title="Выйти"
                className="hidden h-9 w-9 items-center justify-center rounded-md text-content-secondary transition-colors duration-fast hover:bg-surface-hover hover:text-content md:inline-flex"
              >
                <LogOut className="h-[18px] w-[18px]" aria-hidden />
                <span className="sr-only">Выход</span>
              </button>
            ) : null}
            <AccountMenu />
          </div>
        </div>
      </header>

      <SidebarDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}
