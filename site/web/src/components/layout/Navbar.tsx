// Navbar (PLAN-002 C-001/C-002/C-003): продуктовая навигация + mobile drawer.
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "@/store/auth";
import { fetchMe, fetchNotifications, formatRub } from "@/lib/api-ext";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import {
  ShoppingBag,
  User,
  LogOut,
  Wallet,
  Store,
  Menu,
  X,
  ShieldCheck,
  Package,
  LayoutGrid,
  Server,
  MessagesSquare,
  Bell,
  FileText,
} from "lucide-react";

const NAV_LINKS = [
  { href: "/resources", label: "Маркетплейс", icon: LayoutGrid },
  { href: "/servers", label: "Серверы", icon: Server },
  { href: "/content", label: "Статьи", icon: FileText },
  { href: "/community", label: "Сообщество", icon: MessagesSquare },
  { href: "/dashboard", label: "Покупки", icon: Package },
  { href: "/account", label: "Профиль", icon: User },
  { href: "/seller", label: "Мой магазин", icon: Store },
];

// PLAN-005: guest nav keeps discovery surfaces visible without auth.
const GUEST_NAV_LINKS = [
  { href: "/resources", label: "Маркетплейс", icon: LayoutGrid },
  { href: "/servers", label: "Серверы", icon: Server },
  { href: "/content", label: "Статьи", icon: FileText },
  { href: "/community", label: "Сообщество", icon: MessagesSquare },
];

