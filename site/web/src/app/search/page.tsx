// PLAN-005 W + PLAN-007 E-004: global search page — explicit, typed result
// groups: Resources / Servers / Discussions / Articles. Fixes the PLAN-006
// hero gap (the search box pushed to /search, but the page itself was never
// built — honest repair recorded in the PLAN-007 EXECUTION RECORD).
"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { search, type SearchResults } from "@/lib/api-ext";
import { LoadingSpinner, EmptyState } from "@/components/ui/States";
import { categoryLabel } from "@/lib/domain";
import { Search, FileText } from "lucide-react";

function SearchPageInner() {
  const searchParams = useSearchParams();
  const initial = searchParams.get("q") ?? "";
  const [q, setQ] = useState(initial);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setQ(initial);
  }, [initial]);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setResults(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    search(query)
      .then((r) => {
        if (!cancelled) setResults(r);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.response?.data?.error ?? "Поиск недоступен");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);

  const hasQuery = q.trim().length >= 2;
  const total =
    results
      ? results.resources.count +
        results.servers.count +
        results.threads.count +
        (results.articles?.count ?? 0)
      : 0;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Поиск</h1>
      <form
        className="mt-4 flex gap-2"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const params = new URLSearchParams(window.location.search);
          if (q.trim()) params.set("q", q.trim());
          else params.delete("q");
          window.history.replaceState(null, "", `/search?${params.toString()}`);
          setQ(q.trim());
        }}
      >
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ресурсы, серверы, обсуждения, статьи…"
          aria-label="Поисковый запрос"
          className="w-full rounded-card border border-line bg-surface px-4 py-2.5 text-sm text-content placeholder:text-content-muted outline-none transition-colors duration-fast focus-visible:ring-2 focus-visible:ring-accent"
        />
        <button
          type="submit"
          className="rounded-card border border-line bg-surface px-4 text-content-secondary transition-colors duration-fast hover:border-accent/40 hover:text-content"
          aria-label="Искать"
        >
          <Search className="h-4 w-4" />
        </button>
      </form>

      {!hasQuery ? (
        <div className="mt-10">
          <EmptyState
            icon={<Search className="h-12 w-12 text-content-muted mx-auto mb-4" />}
            title="Введите запрос"
            description="Минимум 2 символа. Поиск ищет по ресурсам, серверам, обсуждениям и статьям."
          />
        </div>
      ) : loading ? (
        <LoadingSpinner label="Поиск…" className="mt-10" />
      ) : error ? (
        <p className="mt-10 text-sm text-bad" role="alert">
          {error}
        </p>
      ) : results && total === 0 ? (
        <div className="mt-10">
          <EmptyState
            icon={<Search className="h-12 w-12 text-content-muted mx-auto mb-4" />}
            title="Ничего не найдено"
            description={`По запросу «${results.query}» нет результатов. Попробуйте другое слово.`}
          />
        </div>
      ) : results ? (
        <div className="mt-8 space-y-8">
          {results.articles && results.articles.data.length > 0 ? (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-content-muted">
                Статьи
                <span className="rounded-pill bg-surface-hover px-2 py-0.5 tabular-nums text-content-secondary">
                  {results.articles.count}
                </span>
              </h2>
              <div className="space-y-2">
                {results.articles.data.map((a) => (
                  <Link
                    key={a.id}
                    href={`/content/articles/${a.slug}`}
                    className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-3 transition-colors duration-fast hover:border-accent/40 hover:bg-surface-hover"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <FileText className="h-4 w-4 flex-shrink-0 text-accent" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{a.title}</span>
                        <span className="block truncate text-xs text-content-secondary">{a.excerpt}</span>
                      </span>
                    </span>
                    <span className="flex-shrink-0 text-xs text-content-muted">{categoryLabel(a.category)}</span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {results.resources.data.length > 0 ? (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-content-muted">
                Ресурсы
                <span className="rounded-pill bg-surface-hover px-2 py-0.5 tabular-nums text-content-secondary">
                  {results.resources.count}
                </span>
              </h2>
              <div className="space-y-2">
                {results.resources.data.map((r) => (
                  <Link
                    key={r.id}
                    href={`/resources/${r.slug}`}
                    className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-3 transition-colors duration-fast hover:border-accent/40 hover:bg-surface-hover"
                  >
                    <span className="truncate text-sm font-medium">{r.title}</span>
                    <span className="flex-shrink-0 text-xs text-content-secondary">Ресурс</span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {results.servers.data.length > 0 ? (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-content-muted">
                Серверы
                <span className="rounded-pill bg-surface-hover px-2 py-0.5 tabular-nums text-content-secondary">
                  {results.servers.count}
                </span>
              </h2>
              <div className="space-y-2">
                {results.servers.data.map((s) => (
                  <Link
                    key={s.id}
                    href={`/servers/${s.slug}`}
                    className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-3 transition-colors duration-fast hover:border-accent/40 hover:bg-surface-hover"
                  >
                    <span className="truncate text-sm font-medium">{s.name}</span>
                    <span className="flex flex-shrink-0 items-center gap-1.5 text-xs text-content-secondary">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${(s.playerCount ?? 0) > 0 ? "bg-ok" : "bg-line-strong"}`}
                        aria-hidden
                      />
                      {s.playerCount ?? 0} онлайн
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {results.threads.data.length > 0 ? (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-content-muted">
                Обсуждения
                <span className="rounded-pill bg-surface-hover px-2 py-0.5 tabular-nums text-content-secondary">
                  {results.threads.count}
                </span>
              </h2>
              <div className="space-y-2">
                {results.threads.data.map((t) => (
                  <Link
                    key={t.id}
                    href={`/community/forum/thread/${t.id}`}
                    className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-3 transition-colors duration-fast hover:border-accent/40 hover:bg-surface-hover"
                  >
                    <span className="truncate text-sm font-medium">{t.title}</span>
                    <span className="flex-shrink-0 text-xs tabular-nums text-content-secondary">
                      {t.replyCount} ответов
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}


// useSearchParams() requires a Suspense boundary for static prerender.
export default function SearchPage() {
  return (
    <Suspense fallback={<LoadingSpinner label="Поиск…" className="mt-10" />}>
      <SearchPageInner />
    </Suspense>
  );
}
