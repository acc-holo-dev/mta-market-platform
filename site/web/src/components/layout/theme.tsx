// PLAN-015 §10: theme system — две первоклассные темы (light/dark),
// один глобальный переключатель, персистентная предпочтение пользователя,
// system-fallback при первом визите. Класс `dark` на <html> управляется
// синхронно inline-скриптом в layout.tsx (no-FOUC), этот провайдер держит
// React-состояние и слушает системные изменения, пока нет явного выбора.
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "mta-theme";

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function readStoredPreference(): ThemePreference {
  if (typeof window === "undefined") return "system";
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

interface ThemeContextValue {
  /** Что выбрал пользователь (light/dark/system). */
  preference: ThemePreference;
  /** Фактически применённая тема (system резолвится в light/dark). */
  resolved: "light" | "dark";
  /** Установить явную тему (сбрасывает system-режим). */
  setTheme: (theme: "light" | "dark") => void;
  /** Переключить на противоположную явную тему. */
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("dark");

  useEffect(() => {
    const stored = readStoredPreference();
    setPreference(stored);
    const resolvedNow: "light" | "dark" =
      stored === "system" ? (systemPrefersDark() ? "dark" : "light") : stored;
    setResolved(resolvedNow);
    document.documentElement.classList.toggle("dark", resolvedNow === "dark");
  }, []);

  useEffect(() => {
    if (preference !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => {
      setResolved(event.matches ? "dark" : "light");
      document.documentElement.classList.toggle("dark", event.matches);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  const setTheme = useCallback((theme: "light" | "dark") => {
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // storage может быть недоступен (private mode) — тема применится на сессию
    }
    setPreference(theme);
    setResolved(theme);
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, []);

  const toggle = useCallback(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark");
  }, [setTheme]);

  const value = useMemo(() => ({ preference, resolved, setTheme, toggle }), [preference, resolved, setTheme, toggle]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
