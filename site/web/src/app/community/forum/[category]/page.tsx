// Категория форума (PLAN-005 F-003 list): список тем + форма создания темы
// для авторизованных, ?page= в URL. Гостям доступно чтение.
"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessagesSquare, MessageSquarePlus } from "lucide-react";
import { bootstrapSession } from "@/lib/api";
import {
  fetchCategoryThreads,
  createForumThread,
  getErrorMessage,
} from "@/lib/api-ext";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { LoadingSpinner, EmptyState, ErrorState } from "@/components/ui/States";
import { ThreadRow } from "@/components/community/ThreadRow";

function CategoryPageContent() {
  const router = useRouter();
  const params = useParams<{ category: string }>();
  const slug = params?.category ?? "";
  const searchParams = useSearchParams();
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const qc = useQueryClient();
  const [booted, setBooted] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // Публичная страница: сессию тихо восстанавливаем, гостя не редиректим.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await bootstrapSession();
      if (!cancelled) setBooted(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["community", "category", slug, page],
    queryFn: () => fetchCategoryThreads(slug, page),
    enabled: booted && slug.length > 0,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const createThread = useMutation({
    mutationFn: () =>
      createForumThread(slug, { title: title.trim(), content: content.trim() }),
    onSuccess: (created) => {
      setFormError(null);
      setTitle("");
      setContent("");
      setFormOpen(false);
      qc.invalidateQueries({ queryKey: ["community"] });
      router.push(`/community/forum/thread/${created.id}`);
    },
    onError: (e) => setFormError(getErrorMessage(e, "Не удалось создать тему")),
  });

  if (!booted) return null;

  const changePage = (next: number) => {
    router.push(next > 1 ? `/community/forum/${slug}?page=${next}` : `/community/forum/${slug}`, {
      scroll: false,
    });
  };

  const canSubmit = title.trim().length >= 3 && content.trim().length >= 3;

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <nav aria-label="Хлебные крошки" className="mb-4 text-sm text-content-muted">
        <Link href="/community" className="hover:text-accent-strong">
          Сообщество
        </Link>
        {data?.category ? (
          <>
            <span className="mx-2">/</span>
            <span className="text-content-secondary">{data.category.name}</span>
          </>
        ) : null}
      </nav>

      {isLoading ? (
        <LoadingSpinner label="Загрузка категории..." />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">{data!.category.name}</h1>
              {data!.category.description ? (
                <p className="mt-1 text-content-secondary">{data!.category.description}</p>
              ) : (
                <p className="mt-1 text-content-secondary">
                  {data!.pagination.total} тем · страница {data!.pagination.page} из{" "}
                  {data!.pagination.pages || 1}
                </p>
              )}
            </div>
            {isAuthenticated() ? (
              <Button onClick={() => setFormOpen((v) => !v)}>
                <MessageSquarePlus className="mr-2 h-4 w-4" aria-hidden />
                Создать тему
              </Button>
            ) : (
              <Button onClick={() => router.push("/auth/login")}>
                <MessageSquarePlus className="mr-2 h-4 w-4" aria-hidden />
                Создать тему
              </Button>
            )}
          </div>

          {/* Встроенная форма создания темы (только для авторизованных) */}
          {isAuthenticated() && formOpen ? (
            <div className="mb-6 p-4 rounded-card border border-line bg-surface-raised space-y-3">
              <h2 className="font-semibold">Новая тема</h2>
              <Input
                aria-label="Заголовок темы"
                placeholder="Заголовок темы (3–150 символов)"
                value={title}
                maxLength={150}
                onChange={(e) => setTitle(e.target.value)}
              />
              <Textarea
                aria-label="Текст первого сообщения"
                placeholder="Опишите вопрос или тему обсуждения..."
                rows={6}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                disabled={createThread.isPending}
              />
              {formError ? <p className="text-sm text-bad">{formError}</p> : null}
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFormOpen(false);
                    setFormError(null);
                  }}
                  disabled={createThread.isPending}
                >
                  Отмена
                </Button>
                <Button
                  onClick={() => createThread.mutate()}
                  disabled={!canSubmit || createThread.isPending}
                >
                  {createThread.isPending ? "Создание..." : "Создать тему"}
                </Button>
              </div>
            </div>
          ) : null}

          {(data?.data.length ?? 0) === 0 ? (
            <EmptyState
              icon={<MessagesSquare className="h-12 w-12" />}
              title="В категории пока нет тем"
              description={
                isAuthenticated()
                  ? "Станьте первым — создайте тему кнопкой выше."
                  : "Войдите, чтобы создать первую тему."
              }
            />
          ) : (
            <div className="space-y-2">
              {data!.data.map((t) => (
                <ThreadRow key={t.id} thread={t} />
              ))}
            </div>
          )}

          {/* Пагинация (?page=) */}
          {data && data.pagination.pages > 1 ? (
            <nav className="flex items-center justify-center gap-4 mt-10" aria-label="Постраничная навигация">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => changePage(page - 1)}
              >
                Назад
              </Button>
              <span className="text-sm text-content-secondary">
                Страница {data.pagination.page} из {data.pagination.pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= data.pagination.pages}
                onClick={() => changePage(page + 1)}
              >
                Вперёд
              </Button>
            </nav>
          ) : null}
        </>
      )}
    </div>
  );
}

export default function CategoryPage() {
  // useSearchParams требует Suspense-границу при пререндере (как /resources).
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-5xl px-4 py-10">
          <LoadingSpinner label="Загрузка категории..." />
        </div>
      }
    >
      <CategoryPageContent />
    </Suspense>
  );
}