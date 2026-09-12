// Раскрытая проверка сервера — перенесено из app/admin/page.tsx (PLAN-017 §36).
// Приватные поля + владелец + счётчики + новости. Ключ ["admin-server-detail", id] сохранён.
"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchAdminServerDetail } from "@/lib/api/admin";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { LoadingSpinner } from "@/components/ui/States";
import { formatDate } from "@/lib/domain";

export function AdminServerDetailPanel({ serverId }: { serverId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-server-detail", serverId],
    queryFn: () => fetchAdminServerDetail(serverId),
  });

  if (isLoading) return <LoadingSpinner label="Загрузка данных сервера..." className="py-6" />;
  if (error || !data)
    return (
      <p className="text-sm text-bad" role="alert">
        Не удалось загрузить данные сервера.
      </p>
    );

  const { server, owner, counts, recentNews } = data;

  return (
    <div className="rounded-card border border-line bg-surface p-4 space-y-4 text-sm">
      <div className="space-y-1 text-content-secondary">
        <p>
          <span className="text-content-muted">Email владельца:</span> {owner?.email ?? "—"}
        </p>
        <p>
          <span className="text-content-muted">Адрес:</span> {server.host ?? "—"}
          {server.port != null ? `:${server.port}` : ""}
        </p>
        <p>
          <span className="text-content-muted">Подписчики:</span> {counts.followers} ·{" "}
          <span className="text-content-muted">Отзывы:</span> {counts.reviews} ·{" "}
          <span className="text-content-muted">Ресурсы:</span> {counts.resources}
        </p>
        <p>
          <span className="text-content-muted">Приватность:</span>{" "}
          {server.showStats ? "статистика вкл" : "статистика выкл"} ·{" "}
          {server.showStaff ? "стафф вкл" : "стафф выкл"} ·{" "}
          {server.showResources ? "ресурсы вкл" : "ресурсы выкл"} ·{" "}
          {server.showCommunity ? "сообщество вкл" : "сообщество выкл"} ·{" "}
          {server.showTechStack ? "стек вкл" : "стек выкл"}
        </p>
        {server.verificationNote ? (
          <p>
            <span className="text-content-muted">Примечание проверки:</span>{" "}
            {server.verificationNote}
          </p>
        ) : null}
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-muted">
          Последние новости
        </p>
        {recentNews.length === 0 ? (
          <p className="text-xs text-content-muted">Новостей нет.</p>
        ) : (
          <ul className="space-y-1.5">
            {recentNews.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center gap-2 text-xs text-content-secondary">
                <span className="font-medium text-content">{n.title}</span>
                <StatusBadge status={n.status} />
                {n.publishedAt ? <span>{formatDate(n.publishedAt)}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}