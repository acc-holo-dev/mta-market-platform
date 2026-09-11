// PLAN-007 E-001: /content hub — the CONTENT pillar surface. Published
// articles only, category filter (real categories), honest pagination.
// Guest-readable (§29); writing CTA only for users (§30).
// PLAN-013: article cards — aspect-video cover (lazy) / typographic fallback,
// category chip (accent-soft), H3 title, author+date caption; skeleton loading.
"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchContentHub, type ArticleCard } from "@/lib/api-ext";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatDate, ARTICLE_CATEGORY_LABELS, categoryLabel } from "@/lib/domain";
import { FileText, MessageSquare, PenLine, ChevronLeft, ChevronRight } from "lucide-react";

const CATEGORIES = ["GUIDES", "NEWS", "REVIEWS", "OPINION"] as const;

function ArticleCardView({ article }: { article: ArticleCard }) {
  return (
    <Link
      href={`/content/articles/${article.slug}`}
      className="group flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card transition-all duration-fast hover:border-accent/40 hover:shadow-raised"
    >
      {article.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={article.coverUrl}
          alt=""
          loading="lazy"
          className="aspect-video w-full object-cover"
        />
      ) : (
        <div className="flex aspect-video w-full items-center justify-center border-b border-line bg-surface-inset">
          <FileText className="h-8 w-8 text-content-muted" aria-hidden />
        </div>
      )}
      <div className="flex flex-1 flex-col p-4">
        <span className="self-start rounded-pill border border-accent/30 bg-accent-soft px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-accent-strong">
          {categoryLabel(article.category)}
        </span>
        <span className="mt-2 line-clamp-2 text-lg font-semibold tracking-tight transition-colors duration-fast group-hover:text-accent-strong">
          {article.title}
        </span>
        <span className="mt-1.5 line-clamp-3 text-sm text-content-secondary">{article.excerpt}</span>
        <span className="mt-auto flex items-center justify-between gap-2 pt-4 text-xs text-content-muted">
          <span className="truncate">
            {article.author?.displayName || article.author?.username || "Автор"} ·{" "}
            <span className="tabular-nums">{formatDate(article.publishedAt)}</span>
          </span>
          <span className="inline-flex flex-shrink-0 items-center gap-1 tabular-nums">
            <MessageSquare className="h-3.5 w-3.5" aria-hidden />
            {article.replyCount}
          </span>
        </span>
      </div>
    </Link>
  );
}

function ArticleCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface">
      <Skeleton className="aspect-video rounded-none" />
      <div className="space-y-3 p-4">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-5 w-3/4" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

export default function ContentHubPage() {
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [page, setPage] = useState(1);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["content", "hub", category ?? "all", page],
    queryFn: () => fetchContentHub(category, page),
  });

  const total = data?.pagination.total ?? 0;
  const pages = data?.pagination.pages ?? 1;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <SectionHeader
        title="Статьи"
        description="Гайды, новости и разборы экосистемы MTA:SA — от сообщества платформы"
        action={
          <Link href="/content/mine">
            <Button variant="outline" size="sm">
              <PenLine className="mr-2 h-4 w-4" />
              Мои статьи
            </Button>
          </Link>
        }
      />

      <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="Категории статей">
        <button
          onClick={() => {
            setCategory(undefined);
            setPage(1);
          }}
          aria-pressed={!category}
          className={`rounded-pill border px-3 py-1.5 text-sm transition-colors duration-fast ${
            !category
              ? "border-accent bg-accent-soft text-accent-strong"
              : "border-line bg-surface text-content-secondary hover:border-accent/40 hover:text-content"
          }`}
        >
          Все
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => {
              setCategory(c);
              setPage(1);
            }}
            aria-pressed={category === c}
            className={`rounded-pill border px-3 py-1.5 text-sm transition-colors duration-fast ${
              category === c
                ? "border-accent bg-accent-soft text-accent-strong"
                : "border-line bg-surface text-content-secondary hover:border-accent/40 hover:text-content"
            }`}
          >
            {ARTICLE_CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <ArticleCardSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : !data || data.data.length === 0 ? (
        <EmptyState
          icon={<FileText className="mx-auto mb-4 h-12 w-12 text-content-muted" />}
          title="Статей пока нет"
          description="Статьи появляются после модерации. Станьте первым автором — гайды и разборы нужны сообществу."
          action={
            <Link href="/content/new">
              <Button variant="primary" size="sm">
                <PenLine className="mr-2 h-4 w-4" />
                Написать статью
              </Button>
            </Link>
          }
        />
      ) : (
        <>
          <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {data.data.map((a) => (
              <ArticleCardView key={a.id} article={a} />
            ))}
          </div>
          {pages > 1 ? (
            <div className="mt-8 flex items-center justify-center gap-3">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-sm tabular-nums text-content-secondary">
                Страница {page} из {pages} · {total} статей
              </span>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}