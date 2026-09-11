// PLAN-007 E-001: /content hub — the CONTENT pillar surface. Published
// articles only, category filter (real categories), honest pagination.
// Guest-readable (§29); writing CTA only for users (§30).
"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchContentHub, type ArticleCard } from "@/lib/api-ext";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Button } from "@/components/ui/Button";
import { LoadingSpinner, EmptyState, ErrorState } from "@/components/ui/States";
import { formatDate, ARTICLE_CATEGORY_LABELS, categoryLabel } from "@/lib/domain";
import { FileText, MessageSquare, PenLine, ChevronLeft, ChevronRight } from "lucide-react";

const CATEGORIES = ["GUIDES", "NEWS", "REVIEWS", "OPINION"] as const;

function ArticleCardView({ article }: { article: ArticleCard }) {
  return (
    <Link
      href={`/content/articles/${article.slug}`}
      className="group flex flex-col rounded-card border border-line bg-surface p-4 transition-colors hover:border-accent/40"
    >
      {article.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={article.coverUrl}
          alt=""
          loading="lazy"
          className="mb-3 h-36 w-full rounded-card object-cover"
        />
      ) : (
        <div className="mb-3 flex h-36 w-full items-center justify-center rounded-card border border-line bg-background">
          <FileText className="h-8 w-8 text-content-muted" />
        </div>
      )}
      <span className="text-xs font-medium uppercase tracking-wide text-accent">
        {categoryLabel(article.category)}
      </span>
      <span className="mt-1 line-clamp-2 text-base font-semibold group-hover:text-accent-strong">
        {article.title}
      </span>
      <span className="mt-1 line-clamp-3 text-sm text-content-secondary">{article.excerpt}</span>
      <span className="mt-3 flex items-center justify-between text-xs text-content-muted">
        <span>
          {article.author?.displayName || article.author?.username || "Автор"} ·{" "}
          {formatDate(article.publishedAt)}
        </span>
        <span className="inline-flex items-center gap-1">
          <MessageSquare className="h-3.5 w-3.5" />
          {article.replyCount}
        </span>
      </span>
    </Link>
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
          className={`rounded-full border px-3 py-1.5 text-sm ${
            !category ? "border-accent bg-accent/10 text-accent-strong" : "border-line bg-surface text-content-secondary hover:border-accent/40"
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
            className={`rounded-full border px-3 py-1.5 text-sm ${
              category === c ? "border-accent bg-accent/10 text-accent-strong" : "border-line bg-surface text-content-secondary hover:border-accent/40"
            }`}
          >
            {ARTICLE_CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>

      {isLoading ? (
        <LoadingSpinner label="Загрузка статей…" className="mt-10" />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : !data || data.data.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-12 w-12 text-content-muted mx-auto mb-4" />}
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
              <span className="text-sm text-content-secondary">
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
