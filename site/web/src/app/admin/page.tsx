// PLAN-017 §36: админ-консоль — тонкий client-shell.
// Ролевой гейт сохранён ровно как в PLAN-002/PLAN-016 (bootstrapSession перед
// проверкой роли, ADMIN/MODERATOR). Секции живут в features/admin/*, вкладка —
// из TAB_REGISTRY (?tab= в URL, default "overview"); компактная полоса
// статистики (бывшая StatsCards) остаётся над вкладками на всех вкладках.
"use client";

import { useEffect, useState } from "react";
import { Shield } from "lucide-react";
import { Card, CardContent, CardTitle, CardDescription } from "@/components/ui/Card";
import { Tabs } from "@/components/ui/Tabs";
import { LoadingSpinner } from "@/components/ui/States";
import { bootstrapSession } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { StatsStrip } from "@/features/admin/overview/StatsStrip";
import {
  DEFAULT_ADMIN_TAB,
  TAB_REGISTRY,
  parseAdminTab,
  type AdminTabId,
} from "@/features/admin";

export default function AdminPage() {
  const { user, isAuthenticated } = useAuthStore();
  const [booted, setBooted] = useState(false);
  const [tab, setTab] = useState<AdminTabId>(DEFAULT_ADMIN_TAB);

  // G-001/G-002: access token живёт только в памяти, поэтому прямой визит в
  // /admin (fresh load / reload) обязан восстановить сессию из refresh-cookie
  // ДО ролевой проверки — иначе админ увидит "доступ запрещён".
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await bootstrapSession();
      if (!cancelled) {
        setTab(parseAdminTab(new URLSearchParams(window.location.search).get("tab")));
        setBooted(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Синхронизация вкладки с URL (?tab=...).
  useEffect(() => {
    if (!booted) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("tab") !== tab) {
      url.searchParams.set("tab", tab);
      window.history.replaceState(null, "", url);
    }
  }, [tab, booted]);

  if (!booted) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-12">
        <LoadingSpinner label="Загрузка админ-панели..." />
      </div>
    );
  }

  if (!isAuthenticated() || !user || (user.role !== "ADMIN" && user.role !== "MODERATOR")) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16">
        <Card className="mx-auto max-w-md text-center">
          <CardContent className="py-10 space-y-3">
            <Shield className="h-10 w-10 text-bad mx-auto" />
            <CardTitle className="text-bad">Доступ запрещён</CardTitle>
            <CardDescription>Раздел доступен только администраторам и модераторам.</CardDescription>
          </CardContent>
        </Card>
      </div>
    );
  }

  const active = TAB_REGISTRY.find((entry) => entry.id === tab) ?? TAB_REGISTRY[0];
  const ActiveSection = active.component;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <Shield className="h-7 w-7 text-accent" /> Панель управления
        </h1>
        <p className="mt-1 text-content-secondary">
          Обзор платформы, модерация, пользователи, серверы, споры, жалобы и контент
        </p>
      </div>

      <StatsStrip className="mb-2" />

      <Tabs
        className="my-6"
        value={tab}
        onChange={setTab}
        tabs={TAB_REGISTRY.map((entry) => [entry.id, entry.label] as [AdminTabId, string])}
      />

      <ActiveSection />
    </div>
  );
}