// PLAN-015 §10: единственный глобальный переключатель темы (light/dark).
"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/layout/theme";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { resolved, setTheme } = useTheme();
  const isDark = resolved === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Включить светлую тему" : "Включить тёмную тему"}
      aria-pressed={isDark}
      title={isDark ? "Светлая тема" : "Тёмная тема"}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-md text-content-secondary transition-colors duration-fast hover:bg-surface-hover hover:text-content ${className}`}
    >
      {isDark ? <Sun className="h-[18px] w-[18px]" aria-hidden /> : <Moon className="h-[18px] w-[18px]" aria-hidden />}
    </button>
  );
}
