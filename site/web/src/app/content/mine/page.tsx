// PLAN-007 C-002: «Мои статьи» — все собственные статусы, действия
// (edit → PENDING_REVIEW для опубликованных, submit, открытие треда).
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchMyArticles,
  submitArticle,
  updateArticle,
  createArticleDiscussion,
  getErrorMessage,
  type ArticleStatus,
} from "@/lib/api-ext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { LoadingSpinner, EmptyState, ErrorState } from "@/components/ui/States";
import { formatDate, categoryLabel } from "@/lib/domain";
import { useAuthStore } from "@/store/auth";
import { bootstrapSession } from "@/lib/api";
import { PenLine, FileText, Send, Eye, MessageSquare } from "lucide-react";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Черновик",
  PENDING_REVIEW: "На модерации",
  PUBLISHED: "Опубликована",
  ARCHIVED: "Скрыта модерацией",
};

export default function MyArticlesPage() {
  const router = useRouter();
  const { user, isAuthenticated } = useAuthStore();
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await bootstrapSession();
      if (!cancelled && !ok) router.push("/auth/login");
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const { data, isLoading, error: qError, refetch } = useQuery({
    queryKey: ["content", "mine"],
    queryFn: fetchMyArticles,
    enabled: isAuthenticated(),
  });

  const act = async (id: string, action: () => Promise<unknown>) => {
    setBusyId(id);
    setError(null);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ["content", "mine"] });
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  if (!isAuthenticated() || !user) {
    return <LoadingSpinner label="Проверка сессии…" className="mt-16" />;
  }

  const rows = data?.data ?? [];

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Мои статьи</h1>
        <Link href="/content/new">
          <Button size="sm">
            <PenLine className="mr-2 h-4 w-4" />
            Написать
          </Button>
        </Link>
      </div>

      {error ? (
        <div className="mt-4 rounded-card border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{error}</div>
      ) : null}

      {isLoading ? (
        <LoadingSpinner label="Загрузка…" className="mt-10" />
      ) : qError ? (
        <ErrorState error={qError} onRetry={() => refetch()} />
      ) : rows.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={<FileText className="h-12 w-12 text-content-muted mx-auto mb-4" />}
            title="Вы ещё не писали статей"
            description="Гайды, разборы и новости — самый прямой способ помочь сообществу и собрать аудиторию."
            action={
              <Link href="/content/new">
                <Button size="sm">
                  <PenLine className="mr-2 h-4 w-4" />
                  Написать статью
                </Button>
              </Link>
            }
          />
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {rows.map((a: ArticleStatus) => (
            <Card key={a.id}>
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                        a.status === "PUBLISHED"
                          ? "bg-emerald-500/10 text-emerald-400"
                          : a.status === "PENDING_REVIEW"
                            ? "bg-amber-500/10 text-amber-400"
                            : a.status === "ARCHIVED"
                              ? "bg-red-500/10 text-red-400"
                              : "bg-surface-raised text-content-secondary"
                      }`}
                    >
                      {STATUS_LABELS[a.status]}
                    </span>
                    <span className="text-xs text-content-muted">{categoryLabel(a.category)}</span>
                    <span className="text-xs text-content-muted">{formatDate(a.createdAt)}</span>
                  </div>
                  {a.status === "PUBLISHED" ? (
                    <Link href={`/content/articles/${a.slug}`} className="mt-1 block truncate font-semibold hover:text-accent-strong">
                      {a.title}
                    </Link>
                  ) : (
                    <p className="mt-1 truncate font-semibold">{a.title}</p>
                  )}
                  {a.reviewNote ? (
                    <p className="mt-1 text-xs text-content-secondary">Модерация: {a.reviewNote}</p>
                  ) : null}
                </div>
                <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
                  {a.threadId ? (
                    <Link href={`/community/forum/thread/${a.threadId}`}>
                      <Button variant="ghost" size="sm">
                        <MessageSquare className="mr-1 h-4 w-4" />
                        {a.replyCount}
                      </Button>
                    </Link>
                  ) : null}
                  {a.status === "PUBLISHED" ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyId === a.id}
                        onClick={() => act(a.id, () => createArticleDiscussion(a.id))}
                      >
                        Открыть обсуждение
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyId === a.id}
                        onClick={() => act(a.id, () => updateArticle(a.id, {}))}
                      >
                        <Eye className="mr-1 h-4 w-4" />
                        Пересмотреть
                      </Button>
                    </>
                  ) : null}
                  {(a.status === "DRAFT" || a.status === "ARCHIVED") && (
                    <Button
                      size="sm"
                      disabled={busyId === a.id}
                      onClick={() => act(a.id, () => submitArticle(a.id))}
                    >
                      <Send className="mr-1 h-4 w-4" />
                      На модерацию
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-sm">Как это работает</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-content-secondary">
          Черновик → «На модерацию» → решение модератора уведомлением. Опубликованную статью можно
          пересмотреть — она снова уйдёт на модерацию. Скрытую можно исправить и отправить заново.
        </CardContent>
      </Card>
    </div>
  );
}
