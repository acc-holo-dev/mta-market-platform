// Публичная страница новости сервера (PLAN-005 H-005): обложка, автор,
// дата, текст (pre-wrap, без HTML-инъекций) и ссылка на обсуждение.
"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { MessageSquare, Newspaper, User } from "lucide-react";
import {
  fetchServerNewsItem,
  getErrorMessage,
  mediaUrl,
} from "@/lib/api-ext";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { Skeleton } from "@/components/ui/Skeleton";

function formatDateShort(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function ServerNewsItemPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug: rawSlug, id: rawId } = use(params);
  const slug = decodeURIComponent(rawSlug);
  const id = decodeURIComponent(rawId);

  const { data, isLoading, error } = useQuery({
    queryKey: ["server-news-item", slug, id],
    queryFn: () => fetchServerNewsItem(slug, id),
    retry: false,
  });

  const backHref = `/servers/${slug}`;

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <Skeleton className="h-8 w-40 rounded-md" />
        <Skeleton className="mt-6 h-56 w-full rounded-card" />
        <Skeleton className="mt-6 h-8 w-3/4" />
        <Skeleton className="mt-4 h-40 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="text-center py-20">
          <Newspaper className="h-12 w-12 text-content-muted mx-auto mb-4" />
          <h1 className="text-xl font-semibold">Новость не найдена</h1>
          <p className="mt-1 text-sm text-content-secondary">
            {error ? getErrorMessage(error, "Новость недоступна.") : "Новость недоступна."}
          </p>
          <Link href={backHref} className="inline-block mt-6">
            <Button variant="outline">
              <Newspaper className="mr-2 h-4 w-4" />
              К серверу
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const { news, thread, author, server } = data;
  const cover = mediaUrl(news.coverUrl);
  const displayName = author?.displayName || author?.username || "Команда сервера";

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <nav aria-label="Хлебные крошки" className="mb-6 text-sm text-content-muted">
        <Link href="/" className="hover:text-accent-strong">
          Главная
        </Link>
        <span className="mx-2">/</span>
        <Link href="/servers" className="hover:text-accent-strong">
          Серверы
        </Link>
        <span className="mx-2">/</span>
        <Link href={backHref} className="hover:text-accent-strong">
          {server?.name ?? "Сервер"}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-content-secondary">Новость</span>
      </nav>

      {news.status !== "PUBLISHED" ? (
        <p className="mb-4 rounded-card border border-warn/30 bg-warn/10 px-4 py-2 text-sm text-warn">
          Черновик — виден только персоналу сервера.
        </p>
      ) : null}

      <article>
        <h1 className="text-3xl font-bold tracking-tight">{news.title}</h1>

        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-content-secondary">
          {author ? (
            <span className="inline-flex items-center gap-2">
              <Avatar src={author.avatar} name={displayName} size="sm" className="h-8 w-8" />
              {author.username ? (
                <Link href={`/profile/${author.username}`} className="inline-flex items-center gap-1.5 hover:text-accent">
                  <User className="h-4 w-4" />
                  {displayName}
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <User className="h-4 w-4" />
                  {displayName}
                </span>
              )}
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1.5">
            <Newspaper className="h-4 w-4" />
            {formatDateShort(news.publishedAt ?? news.createdAt)}
          </span>
        </div>

        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cover}
            alt={news.title}
            loading="lazy"
            className="mt-6 w-full rounded-card border border-line object-cover"
          />
        ) : null}

        {/* Текст без HTML-рендеринга: pre-wrap защищает от инъекций. */}
        <div className="mt-6 whitespace-pre-wrap text-sm leading-relaxed text-content">
          {news.content}
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-3 border-t border-line pt-6">
          <Link href={backHref}>
            <Button variant="outline" size="sm">
              <Newspaper className="mr-2 h-4 w-4" />
              Все новости сервера
            </Button>
          </Link>
          {thread ? (
            <Link href={`/community/forum/thread/${thread.id}`}>
              <Button size="sm">
                <MessageSquare className="mr-2 h-4 w-4" />
                Обсуждение
                {thread.replyCount > 0 ? ` (${thread.replyCount})` : ""}
              </Button>
            </Link>
          ) : null}
        </div>
      </article>
    </div>
  );
}
