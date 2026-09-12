// PLAN-015 §8: ecosystem-wide search в topbar.
// Реальный домен: существующий GET /search (resources/servers/threads/articles).
// Групповые preview-результаты, keyboard navigation (↑↓/Enter/Esc), состояния
// loading/empty/error, хоткей «/». Никакого фейкового локального поиска.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { Search, Loader2, SearchX, Package, Server, MessagesSquare, FileText, ArrowRight } from "lucide-react";
import { search } from "@/lib/api-ext";
import { cn } from "@/lib/utils";

const MIN_QUERY = 2;
const DEBOUNCE_MS = 300;

interface SearchHit {
  id: string;
  href: string;
  title: string;
  meta?: string;
}

function flatten(snapshot: Awaited<ReturnType<typeof search>> | undefined): {
  groups: { key: string; label: string; icon: React.ComponentType<{ className?: string }>; hits: SearchHit[] }[];
  total: number;
} {
  const groups: { key: string; label: string; icon: React.ComponentType<{ className?: string }>; hits: SearchHit[] }[] = [];
  if (!snapshot) return { groups, total: 0 };

  const resourceHits: SearchHit[] = (snapshot.resources?.data ?? [])
    .slice(0, 4)
    .map((r) => ({
      id: `r-${r.id}`,
      href: `/resources/${r.slug}`,
      title: r.title ?? "",
      meta: r.price === 0 ? "Бесплатно" : undefined,
    }));
  const serverHits: SearchHit[] = (snapshot.servers?.data ?? []).slice(0, 4).map((s) => ({
    id: `s-${s.id}`,
    href: `/servers/${s.slug}`,
    title: s.name,
  }));
  const threadHits: SearchHit[] = (snapshot.threads?.data ?? []).slice(0, 4).map((t) => ({
    id: `t-${t.id}`,
    href: `/community/forum/thread/${t.id}`,
    title: t.title,
    meta: `${t.replyCount} ответов`,
  }));
  const articleHits: SearchHit[] = (snapshot.articles?.data ?? []).slice(0, 4).map((a) => ({
    id: `a-${a.id}`,
    href: `/content/articles/${a.slug}`,
    title: a.title,
  }));

  if (resourceHits.length)
    groups.push({ key: "resources", label: "Ресурсы", icon: Package, hits: resourceHits });
  if (serverHits.length)
    groups.push({ key: "servers", label: "Серверы", icon: Server, hits: serverHits });
  if (threadHits.length)
    groups.push({ key: "threads", label: "Обсуждения", icon: MessagesSquare, hits: threadHits });
  if (articleHits.length)
    groups.push({ key: "articles", label: "Статьи", icon: FileText, hits: articleHits });

  return {
    groups,
    total: (snapshot.resources?.count ?? 0) + (snapshot.servers?.count ?? 0) + (snapshot.threads?.count ?? 0) + (snapshot.articles?.count ?? 0),
  };
}

