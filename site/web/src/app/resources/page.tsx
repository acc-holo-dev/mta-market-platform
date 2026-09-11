// Marketplace (PLAN-003 F/G/H/I/N/O): магазинный каталог с НАСТОЯЩИМ
// серверным search/filter/sort (единый query contract GET /resources) и
// URL-состоянием: /resources?q=hud&type=SCRIPT&price=free&sort=popular&page=2.
// Search не декоративный — каждый параметр реально влияет на данные (F-006).
"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchResources, type Resource, type ResourceQuery } from "@/lib/api-ext";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Input";
import { ResourceCard } from "@/components/ui/ResourceCard";
import { ResourceCardSkeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/States";
import { Store, SearchX, Search, SlidersHorizontal, X } from "lucide-react";

const PAGE_SIZE = 12;

type TypeFilter = "" | "SCRIPT" | "MAP" | "MODEL" | "TEXTURE" | "SOUND" | "GAMEMODE";
type PriceFilter = "" | "free" | "paid";
type SortKey = "" | "popular" | "newest" | "rating" | "price_asc" | "price_desc";

// G-002: категория = реальный domain type; URL отражает выбор (G-003).
const CATEGORIES: [TypeFilter, string][] = [
  ["", "Все"],
  ["SCRIPT", "Скрипты"],
  ["MAP", "Карты"],
  ["MODEL", "Модели"],
  ["TEXTURE", "Текстуры"],
  ["SOUND", "Звуки"],
  ["GAMEMODE", "Гейммоды"],
];

const PRICE_FILTERS: [PriceFilter, string][] = [
  ["", "Все"],
  ["free", "Бесплатные"],
  ["paid", "Платные"],
];

const SORT_OPTIONS: [SortKey, string][] = [
  ["", "Популярные"],
  ["newest", "Новые"],
  ["rating", "Высокий рейтинг"],
  ["price_asc", "Сначала дешёвые"],
  ["price_desc", "Сначала дорогие"],
];

export default function ResourcesPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-7xl px-4 py-10">
          <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <ResourceCardSkeleton key={i} />
            ))}
          </div>
        </div>
      }
    >
      <ResourcesPageContent />
    </Suspense>
  );
}

function ResourcesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // URL — единственный источник истины состояния discovery (F-004/H-004).
  const q = searchParams.get("q") ?? "";
  const type = (searchParams.get("type") ?? "") as TypeFilter;
  const price = (searchParams.get("price") ?? "") as PriceFilter;
  const sort = (searchParams.get("sort") ?? "") as SortKey;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);

  // Локальное значение инпута: мгновенный отклик, URL обновляется с дебаунсом.
  const [searchInput, setSearchInput] = useState(q);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPushedQuery = useRef<string | null>(null);

  // Синхронизация инпута при навигации назад/вперёд и по ссылкам.
  useEffect(() => {
    setSearchInput(q);
  }, [q]);

  const pushParams = (next: Record<string, string | null>, opts?: { resetPage?: boolean }) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "") {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    }
    if (opts?.resetPage !== false && !("page" in next)) {
      params.delete("page");
    }
    const queryString = params.toString();
    // Не пушим дубликаты подряд (демпфирование дебаунса + строгого режима).
    if (queryString === (lastPushedQuery.current ?? "")) return;
    lastPushedQuery.current = queryString;
    const url = queryString ? `/resources?${queryString}` : "/resources";
    router.push(url, { scroll: false });
  };

  const onSearchChange = (value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      pushParamsReplace({ q: value.trim() || null });
    }, 350);
  };

  // Debounce использует replace (не захламляет history при наборе, N-002),
  // явные клики фильтров — push (история браузера предсказуема).
  const pushParamsReplace = (next: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    if (!("page" in next)) params.delete("page");
    const queryString = params.toString();
    lastPushedQuery.current = queryString;
    router.replace(queryString ? `/resources?${queryString}` : "/resources", { scroll: false });
  };

  const query: ResourceQuery = useMemo(
    () => ({
      q: q || undefined,
      type: type || undefined,
      price: (price || undefined) as ResourceQuery["price"],
      sort: sort || undefined,
      page,
      limit: PAGE_SIZE,
    }),
    [q, type, price, sort, page]
  );

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["resources", query],
    queryFn: () => fetchResources(query),
    placeholderData: keepPreviousData,
  });

  const resources: Resource[] = data?.data ?? [];
  const pagination = data?.pagination;
  const filtersActive = Boolean(q || type || price || sort);

  const resetFilters = () => {
    setSearchInput("");
    lastPushedQuery.current = "";
    router.push("/resources", { scroll: false });
  };

  const changePage = (next: number) => {
    pushParams({ page: next > 1 ? String(next) : null });
  };

  const filtersPanel = (
    <div className="space-y-5">
      {/* Category navigation (G-002/G-003) */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-muted">
          Категория
        </p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Категории">
          {CATEGORIES.map(([value, label]) => (
            <button
              key={value || "all"}
              onClick={() => pushParams({ type: value || null })}
              aria-pressed={type === value}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                type === value
                  ? "border-accent bg-accent text-white"
                  : "border-line text-content-secondary hover:bg-surface-hover hover:text-content"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Price filter (H-001) */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-muted">
          Цена
        </p>
        <div
          className="inline-flex rounded-md border border-line-strong overflow-hidden"
          role="group"
          aria-label="Цена"
        >
          {PRICE_FILTERS.map(([value, label]) => (
            <button
              key={value || "all"}
              onClick={() => pushParams({ price: value || null })}
              aria-pressed={price === value}
              className={`px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${
                price === value
                  ? "bg-accent text-white"
                  : "text-content-secondary hover:bg-surface-hover hover:text-content"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Sort (I-001..I-006) */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-muted">
          Сортировка
        </p>
        <div className="w-56">
          <Select
            value={sort}
            onChange={(e) => pushParams({ sort: e.target.value || null })}
            aria-label="Сортировка"
          >
            {SORT_OPTIONS.map(([value, label]) => (
              <option key={value || "popular"} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {filtersActive ? (
        <Button variant="ghost" size="sm" onClick={resetFilters}>
          Сбросить всё
        </Button>
      ) : null}
    </div>
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      {/* Breadcrumbs (N-001) */}
      <nav aria-label="Хлебные крошки" className="mb-4 text-sm text-content-muted">
        <Link href="/" className="hover:text-accent-strong">
          Главная
        </Link>
        <span className="mx-2">/</span>
        <span className="text-content-secondary">Маркетплейс</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Маркетплейс</h1>
        <p className="mt-1 text-content-secondary">
          {pagination
            ? `${pagination.total} ресурсов · страница ${pagination.page} из ${pagination.pages || 1}`
            : "Ресурсы для MTA:SA, прошедшие модерацию"}
        </p>
      </div>

      {/* Search (F-003/F-004): сохраняется в URL, shareable */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-muted"
            aria-hidden
          />
          <input
            type="search"
            role="searchbox"
            aria-label="Поиск ресурсов"
            placeholder="Найти ресурс..."
            value={searchInput}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-11 w-full rounded-card border border-line bg-surface pl-10 pr-10 text-sm outline-none transition-colors placeholder:text-content-muted focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
          />
          {searchInput ? (
            <button
              type="button"
              onClick={() => {
                setSearchInput("");
                pushParamsReplace({ q: null });
              }}
              aria-label="Очистить поиск"
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-content-muted hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        {/* Mobile: filters behind a drawer toggle (O-001) */}
        <Button
          variant="outline"
          className="lg:hidden"
          size="sm"
          aria-expanded={filtersOpen}
          aria-controls="marketplace-filters-mobile"
          onClick={() => setFiltersOpen((v) => !v)}
        >
          <SlidersHorizontal className="mr-2 h-4 w-4" />
          Фильтры
        </Button>
      </div>

      <div className="lg:grid lg:grid-cols-[240px_1fr] lg:gap-8">
        {/* Desktop sidebar filters */}
        <aside className="hidden lg:block" aria-label="Фильтры">
          <div className="sticky top-24">{filtersPanel}</div>
        </aside>

        {/* Mobile drawer */}
        {filtersOpen ? (
          <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Фильтры">
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => setFiltersOpen(false)}
              aria-hidden
            />
            <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl border-t border-line bg-surface p-5 pb-8">
              <div className="mb-4 flex items-center justify-between">
                <p className="font-semibold">Фильтры</p>
                <button
                  onClick={() => setFiltersOpen(false)}
                  aria-label="Закрыть фильтры"
                  className="rounded p-1 text-content-muted hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              {filtersPanel}
              <Button className="mt-6 w-full" onClick={() => setFiltersOpen(false)}>
                Показать результаты
              </Button>
            </div>
          </div>
        ) : null}

        <div>
          {isLoading ? (
            <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <ResourceCardSkeleton key={i} />
              ))}
            </div>
          ) : error ? (
            <ErrorState error={error} onRetry={() => refetch()} />
          ) : !resources?.length ? (
            filtersActive ? (
              <EmptyFiltered onReset={resetFilters} hasQuery={Boolean(q)} />
            ) : (
              <EmptyMarketplace />
            )
          ) : (
            <div
              className={`grid gap-6 sm:grid-cols-2 xl:grid-cols-3 transition-opacity ${
                isFetching ? "opacity-60" : ""
              }`}
            >
              {resources.map((resource) => (
                <ResourceCard key={resource.id} resource={resource} />
              ))}
            </div>
          )}

          {/* Pagination preserves the full discovery state (I-006/N-003) */}
          {pagination && pagination.pages > 1 && !isLoading && !error ? (
            <nav
              className="flex items-center justify-center gap-4 mt-12"
              aria-label="Постраничная навигация"
            >
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => changePage(page - 1)}>
                Назад
              </Button>
              <span className="text-sm text-content-secondary">
                Страница {pagination.page} из {pagination.pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pagination.pages}
                onClick={() => changePage(page + 1)}
              >
                Вперёд
              </Button>
            </nav>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// F-005: пусто по конкретному запросу — предлагаем сброс.
function EmptyFiltered({ onReset, hasQuery }: { onReset: () => void; hasQuery?: boolean }) {
  return (
    <div className="text-center py-20">
      <SearchX className="h-12 w-12 text-content-muted mx-auto mb-4" />
      <p className="text-lg font-semibold">
        {hasQuery ? "По запросу ничего не найдено" : "Под фильтры ничего не подошло"}
      </p>
      <p className="mt-1 text-sm text-content-secondary">
        {hasQuery
          ? "Попробуйте изменить формулировку или сбросить фильтры."
          : "На этой странице нет ресурсов с выбранными параметрами."}
      </p>
      <Button variant="outline" size="sm" className="mt-5" onClick={onReset}>
        Сбросить фильтры
      </Button>
    </div>
  );
}

// F-005: маркетплейс действительно пуст.
function EmptyMarketplace() {
  return (
    <div className="text-center py-20">
      <Store className="h-12 w-12 text-content-muted mx-auto mb-4" />
      <p className="text-lg font-semibold">Пока нет опубликованных ресурсов</p>
      <p className="mt-1 text-sm text-content-secondary max-w-md mx-auto">
        Ресурсы появляются в каталоге после проверки модератором. Загляните позже или откройте свой
        магазин.
      </p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <Link href="/seller">
          <Button variant="outline" size="sm">
            <Store className="mr-2 h-4 w-4" />
            Стать продавцом
          </Button>
        </Link>
        <Link href="/">
          <Button variant="ghost" size="sm">
            На главную
          </Button>
        </Link>
      </div>
    </div>
  );
}
