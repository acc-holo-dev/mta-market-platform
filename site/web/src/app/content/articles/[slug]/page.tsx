// PLAN-007 E-002: article page — cover, author, plain-text content (never
// raw HTML), explicit links only (B-002) and the discussion thread. Every
// element is a next step (no dead ends, SURFACE-MAP §53).
"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { fetchArticle } from "@/lib/api-ext";
import { LoadingSpinner, EmptyState, ErrorState } from "@/components/ui/States";
import { Button } from "@/components/ui/Button";
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
    return <LoadingSpinner label="Загрузка статьи…" className="mt-16" />;
  }
  if (error || !article) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <EmptyState
          icon={<FileText className="h-12 w-12 text-content-muted mx-auto mb-4" />}
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
      <Link href="/content" className="inline-flex items-center gap-1 text-sm text-content-secondary hover:text-accent-strong">
        <ArrowLeft className="h-4 w-4" />
        Все статьи
      </Link>

      {article.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={article.coverUrl} alt="" className="mt-4 h-56 w-full rounded-card object-cover" />
      ) : null}

      <div className="mt-5 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 font-medium text-accent-strong">
          {categoryLabel(article.category)}
        </span>
        {article.tags
          ? article.tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
              .map((t) => (
                <span key={t} className="rounded-full border border-line px-2.5 py-1 text-content-secondary">
                  {t}
                </span>
              ))
          : null}
      </div>

      <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight">{article.title}</h1>
      <p className="mt-2 text-sm text-content-secondary">
        {article.author ? (
          <Link href={`/profile/${article.author.username}`} className="font-medium hover:text-accent-strong">
            {article.author.displayName || article.author.username}
          </Link>
        ) : (
          "Автор"
        )}{" "}
        · {formatDate(article.publishedAt)}
      </p>

      <div className="mt-8 space-y-4">
        {paragraphs.map((p, i) => (
          <p key={i} className="whitespace-pre-wrap text-[15px] leading-relaxed text-content">
            {p}
          </p>
        ))}
      </div>

      {(article.resources.length > 0 || article.servers.length > 0) && (
        <section className="mt-10">
          <h2 className="text-lg font-semibold">Связанное</h2>
          <div className="mt-3 space-y-2">
            {article.resources.map((r) => (
              <Link
                key={r.slug}
                href={`/resources/${r.slug}`}
                className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-3 hover:border-accent/40"
              >
                <span className="flex min-w-0 items-center gap-3">
                  {r.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.coverUrl} alt="" loading="lazy" className="h-10 w-14 rounded object-cover" />
                  ) : (
                    <FileText className="h-5 w-5 text-content-muted" />
                  )}
                  <span className="truncate text-sm font-medium">{r.title}</span>
                </span>
                <span className="flex-shrink-0 text-xs text-content-secondary">Ресурс</span>
              </Link>
            ))}
            {article.servers.map((s) => (
              <Link
                key={s.slug}
                href={`/servers/${s.slug}`}
                className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-3 hover:border-accent/40"
              >
                <span className="flex min-w-0 items-center gap-3">
                  {s.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.logoUrl} alt="" loading="lazy" className="h-8 w-8 rounded-full object-cover" />
                  ) : (
                    <Server className="h-5 w-5 text-content-muted" />
                  )}
                  <span className="truncate text-sm font-medium">{s.name}</span>
                </span>
                <span className="flex flex-shrink-0 items-center gap-1 text-xs text-content-secondary">
                  {s.monitoring === "ONLINE" ? (
                    <>
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                      {s.playerCount ?? 0} онлайн
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

      <section className="mt-10 rounded-card border border-line bg-surface p-5">
        <h2 className="text-lg font-semibold">Обсуждение</h2>
        {article.thread ? (
          <Link href={`/community/forum/thread/${article.thread.id}`} className="mt-3 inline-flex items-center gap-2 text-sm text-accent-strong hover:underline">
            <MessageSquare className="h-4 w-4" />
            {article.thread.replyCount} {article.thread.replyCount === 1 ? "ответ" : "ответов"} — открыть тред
          </Link>
        ) : (
          <p className="mt-2 text-sm text-content-secondary">Обсуждение к этой статье пока не открыто.</p>
        )}
      </section>
    </article>
  );
}
