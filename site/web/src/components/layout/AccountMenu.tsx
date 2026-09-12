// PLAN-015 §7/§33: AccountMenu — профиль + баланс в одном контроле.
// Меню: баланс (честный из /auth/me), Покупки, Подписки, Кабинет продавца,
// Профиль, Админ (только роль), Выход. Гостям — Войти + Регистрация.
// Имена «Выход»/«Войти» стабильны для Playwright E2E (tests/e2e).
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Wallet, Package, UserPlus, Store, User, LogOut, ShieldCheck, ChevronDown, Coins } from "lucide-react";
import { useAuthStore } from "@/store/auth";
import { fetchMe, formatRub } from "@/lib/api-ext";
import { useQuery } from "@tanstack/react-query";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

interface MenuRow {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export function AccountMenu() {
  const { user, accessToken } = useAuthStore();
  const [open, setOpen] = useState(false);

  const { data: me } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    enabled: accessToken !== null,
    staleTime: 30_000,
    retry: false,
  });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("[data-account-menu]")) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  if (!(accessToken !== null && user)) {
    return (
      <div className="flex items-center gap-2">
        <Link href="/auth/login">
          <Button variant="ghost" size="sm">
            Войти
          </Button>
        </Link>
        <Link href="/auth/register">
          <Button variant="primary" size="sm">
            Регистрация
          </Button>
        </Link>
      </div>
    );
  }

  const isAdmin = user.role === "ADMIN" || user.role === "MODERATOR";
  const name = user.displayName || user.username;

  const rows: MenuRow[] = [
    { href: "/dashboard", label: "Покупки", icon: Package },
    { href: "/me/following", label: "Подписки", icon: UserPlus },
    { href: "/seller", label: "Кабинет продавца", icon: Store },
    { href: "/account", label: "Профиль", icon: User },
  ];

  const handleLogout = () => {
    setOpen(false);
    clearAuthAndGo();
  };

  return (
    <div className="relative" data-account-menu>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Меню аккаунта"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-2 rounded-pill border border-line bg-surface py-1 pl-1 pr-2 transition-colors duration-fast hover:border-line-strong",
          open && "border-line-strong bg-surface-hover"
        )}
      >
        <Avatar src={me?.avatar ?? user.avatar ?? null} name={name} size="sm" />
        <span className="hidden max-w-[8rem] truncate text-sm font-medium md:block">{name}</span>
        {me ? (
          <span
            className="hidden items-center gap-1 rounded-pill bg-surface-inset px-2 py-0.5 text-xs font-semibold tabular-nums text-content sm:inline-flex"
            title="Баланс аккаунта"
          >
            <Coins className="h-3 w-3 text-ok" aria-hidden />
            {formatRub(me.balance.available)}
          </span>
        ) : null}
        <ChevronDown className="h-3.5 w-3.5 text-content-muted" aria-hidden />
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Аккаунт"
          className="mta-anim-fade absolute right-0 top-full z-50 mt-2 w-56 rounded-card border border-line bg-surface-raised p-1.5 shadow-raised"
        >
          {/* Баланс (§33) — первый блок меню */}
          <Link
            href="/account#balance"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="mb-1 flex items-center justify-between gap-2 rounded-md bg-surface-inset px-3 py-2.5 text-sm transition-colors duration-fast hover:bg-surface-hover"
          >
            <span className="flex items-center gap-2 text-content-secondary">
              <Wallet className="h-4 w-4 text-ok" aria-hidden />
              Баланс
            </span>
            <span className="font-semibold tabular-nums text-content">
              {me ? formatRub(me.balance.available) : "—"}
            </span>
          </Link>

          {rows.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-content-secondary transition-colors duration-fast hover:bg-surface-hover hover:text-content"
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
            </Link>
          ))}

          {isAdmin ? (
            <Link
              href="/admin"
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-content-secondary transition-colors duration-fast hover:bg-surface-hover hover:text-content"
            >
              <ShieldCheck className="h-4 w-4" aria-hidden />
              Админ-панель
            </Link>
          ) : null}

          <div className="my-1 border-t border-line" aria-hidden />
          <button
            type="button"
            role="menuitem"
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-content-secondary transition-colors duration-fast hover:bg-surface-hover hover:text-bad"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            Выход
          </button>
        </div>
      ) : null}
    </div>
  );
}

function clearAuthAndGo() {
  useAuthStore.getState().clearAuth();
  // Hard navigation: надёжный выход (см. Topbar.quickLogout).
  window.location.assign("/");
}