export function GlobalSearch() {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);

  const enabled = open && debounced.length >= MIN_QUERY;

  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: ["search", "dropdown", debounced],
    queryFn: () => search(debounced),
    enabled,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const { groups, total } = useMemo(() => flatten(data), [data]);

  // Плоский список доступных переходов для клавиатуры.
  const flatHits = useMemo(() => groups.flatMap((g) => g.hits), [groups]);

  useEffect(() => {
    setActiveIndex(-1);
  }, [debounced]);

  // Хоткей «/»: фокус в поиск, если пользователь не в другом поле ввода.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typingElsewhere =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable;
      if (event.key === "/" && !typingElsewhere) {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Закрытие по click-outside.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const go = (href: string) => {
    setOpen(false);
    setValue("");
    router.push(href);
  };

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (!flatHits.length) {
      if (event.key === "Enter" && debounced.length >= MIN_QUERY) {
        go(`/search?q=${encodeURIComponent(debounced)}`);
      }
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((prev) => (prev + 1) % (flatHits.length + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((prev) => (prev <= 0 ? flatHits.length : prev - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeIndex >= 0 && activeIndex < flatHits.length) {
        go(flatHits[activeIndex].href);
      } else {
        go(`/search?q=${encodeURIComponent(debounced)}`);
      }
    }
  };

  // aria-activedescendant target
  let hitCounter = -1;

  return (
    <div ref={containerRef} className="relative w-full max-w-xl">
      <div
        className={cn(
          "flex h-9 items-center gap-2 rounded-pill border bg-surface-inset px-3.5 transition-colors duration-fast",
          open ? "border-line-accent" : "border-line hover:border-line-strong"
        )}
      >
        <Search className="h-4 w-4 flex-shrink-0 text-content-muted" aria-hidden />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={open && enabled}
          aria-controls="global-search-results"
          aria-activedescendant={activeIndex >= 0 ? `global-search-hit-${activeIndex}` : undefined}
          aria-label="Глобальный поиск по платформе"
          aria-autocomplete="list"
          placeholder="Поиск: ресурсы, серверы, обсуждения…"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onInputKeyDown}
          className="h-full w-full bg-transparent text-sm text-content outline-none placeholder:text-content-muted"
        />
        <kbd
          aria-hidden
          className="hidden rounded border border-line bg-surface px-1.5 py-0.5 text-[10px] text-content-muted md:block"
        >
          /
        </kbd>
      </div>

      {open && value.trim().length >= MIN_QUERY ? (
        <div
          id="global-search-results"
          role="listbox"
          aria-label="Результаты поиска"
          className="mta-anim-fade absolute left-0 right-0 top-full z-50 mt-2 max-h-[26rem] overflow-y-auto rounded-card border border-line bg-surface-raised p-2 shadow-raised"
        >
          {isFetching && !data ? (
            <p className="flex items-center gap-2 px-3 py-4 text-sm text-content-secondary" role="status">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Поиск…
            </p>
          ) : isError ? (
            <div className="px-3 py-4 text-sm" role="alert">
              <p className="text-bad">Не удалось выполнить поиск</p>
              <button
                type="button"
                onClick={() => refetch()}
                className="mt-1 text-accent-strong hover:underline"
              >
                Повторить
              </button>
            </div>
          ) : groups.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <SearchX className="mx-auto mb-2 h-6 w-6 text-content-muted" aria-hidden />
              <p className="text-sm font-medium text-content">По «{debounced}» ничего не найдено</p>
              <p className="mt-1 text-xs text-content-muted">
                Попробуйте изменить формулировку или нажмите Enter для полного поиска
              </p>
            </div>
          ) : (
            <>
              {groups.map((group) => {
                const GroupIcon = group.icon;
                return (
                  <div key={group.key} className="mb-1 last:mb-0">
                    <p className="flex items-center gap-1.5 px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-content-muted">
                      <GroupIcon className="h-3 w-3" aria-hidden />
                      {group.label}
                    </p>
                    <ul>
                      {group.hits.map((hit) => {
                        hitCounter += 1;
                        const idx = hitCounter;
                        return (
                          <li key={hit.id} role="option" aria-selected={activeIndex === idx} id={`global-search-hit-${idx}`}>
                            <Link
                              href={hit.href}
                              onClick={() => setOpen(false)}
                              onMouseMove={() => setActiveIndex(idx)}
                              className={cn(
                                "flex items-center justify-between gap-3 rounded-md px-2.5 py-2 text-sm transition-colors duration-fast",
                                activeIndex === idx
                                  ? "bg-surface-hover text-content"
                                  : "text-content-secondary hover:bg-surface-hover hover:text-content"
                              )}
                            >
                              <span className="min-w-0 truncate">{hit.title}</span>
                              {hit.meta ? (
                                <span className="flex-shrink-0 text-xs text-content-muted">{hit.meta}</span>
                              ) : null}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
              <Link
                href={`/search?q=${encodeURIComponent(debounced)}`}
                onClick={() => setOpen(false)}
                className={cn(
                  "mt-1 flex items-center justify-between rounded-md px-2.5 py-2 text-sm font-medium text-accent-strong transition-colors duration-fast",
                  activeIndex === flatHits.length ? "bg-surface-hover" : "hover:bg-surface-hover"
                )}
                onMouseMove={() => setActiveIndex(flatHits.length)}
                id="global-search-hit-all"
                role="option"
                aria-selected={activeIndex === flatHits.length}
              >
                <span>
                  Все результаты{total > 0 ? ` (${total})` : ""}
                </span>
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
