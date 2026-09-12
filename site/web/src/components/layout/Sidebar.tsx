// PLAN-015 §6: Sidebar с двумя состояниями (expanded/collapsed).
// - Иконки-only в свёрнутом виде, tooltip при hover, без авто-расширения;
// - состояние персистентно (localStorage `mta-sidebar-collapsed`);
// - creator-секция только для реальных продавцов; admin — отдельно;
// - mobile (<lg): тот же nav внутри left-sheet drawer.
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Home,
  LayoutGrid,
  Server,
  MessagesSquare,
  Newspaper,
  UserPlus,
  Bell,
  Package,
  Briefcase,
  ReceiptText,
  BarChart3,
  ShieldCheck,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  type LucideIcon,
} from "lucide-react";
import { useAuthStore } from "@/store/auth";
import { fetchSellerProfile, fetchNotifications } from "@/lib/api-ext";
import { cn } from "@/lib/utils";

export const SIDEBAR_COLLAPSED_KEY = "mta-sidebar-collapsed";

export function readSidebarCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  } catch {
    return false;
  }
}

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Точное совпадение пути (для «/», «/notifications»), иначе startsWith. */
  exact?: boolean;
}

const PRIMARY_ITEMS: NavItem[] = [
  { href: "/", label: "Главная", icon: Home, exact: true },
  { href: "/resources", label: "Маркетплейс", icon: LayoutGrid },
  { href: "/servers", label: "Серверы", icon: Server },
  { href: "/community", label: "Сообщество", icon: MessagesSquare },
  { href: "/news", label: "Новости", icon: Newspaper },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname.startsWith(item.href);
}

interface SidebarNavProps {
  collapsed: boolean;
  onNavigate?: () => void;
}

