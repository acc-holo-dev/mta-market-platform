// PLAN-005 W + PLAN-007 E-004 + PLAN-018 H-001..H-003: global search page —
// explicit, typed result groups: Resources / Servers / Discussions / Articles
// + Services / Creators / News, и строка фильтров (H-002), wired to the
// extended GET /search contract. Fixes the PLAN-006 hero gap.
//
// PLAN-016 D-005: react-query + URL-sync как на /resources — URL единственный
// источник истины (q И фильтры); ввод в инпуте уходит в URL с дебаунсом
// (replace, не пушим историю при наборе); фильтры меняют URL сразу.
// Локаторы/тексты E2E (plan007 E-004, pill «Статьи <n>») сохранены.
"use client";

import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { search, getErrorMessage, formatRub, type SearchFilters } from "@/lib/api-ext";
import { LoadingSpinner, EmptyState } from "@/components/ui/States";
import { categoryLabel, typeLabel, TYPE_LABELS } from "@/lib/domain";
import { Avatar } from "@/components/ui/Avatar";
import { Search, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------- H-002 фильтры (URL — источник истины) ----------

const TYPE_CHIPS: { key: string; label: string }[] = [
  { key: "resources", label: "Ресурсы" },
  { key: "servers", label: "Серверы" },
  { key: "services", label: "Услуги" },
  { key: "creators", label: "Создатели" },
  { key: "threads", label: "Обсуждения" },
  { key: "news", label: "Новости" },
  { key: "articles", label: "Статьи" },
];

const RESOURCE_CATEGORIES = Object.entries(TYPE_LABELS).filter(([key]) => key !== "CUSTOM_SCRIPT");

/** namespaced key (замороженный searchKeys.resultsKey + leaf с фильтрами). */
const resultsKey = (q: string, filters: string) => ["search", "results", q, filters] as const;

function serializeFilters(
  type: string,
  category: string,
  price: string,
  verified: boolean,
  ratingMin: string,
  updatedWithin: string
): string {
  const f: SearchFilters = {
    ...(type ? { type } : {}),
    ...(category ? { category } : {}),
    ...(price ? { price: price as "free" | "paid" } : {}),
    ...(verified ? { verified: true } : {}),
    ...(ratingMin ? { rating_min: ratingMin } : {}),
    ...(updatedWithin ? { updated_within: updatedWithin as "7d" | "30d" } : {}),
  };
  return JSON.stringify(f);
}

function SearchPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlQuery = searchParams.get("q") ?? "";

  // Фильтры живут ТОЛЬКО в URL (?type=&category=&price=&verified=&rating_min=&updated_within=).
  const urlType = searchParams.get("type") ?? "";
  const urlCategory = searchParams.get("category") ?? "";
  const urlPrice = searchParams.get("price") ?? "";
  const urlVerified = ["true", "1"].includes(searchParams.get("verified") ?? "");
  const urlRatingMin = searchParams.get("rating_min") ?? "";
  const urlUpdatedWithin = searchParams.get("updated_within") ?? "";

  const activeTypes = urlType
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const resourceFiltersVisible =
    activeTypes.length === 0 || activeTypes.includes("resources");

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

  const pushParams = (mutate: (params: URLSearchParams) => void) => {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    const queryString = params.toString();
    // Держим debaunce-гард в sync с фактическим URL (иначе очистка q сразу
    // после смены фильтра может быть пропущена как «без изменений»).
    lastPushedQuery.current = queryString;
    router.replace(queryString ? `/search?${queryString}` : "/search", { scroll: false });
  };

  const setParam = (key: string, value: string) => {
    pushParams((params) => {
      if (value) params.set(key, value);
      else params.delete(key);
    });
  };

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

  const filtersKey = serializeFilters(
    urlType,
    urlCategory,
    urlPrice,
    urlVerified,
    urlRatingMin,
    urlUpdatedWithin
  );

  const { data: results, isLoading, error, refetch } = useQuery({
    queryKey: resultsKey(query, filtersKey),
    queryFn: () =>
      search(query, {
        type: urlType || undefined,
        category: urlCategory || undefined,
        price: (urlPrice as "free" | "paid") || undefined,
        verified: urlVerified || undefined,
        rating_min: urlRatingMin || undefined,
        updated_within: (urlUpdatedWithin as "7d" | "30d") || undefined,
      }),
    enabled: hasQuery,
    placeholderData: keepPreviousData,
  });

  const total = results
    ? results.resources.count +
      results.servers.count +
      results.threads.count +
      (results.articles?.count ?? 0) +
      (results.services?.count ?? 0) +
      (results.creators?.count ?? 0) +
      (results.news?.count ?? 0)
    : 0;

  const hasActiveTypeFilter = activeTypes.length > 0;

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

      {/* H-002: строка фильтров — multi-select типов + фильтры ресурсов */}
      <div className="mt-4 space-y-3" role="group" aria-label="Фильтры поиска">
        <div className="flex flex-wrap items-center gap-1.5">
          {TYPE_CHIPS.map(({ key, label }) => {
            const selected = activeTypes.includes(key);
            return (
              <button
                key={key}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  const next = selected
                    ? activeTypes.filter((t) => t !== key)
                    : [...activeTypes, key];
                  setParam("type", next.join(","));
                }}
                className={cn(
                  "rounded-pill border px-3 py-1 text-xs font-medium transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                  selected
                    ? "border-accent bg-accent-soft text-accent-strong"
                    : "border-line bg-surface text-content-secondary hover:border-accent/40 hover:text-content"
                )}
              >
                {label}
              </button>
            );
          })}
          {hasActiveTypeFilter ? (
            <button
              type="button"
              onClick={() => setParam("type", "")}
              className="rounded-pill px-2 py-1 text-xs text-content-muted transition-colors duration-fast hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Сбросить типы
            </button>
          ) : null}
        </div>

        {resourceFiltersVisible ? (
          <div className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface p-3">
            <label className="flex items-center gap-1.5 text-xs text-content-secondary">
              Категория
              <select
                value={urlCategory}
                onChange={(e) => setParam("category", e.target.value)}
                aria-label="Категория ресурсов"
                className="h-8 rounded-md border border-line-strong bg-surface-raised px-2 text-xs text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <option value="">Все</option>
                {RESOURCE_CATEGORIES.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-content-secondary">
              Цена
              <select
                value={urlPrice}
                onChange={(e) => setParam("price", e.target.value)}
                aria-label="Цена"
                className="h-8 rounded-md border border-line-strong bg-surface-raised px-2 text-xs text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <option value="">Все</option>
                <option value="free">Бесплатно</option>
                <option value="paid">Платные</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-content-secondary">
              Рейтинг
              <select
                value={urlRatingMin}
                onChange={(e) => setParam("rating_min", e.target.value)}
                aria-label="Минимальный рейтинг"
                className="h-8 rounded-md border border-line-strong bg-surface-raised px-2 text-xs text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <option value="">Любой</option>
                <option value="4">4+</option>
                <option value="3">3+</option>
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-content-secondary">
              Обновлено
              <select
                value={urlUpdatedWithin}
                onChange={(e) => setParam("updated_within", e.target.value)}
                aria-label="Обновлено за"
                className="h-8 rounded-md border border-line-strong bg-surface-raised px-2 text-xs text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <option value="">За всё время</option>
                <option value="7d">7 дней</option>
                <option value="30d">30 дней</option>
              </select>
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-content-secondary">
              <input
                type="checkbox"
                checked={urlVerified}
                onChange={(e) => setParam("verified", e.target.checked ? "true" : "")}
                className="accent-accent"
                aria-label="Только проверенные"
              />
              Только проверенные
            </label>
            {(urlCategory || urlPrice || urlRatingMin || urlUpdatedWithin || urlVerified) ? (
              <button
                type="button"
                onClick={() =>
                  pushParams((params) => {
                    params.delete("category");
                    params.delete("price");
                    params.delete("rating_min");
                    params.delete("updated_within");
                    params.delete("verified");
                  })
                }
                className="ml-auto text-xs text-content-muted transition-colors duration-fast hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
              >
                Сбросить фильтры
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {!hasQuery ? (
        <div className="mt-10">
          <EmptyState
            icon={<Search className="h-12 w-12 text-content-muted mx-auto mb-4" />}
            title="Введите запрос"
            description="Минимум 2 символа. Поиск ищет по ресурсам, серверам, обсуждениям, статьям, услугам, создателям и новостям."
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
            description={`По запросу «${results.query}» нет результатов. Попробуйте другое слово или сбросьте фильтры.`}
          />
        </div>
      ) : results ? (
        <div className="mt-8 space-y-8">
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
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{r.title}</span>
                      <span className="block text-xs text-content-secondary">
                        {r.type ? typeLabel(r.type) : "Ресурс"}
                      </span>
                    </span>
                    <span className="flex-shrink-0 text-xs text-content-secondary tabular-nums">
                      {r.price === 0 ? "Бесплатно" : r.price != null ? formatRub(r.price) : ""}
                    </span>
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

          {/* PLAN-018 H-001: услуги */}
          {results.services && results.services.data.length > 0 ? (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-content-muted">
                Услуги
                <span className="rounded-pill bg-surface-hover px-2 py-0.5 tabular-nums text-content-secondary">
                  {results.services.count}
                </span>
              </h2>
              <div className="space-y-2">
                {results.services.data.map((s) => (
                  <Link
                    key={s.id}
                    href={`/services/${s.slug}`}
                    className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-3 transition-colors duration-fast hover:border-accent/40 hover:bg-surface-hover"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{s.title}</span>
                      <span className="block text-xs text-content-secondary">
                        {s.type ? typeLabel(s.type) : "Услуга"}
                        {s.deliveryDays ? ` · ${s.deliveryDays} дн.` : ""}
                      </span>
                    </span>
                    <span className="flex-shrink-0 text-xs text-content-secondary tabular-nums">
                      {s.price === 0 ? "Бесплатно" : formatRub(s.price)}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          {/* PLAN-018 H-001: создатели */}
          {results.creators && results.creators.data.length > 0 ? (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-content-muted">
                Создатели
                <span className="rounded-pill bg-surface-hover px-2 py-0.5 tabular-nums text-content-secondary">
                  {results.creators.count}
                </span>
              </h2>
              <div className="space-y-2">
                {results.creators.data.map((c) => (
                  <Link
                    key={c.id}
                    href={`/sellers/${c.username}`}
                    className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-3 transition-colors duration-fast hover:border-accent/40 hover:bg-surface-hover"
                  >
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Avatar src={c.avatar} name={c.displayName || c.username} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {c.displayName || c.username}
                        </span>
                        <span className="block truncate text-xs text-content-secondary">
                          @{c.username}
                        </span>
                      </span>
                    </span>
                    <span className="flex-shrink-0 text-xs tabular-nums text-content-secondary">
                      {c.followers} подписчиков
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

          {/* PLAN-018 H-001: новости серверов */}
          {results.news && results.news.data.length > 0 ? (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-content-muted">
                Новости
                <span className="rounded-pill bg-surface-hover px-2 py-0.5 tabular-nums text-content-secondary">
                  {results.news.count}
                </span>
              </h2>
              <div className="space-y-2">
                {results.news.data.map((n) =>
                  n.server?.slug ? (
                    <Link
                      key={n.id}
                      href={`/servers/${n.server.slug}`}
                      className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-3 transition-colors duration-fast hover:border-accent/40 hover:bg-surface-hover"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{n.title}</span>
                        <span className="block truncate text-xs text-content-secondary">
                          {n.excerpt}
                        </span>
                      </span>
                      <span className="flex-shrink-0 text-xs text-content-muted">
                        {n.server.name}
                      </span>
                    </Link>
                  ) : (
                    <div
                      key={n.id}
                      className="flex items-center justify-between gap-3 rounded-card border border-line bg-surface p-3"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{n.title}</span>
                        <span className="block truncate text-xs text-content-secondary">
                          {n.excerpt}
                        </span>
                      </span>
                    </div>
                  )
                )}
              </div>
            </section>
          ) : null}

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
