// PLAN-005 W + PLAN-007 E-004: global search page — explicit, typed result
// groups: Resources / Servers / Discussions / Articles. Fixes the PLAN-006
// hero gap (the search box pushed to /search, but the page itself was never
// built — honest repair recorded in the PLAN-007 EXECUTION RECORD).
//
// PLAN-016 D-005: react-query + URL-sync как на /resources — URL (`?q=`)
// единственный источник истины; ввод в инпуте уходит в URL с дебаунсом
// (replace, не пушим историю при наборе); запрос через useQuery с
// placeholderData, локаторы/тексты E2E (plan007 E-004, pill «Статьи <n>»)
// сохранены.
"use client";

import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { search, getErrorMessage } from "@/lib/api-ext";
import { LoadingSpinner, EmptyState } from "@/components/ui/States";
import { categoryLabel } from "@/lib/domain";
import { Search, FileText } from "lucide-react";

function SearchPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";

  // Локальное значение инпута: мгновенный отклик, URL обновляется с
  // дебаунсом (шаблон /resources).
  const [searchInput, setSearchInput] = useState(urlQuery);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPushedQuery = useRef<string | null>(null);

  // Синхронизация инпута при навигации назад/вперёд и по ссылкам.
  useEffect(() => {
    setSearchInput(urlQuery);
  }, [urlQuery]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const pushQueryReplace = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value.trim()) params.set("q", value.trim());
    else params.delete("q");
    const queryString = params.toString();
    if (queryString === (lastPushedQuery.current ?? "")) return;
    lastPushedQuery.current = queryString;
    router.replace(queryString ? `/search?${queryString}` : "/search", { scroll: false });
  };

  const onQueryChange = (value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => pushQueryReplace(value), 350);
  };

  const query = urlQuery.trim();
  const hasQuery = query.length >= 2;

  const { data: results, isLoading, error, refetch } = useQuery({
    queryKey: ["search", query],
    queryFn: () => search(query),
    enabled: hasQuery,
    placeholderData: keepPreviousData,
  });

  const total = results
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
          if (debounceRef.current) clearTimeout(debounceRef.current);
          pushQueryReplace(searchInput);
          setSearchInput(searchInput.trim());
        }}
      >
        <input
          type="search"
          value={searchInput}
          onChange={(e) => onQueryChange(e.target.value)}
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
      ) : isLoading ? (
        <LoadingSpinner label="Поиск…" className="mt-10" />
      ) : error ? (
        <p className="mt-10 text-sm text-bad" role="alert">
          {getErrorMessage(error, "Поиск недоступен")}
          <button
            type="button"
            onClick={() => refetch()}
            className="ml-2 rounded-pill border border-line px-2 py-0.5 text-xs text-content-secondary hover:border-accent/40 hover:text-content"
          >
            Повторить
          </button>
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
                    <span className="flex flex-shrink-0 items-center gap-1.5 text-xs tabular-nums text-content-secondary">
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