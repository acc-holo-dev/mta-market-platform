// PLAN-015 §9: единое context-aware create-действие в topbar.
// Метка меняется по разделу (§9), для гостей скрыто; на Home — меню-выбор.
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { Plus, Package, Server, MessagesSquare, FileText } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useDropdownDismiss } from "@/components/ui/focusTrap";

interface CreateOption {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const GENERIC_OPTIONS: CreateOption[] = [
  { href: "/seller/new", label: "Ресурс", icon: Package },
  { href: "/servers/create", label: "Сервер", icon: Server },
  { href: "/community", label: "Обсуждение", icon: MessagesSquare },
  { href: "/content/new", label: "Статья", icon: FileText },
];

function contextFor(pathname: string): { label: string; href: string; menu: CreateOption[] | null } {
  if (pathname.startsWith("/seller")) {
    return { label: "Опубликовать", href: "/seller/new", menu: null };
  }
  if (pathname.startsWith("/resources")) {
    return { label: "Продать ресурс", href: "/seller/new", menu: null };
  }
  if (pathname.startsWith("/servers")) {
    return { label: "Добавить сервер", href: "/servers/create", menu: null };
  }
  if (pathname.startsWith("/community")) {
    return { label: "Новая тема", href: "/community", menu: null };
  }
  if (pathname.startsWith("/content")) {
    return { label: "Новая статья", href: "/content/new", menu: null };
  }
  return { label: "Создать", href: "#", menu: GENERIC_OPTIONS };
}

export function ContextCreate() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement>(null);
  const context = contextFor(pathname);

  // PLAN-016 D-004: Esc закрывает меню (фокус — на триггер), Tab-out
  // закрывает без похищения фокуса.
  useDropdownDismiss(open, menuContainerRef, () => setOpen(false));

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest("[data-context-create]")) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  if (context.menu) {
    return (
      <div className="relative" data-context-create ref={menuContainerRef}>
        <Button
          variant="secondary"
          size="sm"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="Создать: выбрать тип"
          onClick={() => setOpen((v) => !v)}
          className="hidden sm:inline-flex"
        >
          <Plus className="mr-1 h-4 w-4" aria-hidden />
          Создать
        </Button>
        {open ? (
          <div
            role="menu"
            aria-label="Создать"
            className="mta-anim-fade absolute right-0 top-full z-50 mt-2 w-44 rounded-card border border-line bg-surface-raised p-1.5 shadow-raised"
          >
            {context.menu.map(({ href, label, icon: Icon }) => (
              <button
                key={href}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  router.push(href);
                }}
                className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-content-secondary transition-colors duration-fast hover:bg-surface-hover hover:text-content"
              >
                <Icon className="h-4 w-4" aria-hidden />
                {label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <Link href={context.href} className="hidden sm:inline-flex">
      <Button variant="secondary" size="sm">
        <Plus className="mr-1 h-4 w-4" aria-hidden />
        {context.label}
      </Button>
    </Link>
  );
}
