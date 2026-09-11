// Глобальная лента новостей (PLAN-005 H-005): публичный фид новостей и
// обновлений серверов с вкладками Все | Новости | Обновления. ?page= в URL.
"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Newspaper, RefreshCcw, Globe, User } from "lucide-react";
import { bootstrapSession } from "@/lib/api";
import {
  fetchNewsFeed,
  mediaUrl,
  type NewsFeedItem,
} from "@/lib/api-ext";
import { Button } from "@/components/ui/Button";
import { Tabs } from "@/components/ui/Tabs";
import { LoadingSpinner, EmptyState, ErrorState } from "@/components/ui/States";
import { Avatar } from "@/components/ui/Avatar";

type Kind = "all" | "news" | "updates";

// GET /news не возвращает pagination-метаданные (только {data}); сервер
// ограничивает страницу 12 элементами — на этой основе включаем «Вперёд».
const PAGE_SIZE = 12;

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function KindChip({ item }: { item: NewsFeedItem }) {
  if (item.kind === "UPDATE") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-hover px-2 py-0.5 text-xs text-content-secondary">
        <RefreshCcw className="h-3 w-3" aria-hidden />
        Обновление{item.version ? ` v${item.version}` : ""}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent-soft px-2 py-0.5 text-xs text-accent-strong">
      <Newspaper className="h-3 w-3" aria-hidden />
      Новость
    </span>
  );
}

function NewsRow({ item }: { item: NewsFeedItem }) {
  const cover = mediaUrl(item.coverUrl ?? null);
  const authorName = item.author?.displayName || item.author?.username || null;

  return (
    <div className="p-4 rounded-card border border-line bg-surface-raised">
      <div className="flex flex-col gap-3 sm:flex-row">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt={item.title}
            loading="lazy"
            className="h-28 w-full flex-shrink-0 rounded-md object-cover sm:w-48"
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <KindChip item={item} />
            {item.server ? (
              <Link
                href={`/servers/${item.server.slug}`}
                className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-xs text-content-secondary hover:text-accent-strong"
              >
                <Globe className="h-3 w-3" aria-hidden />
                {item.server.name}
              </Link>
            ) : null}
          </div>
          <h2 className="mt-2 font-semibold leading-snug">{item.title}</h2>
          <p className="mt-1 line-clamp-2 text-sm text-content-secondary">{item.preview}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-content-muted">
            {authorName ? (
              <span className="inline-flex items-center gap-1.5">
                <Avatar
                  src={item.author?.avatar}
                  name={authorName}
                  size="sm"
                  className="h-5 w-5 text-[10px]"
                />
                {item.author?.username ? (
                  <Link href={`/profile/${item.author.username}`} className="hover:text-accent-strong">
                    {authorName}
                  </Link>
                ) : (
                  <span>{authorName}</span>
                )}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1">
                <User className="h-3 w-3" aria-hidden />
                Автор
              </span>
            )}
            <span>{formatDateTime(item.publishedAt)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function NewsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const [kind, setKind] = useState<Kind>("all");
  const [booted, setBooted] = useState(false);

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
    queryKey: ["news", "feed", kind, page],
    queryFn: () => fetchNewsFeed(kind, page),
    enabled: booted,
    placeholderData: keepPreviousData,
  });

  if (!booted) return null;

  const items = data?.data ?? [];

  const changePage = (next: number) => {
    router.push(next > 1 ? `/news?page=${next}` : "/news", { scroll: false });
  };

  const changeKind = (next: Kind) => {
    setKind(next);
    // Смена вкладки сбрасывает пагинацию.
    router.push("/news", { scroll: false });
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight">Новости</h1>
        <p className="mt-1 text-content-secondary">
          Новости и обновления серверов сообщества MTA:SA
        </p>
      </div>

      <div className="mb-4">
        <Tabs
          tabs={[
            ["all", "Все"],
            ["news", "Новости"],
            ["updates", "Обновления"],
          ]}
          value={kind}
          onChange={changeKind}
        />
      </div>

      {isLoading ? (
        <LoadingSpinner label="Загрузка ленты..." />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Newspaper className="h-12 w-12" />}
          title="Новостей пока нет"
          description="Публикации серверов появятся здесь после выхода."
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <NewsRow key={`${item.kind}-${item.id}`} item={item} />
          ))}
        </div>
      )}

      {/* Пагинация: без метаданных — «Вперёд» включена, пока страница заполнена */}
      {items.length > 0 ? (
        <nav className="flex items-center justify-center gap-4 mt-10" aria-label="Постраничная навигация">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => changePage(page - 1)}>
            Назад
          </Button>
          <span className="text-sm text-content-secondary">Страница {page}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={items.length < PAGE_SIZE}
            onClick={() => changePage(page + 1)}
          >
            Вперёд
          </Button>
        </nav>
      ) : null}
    </div>
  );
}

export default function NewsPage() {
  // useSearchParams требует Suspense-границу при пререндере (как /resources).
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-5xl px-4 py-10">
          <LoadingSpinner label="Загрузка ленты..." />
        </div>
      }
    >
      <NewsPageContent />
    </Suspense>
  );
}