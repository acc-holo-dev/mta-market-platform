// Публичный каталог серверов MTA:SA (PLAN-005 W): URL — источник истины
// (?q=, ?sort=, ?page=), поиск с дебаунсом, сортировка и пагинация.
// Гостям страница полностью доступна.
"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Search, SearchX, Server, X } from "lucide-react";
import { fetchServers, type ServerCard as ServerCardData } from "@/lib/api-ext";
import { ServerCard } from "@/components/servers/ServerCard";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState, EmptyState } from "@/components/ui/States";

const PAGE_SIZE = 12;

type SortKey = "players" | "newest";

const SORT_OPTIONS: [SortKey, string][] = [
  ["players", "По онлайну"],
  ["newest", "Новые"],
];

export default function ServersPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-6xl px-4 py-10">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <ServerCardSkeleton key={i} />
            ))}
          </div>
        </div>
      }
    >
      <ServersPageContent />
    </Suspense>
  );
}

function ServerCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface">
      <Skeleton className="h-24 rounded-none" />
      <div className="space-y-3 p-4">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

function ServersPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // URL — источник истины (как на /resources): q, sort, page.
  const q = searchParams.get("q") ?? "";
  const sort = (searchParams.get("sort") ?? "players") as SortKey;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);

  const [searchInput, setSearchInput] = useState(q);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPushedQuery = useRef<string | null>(null);

  // Синхронизация инпута при навигации назад/вперёд.
  useEffect(() => {
    setSearchInput(q);
  }, [q]);

  const pushParams = (next: Record<string, string | null>, mode: "push" | "replace" = "push") => {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "") params.delete(key);
      else params.set(key, value);
    }
    if (!("page" in next)) params.delete("page");
    const queryString = params.toString();
    if (queryString === (lastPushedQuery.current ?? "")) return;
    lastPushedQuery.current = queryString;
    const url = queryString ? `/servers?${queryString}` : "/servers";
    router[mode](url, { scroll: false });
  };

  const onSearchChange = (value: string) => {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      pushParams({ q: value.trim() || null }, "replace");
    }, 350);
  };

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["servers", "list", { q, sort, page }],
    queryFn: () => fetchServers({ q: q || undefined, sort, page, limit: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const servers: ServerCardData[] = data?.data ?? [];
  const pagination = data?.pagination;

  const changePage = (next: number) => {
    pushParams({ page: next > 1 ? String(next) : null });
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <nav aria-label="Хлебные крошки" className="mb-4 text-sm text-content-muted">
        <Link href="/" className="hover:text-accent-strong">
          Главная
        </Link>
        <span className="mx-2">/</span>
        <span className="text-content-secondary">Серверы</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Серверы MTA:SA</h1>
        <p className="mt-1 text-content-secondary">
          {pagination
            ? `${pagination.total} серверов · страница ${pagination.page} из ${pagination.pages || 1}`
            : "Живые серверы сообщества: онлайн, новости и отзывы игроков"}
        </p>
      </div>

      {/* Поиск (debounced ?q=) + сортировка */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-muted"
            aria-hidden
          />
          <input
            type="search"
            role="searchbox"
            aria-label="Поиск серверов"
            placeholder="Найти сервер по названию или описанию..."
            value={searchInput}
            onChange={(e) => onSearchChange(e.target.value)}
            className="h-11 w-full rounded-card border border-line bg-surface pl-10 pr-10 text-sm outline-none transition-colors placeholder:text-content-muted focus:border-accent focus-visible:ring-2 focus-visible:ring-accent"
          />
          {searchInput ? (
            <button
              type="button"
              onClick={() => {
                setSearchInput("");
                pushParams({ q: null }, "replace");
              }}
              aria-label="Очистить поиск"
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded p-0.5 text-content-muted hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <div className="w-full sm:w-56">
          <Select
            aria-label="Сортировка серверов"
            value={sort}
            onChange={(e) => pushParams({ sort: e.target.value })}
          >
            {SORT_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <ServerCardSkeleton key={i} />
          ))}
        </div>
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : servers.length === 0 ? (
        <EmptyState
          icon={<SearchX className="h-12 w-12 text-content-muted mx-auto mb-4" />}
          title="Серверы не найдены"
          description={
            q
              ? "По вашему запросу ничего не найдено. Попробуйте изменить формулировку."
              : "Зарегистрированные серверы появятся здесь после настройки интеграции."
          }
          action={
            q ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearchInput("");
                  pushParams({ q: null }, "replace");
                }}
              >
                Сбросить поиск
              </Button>
            ) : (
              <Link href="/servers/create">
                <Button variant="outline" size="sm">
                  <Server className="mr-2 h-4 w-4" />
                  Зарегистрировать сервер
                </Button>
              </Link>
            )
          }
        />
      ) : (
        <div
          className={`grid gap-6 sm:grid-cols-2 lg:grid-cols-3 transition-opacity ${
            isFetching ? "opacity-60" : ""
          }`}
        >
          {servers.map((server) => (
            <ServerCard key={server.id} server={server} />
          ))}
        </div>
      )}

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
  );
}
