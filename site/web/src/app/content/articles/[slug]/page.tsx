// PLAN-007 E-002: article page — cover, author, plain-text content (never
// raw HTML), explicit links only (B-002) and the discussion thread. Every
// element is a next step (no dead ends, SURFACE-MAP §53).
// PLAN-013: editorial reading experience — rounded-card cover, author line
// (avatar + name + date), max-w-prose paragraphs with relaxed leading.
"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { fetchArticle } from "@/lib/api-ext";
import { EmptyState } from "@/components/ui/States";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { formatDate, categoryLabel } from "@/lib/domain";
import { FileText, MessageSquare, Server, ShieldCheck, ArrowLeft } from "lucide-react";

// No resource prices: exported for tests and reuse.
export default function ArticlePage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug;

  const { data: article, isLoading, error, refetch } = useQuery({
    queryKey: ["content", "article", slug],
    queryFn: () => fetchArticle(slug as string),
    enabled: !!slug,
  });

  if (!slug || isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10" aria-busy="true">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="mt-5 aspect-video w-full rounded-lg" />
        <Skeleton className="mt-6 h-10 w-3/4" />
        <Skeleton className="mt-3 h-4 w-1/3" />
        <div className="mt-8 space-y-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className={`h-4 ${i % 3 === 2 ? "w-2/3" : "w-full"}`} />
          ))}
        </div>
      </div>
    );
  }
  if (error || !article) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          icon={<FileText className="mx-auto mb-4 h-12 w-12 text-content-muted" />}
          title="Статья недоступна"
          description="Она была снята с публикации или ещё не существует."
          action={
            <Link href="/content">
              <Button variant="outline" size="sm">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Все статьи
              </Button>
            </Link>
          }
        />
      </div>
    );
  }

  const paragraphs = article.content
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <article className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/content" className="inline-flex items-center gap-1 text-sm text-content-secondary transition-colors duration-fast hover:text-accent-strong">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Все статьи
      </Link>

      {article.coverUrl ? (
        <div className="mt-5 overflow-hidden rounded-lg border border-line shadow-card">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={article.coverUrl} alt={article.title} loading="lazy" className="aspect-video w-full object-cover" />
        </div>
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-pill border border-accent/40 bg-accent-soft px-2.5 py-1 font-medium text-accent-strong">
          {categoryLabel(article.category)}
        </span>
        {article.tags
          ? article.tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
              .map((t) => (
                <span key={t} className="rounded-pill border border-line px-2.5 py-1 text-content-secondary">
                  {t}
                </span>
              ))
          : null}
      </div>

      <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight md:text-4xl">{article.title}</h1>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-content-muted">
        {article.author ? (
          <>
            <Avatar
              src={article.author.avatar}
              name={article.author.displayName || article.author.username || "Автор"}
              size="sm"
              className="h-6 w-6 text-[11px]"
            />
            <Link href={`/profile/${article.author.username}`} className="font-medium text-content-secondary transition-colors duration-fast hover:text-accent-strong">
              {article.author.displayName || article.author.username}
            </Link>
          </>
        ) : (
          <span>Автор</span>
        )}
        <span aria-hidden>·</span>
        <span className="tabular-nums">{formatDate(article.publishedAt)}</span>
      </div>

      <div className="mt-8 max-w-prose space-y-4">
        {paragraphs.map((p, i) => (
          <p key={i} className="text-base leading-relaxed whitespace-pre-wrap text-content">
            {p}
          </p>
        ))}
      </div>

      {(article.resources.length > 0 || article.servers.length > 0) && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold tracking-tight">Связанное</h2>
          <div className="mt-3 space-y-2">
            {article.resources.map((r) => (
              <Link
                key={r.slug}
                href={`/resources/${r.slug}`}
                className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-3 shadow-card transition-colors duration-fast hover:border-accent/40 hover:bg-surface-hover"
              >
                <span className="flex min-w-0 items-center gap-3">
                  {r.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.coverUrl} alt="" loading="lazy" className="h-10 w-14 rounded object-cover" />
                  ) : (
                    <span className="flex h-10 w-14 flex-shrink-0 items-center justify-center rounded bg-surface-inset">
                      <FileText className="h-5 w-5 text-content-muted" aria-hidden />
                    </span>
                  )}
                  <span className="truncate text-sm font-medium">{r.title}</span>
                </span>
                <span className="flex-shrink-0 rounded-pill border border-line bg-surface-inset px-2 py-0.5 text-xs text-content-secondary">
                  Ресурс
                </span>
              </Link>
            ))}
            {article.servers.map((s) => (
              <Link
                key={s.slug}
                href={`/servers/${s.slug}`}
                className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-3 shadow-card transition-colors duration-fast hover:border-accent/40 hover:bg-surface-hover"
              >
                <span className="flex min-w-0 items-center gap-3">
                  {s.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.logoUrl} alt="" loading="lazy" className="h-8 w-8 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-surface-inset">
                      <Server className="h-4 w-4 text-content-muted" aria-hidden />
                    </span>
                  )}
                  <span className="truncate text-sm font-medium">{s.name}</span>
                </span>
                <span className="flex flex-shrink-0 items-center gap-1 text-xs text-content-secondary">
                  {s.monitoring === "ONLINE" ? (
                    <>
                      <ShieldCheck className="h-3.5 w-3.5 text-ok" aria-hidden />
                      <span className="tabular-nums">{s.playerCount ?? 0}</span> онлайн
                    </>
                  ) : (
                    "Сервер"
                  )}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mt-10 rounded-lg border border-line bg-surface p-5 shadow-card">
        <h2 className="text-lg font-semibold tracking-tight">Обсуждение</h2>
        {article.thread ? (
          <Link
            href={`/community/forum/thread/${article.thread.id}`}
            className="mt-3 inline-flex items-center gap-2 rounded-pill border border-accent/30 bg-accent-soft px-4 py-2 text-sm font-medium text-accent-strong transition-colors duration-fast hover:bg-accent hover:text-white"
          >
            <MessageSquare className="h-4 w-4" aria-hidden />
            {article.thread.replyCount} {article.thread.replyCount === 1 ? "ответ" : "ответов"} — открыть тред
          </Link>
        ) : (
          <p className="mt-2 text-sm text-content-secondary">Обсуждение к этой статье пока не открыто.</p>
        )}
      </section>
    </article>
  );
}