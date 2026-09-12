// Статьи — очередь модерации — перенесено из app/admin/page.tsx (PLAN-017 §36).
// Ключ ["admin-articles", status] сохранён.
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import {
  adminArticleAction,
  fetchAdminArticles,
  getErrorMessage,
  type AdminArticle,
} from "@/lib/api/admin";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Input";
import { LoadingSpinner, EmptyState } from "@/components/ui/States";

export function ArticlesModerationSection() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("PENDING_REVIEW");
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["admin-articles", status],
    queryFn: () => fetchAdminArticles(status),
  });

  const act = useMutation({
    mutationFn: ({
      id,
      action,
      reason,
    }: {
      id: string;
      action: "approve" | "reject" | "hide";
      reason?: string;
    }) => adminArticleAction(id, action, reason),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin-articles"] });
    },
    onError: (e) => setError(getErrorMessage(e, "Не удалось обработать статью")),
  });

  const list: AdminArticle[] = data?.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-accent" /> Статьи
        </CardTitle>
        <CardDescription>Модерация контента авторов (PLAN-007)</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-xs">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Статус статей">
            <option value="PENDING_REVIEW">На модерации</option>
            <option value="PUBLISHED">Опубликованные</option>
            <option value="ARCHIVED">Скрытые</option>
            <option value="DRAFT">Черновики</option>
            <option value="ALL">Все</option>
          </Select>
        </div>
        {error ? <p className="text-sm text-bad">{error}</p> : null}
        {isLoading ? (
          <LoadingSpinner label="Загрузка…" />
        ) : list.length === 0 ? (
          <EmptyState title="Нет статей в этом статусе" />
        ) : (
          <div className="space-y-3">
            {list.map((a) => (
              <div key={a.id} className="rounded-card border border-line bg-surface-raised p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{a.title}</p>
                    <p className="mt-0.5 truncate text-xs text-content-secondary">{a.excerpt}</p>
                    <p className="mt-1 text-xs text-content-muted">
                      {a.author?.displayName || a.author?.username || "Автор"} · {a.status}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
                    {a.status === "PENDING_REVIEW" ? (
                      <>
                        <Button size="sm" disabled={act.isPending} onClick={() => act.mutate({ id: a.id, action: "approve" })}>
                          Опубликовать
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={act.isPending}
                          onClick={() => act.mutate({ id: a.id, action: "reject", reason: reasons[a.id] })}
                        >
                          Вернуть
                        </Button>
                      </>
                    ) : null}
                    {a.status === "PUBLISHED" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={act.isPending}
                        onClick={() => act.mutate({ id: a.id, action: "hide", reason: reasons[a.id] })}
                      >
                        Скрыть
                      </Button>
                    ) : null}
                  </div>
                </div>
                {a.status === "PENDING_REVIEW" || a.status === "PUBLISHED" ? (
                  <input
                    value={reasons[a.id] ?? ""}
                    onChange={(e) => setReasons((r) => ({ ...r, [a.id]: e.target.value }))}
                    placeholder={a.status === "PENDING_REVIEW" ? "Причина возврата (для «Вернуть»)" : "Причина скрытия"}
                    className="mt-3 w-full rounded-card border border-line bg-surface-inset px-3 py-2 text-sm text-content placeholder:text-content-muted"
                    aria-label="Причина"
                  />
                ) : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}