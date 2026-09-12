// PLAN-015 §5: единый shell — Topbar / [Sidebar | Content] / Footer.
// Все основные поверхности (публичные и аутентифицированные) живут в одном
// каркасе; sidebar сворачивается, состояние персистентно (Sidebar.tsx).
"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { Topbar } from "@/components/layout/Topbar";
import { Footer } from "@/components/layout/Footer";
import { Sidebar, useSidebarCollapsed } from "@/components/layout/Sidebar";
import { bootstrapSession } from "@/lib/api";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { collapsed, toggle } = useSidebarCollapsed();
  const pathname = usePathname();

  // PLAN-016 D-006: warm up the session before first paint so authenticated
  // users do not see a guest-state flash. Existing per-page bootstrapSession()
  // guards stay — this call is idempotent and cheap (single-flight refresh in
  // lib/api.ts).
  useEffect(() => {
    void bootstrapSession();
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-on-accent"
      >
        Перейти к содержимому
      </a>

      <Topbar />

      <div className="flex flex-1">
        <Sidebar collapsed={collapsed} onToggle={toggle} />
        <main id="content" key={pathname} className="min-w-0 flex-1">
          {children}
        </main>
      </div>

      <Footer />
    </div>
  );
}