export function Navbar() {
  const { user, accessToken, isAuthenticated, clearAuth } = useAuthStore();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // C-004: balance travels with the profile; show it inline when signed in.
  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    enabled: accessToken !== null,
    staleTime: 30_000,
    retry: false,
  });

  // PLAN-005 M: unread badge for the notification center.
  const { data: notifData } = useQuery({
    queryKey: ["notifications", "badge"],
    queryFn: () => fetchNotifications("unread"),
    enabled: accessToken !== null,
    staleTime: 60_000,
    retry: false,
    refetchInterval: 120_000,
  });
  const unreadCount = notifData?.unreadCount ?? 0;

  // C-003: закрыть drawer при смене маршрута.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const handleLogout = () => {
    setMobileOpen(false);
    clearAuth();
    window.location.href = "/";
  };

  const isAdmin = user?.role === "ADMIN" || user?.role === "MODERATOR";
  const active = (href: string) =>
    href === "/resources" ? pathname === "/" || pathname.startsWith("/resources") : pathname.startsWith(href);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-background/90 backdrop-blur">
      <nav aria-label="Основная навигация">
        <div className="mx-auto max-w-7xl px-4">
          <div className="flex h-16 items-center justify-between gap-4">
            {/* Logo */}
            <Link href="/" className="flex items-center gap-2 flex-shrink-0">
              <ShoppingBag className="h-6 w-6 text-accent" />
              <span className="text-lg font-bold tracking-tight">MTA Market</span>
            </Link>

            {/* Desktop links (C-001) */}
            <div className="hidden md:flex items-center gap-1">
              {isAuthenticated() &&
                user &&
                NAV_LINKS.map(({ href, label }) => (
                  <Link
                    key={href}
                    href={href}
                    className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                      active(href)
                        ? "text-content bg-surface-hover"
                        : "text-content-secondary hover:text-content hover:bg-surface-hover"
                    }`}
                  >
                    {label}
                  </Link>
                ))}
              {isAuthenticated() && user && isAdmin ? (
                <Link
                  href="/admin"
                  className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    pathname.startsWith("/admin")
                      ? "text-content bg-surface-hover"
                      : "text-content-secondary hover:text-content hover:bg-surface-hover"
                  }`}
                >
                  Админ
                </Link>
              ) : null}
              {!isAuthenticated() || !user
                ? GUEST_NAV_LINKS.map(({ href, label }) => (
                    <Link
                      key={href}
                      href={href}
                      className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                        active(href)
                          ? "text-content bg-surface-hover"
                          : "text-content-secondary hover:text-content hover:bg-surface-hover"
                      }`}
                    >
                      {label}
                    </Link>
                  ))
                : null}
            </div>

            {/* Right side */}
            <div className="flex items-center gap-2">
              {isAuthenticated() && user ? (
                <>
                  {/* PLAN-005 M-003: notification center entry. */}
                  <Link
                    href="/notifications"
                    className="relative hidden sm:inline-flex h-9 w-9 items-center justify-center rounded-md text-content-secondary hover:text-content hover:bg-surface-hover"
                    title="Уведомления"
                    aria-label="Уведомления"
                  >
                    <Bell className="h-5 w-5" />
                    {unreadCount > 0 ? (
                      <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white">
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    ) : null}
                  </Link>
                  {me ? (
                    <Link
                      href="/account"
                      className="hidden sm:inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-content hover:bg-surface-hover"
                      title="Ваш баланс"
                    >
                      <Wallet className="h-4 w-4 text-ok" />
                      {formatRub(me.balance.available)}
                    </Link>
                  ) : null}
                  <Link
                    href="/account"
                    className="hidden md:flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-content hover:bg-surface-hover"
                  >
                    <Avatar src={me?.avatar ?? user.avatar ?? null} name={user.displayName || user.username} size="sm" />
                    <span className="max-w-[10rem] truncate">
                      {user.displayName || user.username}
                    </span>
                  </Link>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleLogout}
                    className="hidden md:inline-flex"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    Выход
                  </Button>
                  {/* Mobile burger (C-002) */}
                  <button
                    type="button"
                    onClick={() => setMobileOpen(true)}
                    className="md:hidden inline-flex h-10 w-10 items-center justify-center rounded-md text-content hover:bg-surface-hover"
                    aria-label="Открыть меню"
                    aria-expanded={mobileOpen}
                  >
                    <Menu className="h-5 w-5" />
                  </button>
                </>
              ) : (
                <>
                  <Link href="/auth/login" className="hidden sm:inline-flex">
                    <Button variant="ghost" size="sm">
                      Войти
                    </Button>
                  </Link>
                  <Link href="/auth/register">
                    <Button variant="primary" size="sm">
                      Регистрация
                    </Button>
                  </Link>
                  <button
                    type="button"
                    onClick={() => setMobileOpen(true)}
                    className="md:hidden inline-flex h-10 w-10 items-center justify-center rounded-md text-content hover:bg-surface-hover"
                    aria-label="Открыть меню"
                  >
                    <Menu className="h-5 w-5" />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Mobile drawer (C-002) */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Меню">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <div className="absolute inset-y-0 right-0 w-80 max-w-full bg-surface border-l border-line p-4 overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <span className="flex items-center gap-2 font-bold">
                <ShoppingBag className="h-5 w-5 text-accent" /> MTA Market
              </span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-md text-content-secondary hover:bg-surface-hover"
                aria-label="Закрыть меню"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {isAuthenticated() && user ? (
              <div className="flex items-center gap-3 p-3 rounded-card bg-surface-raised mb-4">
                <Avatar src={me?.avatar ?? user.avatar ?? null} name={user.displayName || user.username} />
                <div className="min-w-0">
                  <p className="font-medium truncate">{user.displayName || user.username}</p>
                  {me ? (
                    <p className="text-sm text-content-secondary flex items-center gap-1">
                      <Wallet className="h-3.5 w-3.5 text-ok" /> {formatRub(me.balance.available)}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="space-y-1">
              {NAV_LINKS.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={`flex items-center gap-3 rounded-md px-3 py-3 text-sm font-medium ${
                    active(href)
                      ? "bg-surface-hover text-content"
                      : "text-content-secondary hover:bg-surface-hover hover:text-content"
                  }`}
                >
                  <Icon className="h-5 w-5" /> {label}
                </Link>
              ))}
              {/* PLAN-005 M: notifications in the mobile drawer. */}
              {isAuthenticated() && user ? (
                <Link
                  href="/notifications"
                  className={`flex items-center gap-3 rounded-md px-3 py-3 text-sm font-medium ${
                    pathname.startsWith("/notifications")
                      ? "bg-surface-hover text-content"
                      : "text-content-secondary hover:bg-surface-hover hover:text-content"
                  }`}
                >
                  <span className="relative inline-flex">
                    <Bell className="h-5 w-5" />
                    {unreadCount > 0 ? (
                      <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-0.5 text-[9px] font-bold text-white">
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    ) : null}
                  </span>
                  Уведомления
                </Link>
              ) : null}
              {isAdmin ? (
                <Link
                  href="/admin"
                  className={`flex items-center gap-3 rounded-md px-3 py-3 text-sm font-medium ${
                    pathname.startsWith("/admin")
                      ? "bg-surface-hover text-content"
                      : "text-content-secondary hover:bg-surface-hover hover:text-content"
                  }`}
                >
                  <ShieldCheck className="h-5 w-5" /> Админ
                </Link>
              ) : null}
            </div>

            <div className="mt-6 pt-4 border-t border-line space-y-2">
              {isAuthenticated() ? (
                <Button variant="outline" className="w-full" onClick={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" /> Выйти
                </Button>
              ) : (
                <>
                  <Link href="/auth/login" className="block">
                    <Button variant="outline" className="w-full">
                      Войти
                    </Button>
                  </Link>
                  <Link href="/auth/register" className="block">
                    <Button variant="primary" className="w-full">
                      Регистрация
                    </Button>
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