export function SidebarNav({ collapsed, onNavigate }: SidebarNavProps) {
  const pathname = usePathname();
  const { user, accessToken } = useAuthStore();
  const authed = accessToken !== null && Boolean(user);

  // Creator-секция только для реальных продавцов (PLAN-015 §6).
  const { data: sellerProfile } = useQuery({
    queryKey: ["seller", "profile", "sidebar"],
    queryFn: fetchSellerProfile,
    enabled: authed,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const isSeller = Boolean(sellerProfile) || user?.role === "ADMIN";

  // Unread badge для «Уведомления» в сайдбаре.
  const { data: notifData } = useQuery({
    queryKey: ["notifications", "badge"],
    queryFn: () => fetchNotifications("unread"),
    enabled: authed,
    staleTime: 60_000,
    retry: false,
    refetchInterval: 120_000,
  });
  const unreadCount = notifData?.unreadCount ?? 0;

  const isAdmin = user?.role === "ADMIN" || user?.role === "MODERATOR";

  const secondaryItems: NavItem[] = [
    { href: "/me/following", label: "Подписки", icon: UserPlus },
    { href: "/notifications", label: "Уведомления", icon: Bell, exact: true },
  ];

  const creatorItems: NavItem[] = [
    { href: "/seller?tab=resources", label: "Мои ресурсы", icon: Package },
    { href: "/seller?tab=services", label: "Мои услуги", icon: Briefcase },
    { href: "/seller?tab=orders", label: "Заказы", icon: ReceiptText },
    { href: "/seller?tab=analytics", label: "Аналитика", icon: BarChart3 },
  ];

  const renderItem = (item: NavItem, active: boolean) => {
    const Icon = item.icon;
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          className={cn(
            "group/item relative flex items-center rounded-md text-sm font-medium transition-colors duration-fast",
            collapsed ? "h-10 w-10 justify-center" : "gap-3 px-3 py-2",
            active
              ? "bg-accent-soft text-content ring-1 ring-inset ring-line-accent/40"
              : "text-content-secondary hover:bg-surface-hover hover:text-content"
          )}
        >
          <Icon className="h-[18px] w-[18px] flex-shrink-0" aria-hidden />
          {!collapsed ? <span className="truncate">{item.label}</span> : null}
          {item.label === "Уведомления" && unreadCount > 0 ? (
            collapsed ? (
              <span
                aria-hidden
                className="absolute right-1.5 top-1.5 flex h-2 w-2 rounded-full bg-accent"
              />
            ) : (
              <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-on-accent tabular-nums">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )
          ) : null}
          {/* Tooltip в свёрнутом состоянии (PLAN-015 §6) */}
          {collapsed ? (
            <span
              role="tooltip"
              className="pointer-events-none absolute left-full z-50 ml-2 whitespace-nowrap rounded-md border border-line bg-surface-raised px-2.5 py-1.5 text-xs font-medium text-content opacity-0 shadow-raised transition-opacity duration-fast group-hover/item:opacity-100"
            >
              {item.label}
            </span>
          ) : null}
        </Link>
      </li>
    );
  };

  const renderSection = (label: string, items: NavItem[]) => (
    <div>
      {collapsed ? (
        <div className="mx-2 my-2 border-t border-line" aria-hidden />
      ) : (
        <p className="mb-1 mt-3 px-3 text-[11px] font-semibold uppercase tracking-wide text-content-muted">
          {label}
        </p>
      )}
      <ul className="space-y-0.5">{items.map((item) => renderItem(item, isActive(pathname, item)))}</ul>
    </div>
  );

  return (
    <nav aria-label="Основная навигация" className="px-2 pb-4">
      <ul className="space-y-0.5">
        {PRIMARY_ITEMS.map((item) => renderItem(item, isActive(pathname, item)))}
      </ul>

      {authed ? renderSection("Личное", secondaryItems) : null}

      {authed && isSeller ? renderSection("Продавец", creatorItems) : null}

      {isAdmin
        ? renderSection("Модерация", [
            { href: "/admin", label: "Админ-панель", icon: ShieldCheck },
          ])
        : null}
    </nav>
  );
}

function SidebarCollapseButton({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={collapsed ? "Развернуть меню" : "Свернуть меню"}
      aria-expanded={!collapsed}
      className={cn(
        "flex items-center rounded-md text-sm font-medium text-content-secondary transition-colors duration-fast hover:bg-surface-hover hover:text-content",
        collapsed ? "h-10 w-10 justify-center" : "gap-3 px-3 py-2"
      )}
    >
      {collapsed ? (
        <PanelLeftOpen className="h-[18px] w-[18px]" aria-hidden />
      ) : (
        <>
          <PanelLeftClose className="h-[18px] w-[18px]" aria-hidden />
          Свернуть
        </>
      )}
    </button>
  );
}

/** Desktop sidebar (lg+). */
export function Sidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <aside
      aria-label="Навигация по разделам"
      className={cn(
        "sticky top-14 hidden h-[calc(100vh-3.5rem)] flex-shrink-0 flex-col justify-between overflow-y-auto border-r border-line bg-surface/40 pb-3 pt-3 transition-[width] duration-base lg:flex",
        collapsed ? "w-14" : "w-60"
      )}
    >
      <SidebarNav collapsed={collapsed} />
      <div className={cn("mt-2 px-2", collapsed && "flex justify-center")}>
        <SidebarCollapseButton collapsed={collapsed} onToggle={onToggle} />
      </div>
    </aside>
  );
}

/** Mobile drawer with the same navigation (<lg). */
export function SidebarDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Меню">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <div className="absolute inset-y-0 left-0 w-72 max-w-full overflow-y-auto border-r border-line bg-surface-raised p-4 shadow-raised">
        <div className="mb-4 flex items-center justify-between">
          <span className="font-bold">Меню</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть меню"
            className="rounded p-1.5 text-content-secondary hover:bg-surface-hover hover:text-content"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <SidebarNav collapsed={false} onNavigate={onClose} />
      </div>
    </div>
  );
}

// Sidebar collapse state с персистентностью (PLAN-015 §6).
export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(readSidebarCollapsed());
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // ignore storage failures
      }
      return next;
    });
  }, []);

  return { collapsed, toggle };
}
