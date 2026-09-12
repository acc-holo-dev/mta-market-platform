// PLAN-017 §36: searchable entity picker for admin sections.
// Заменяет raw-UUID paste-инпуты: debounced GET /admin/search-entities +
// dropdown (role=listbox), клавиатура ↑/↓/Enter/Escape, очистка, и ручной
// ввод UUID за переключателем «ввести вручную» (для advanced-сценариев).
// Полный вставленный UUID в режиме поиска сразу предлагается к использованию.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import {
  searchAdminEntities,
  type AdminSearchEntityType,
  type AdminSearchItem,
} from "@/lib/api/admin";
import { UUID_V4_REGEX } from "@/components/admin/labels";
import { useDebouncedValue } from "@/features/admin/shared/useDebouncedValue";
import { cn } from "@/lib/utils";

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_MIN_LENGTH = 2;
const SEARCH_LIMIT = 10;

export function EntityPicker({
  entityType,
  value,
  onChange,
  placeholder = "Поиск по названию...",
  ariaLabel,
  disabled = false,
  allowManual = true,
  manualPlaceholder = "Вставьте UUID вручную",
  className,
}: {
  entityType: AdminSearchEntityType;
  value: string;
  onChange: (id: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  /** Спрятать переключатель ручного ввода (по умолчанию доступен). */
  allowManual?: boolean;
  manualPlaceholder?: string;
  className?: string;
}) {
  const [mode, setMode] = useState<"search" | "manual">("search");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const debouncedQuery = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  const manualInvalid = mode === "manual" && value.trim().length > 0 && !UUID_V4_REGEX.test(value.trim());

  const { data, isFetching } = useQuery({
    queryKey: ["admin", "search-entities", entityType, debouncedQuery],
    queryFn: () => searchAdminEntities(entityType, debouncedQuery, SEARCH_LIMIT),
    enabled: mode === "search" && debouncedQuery.length >= SEARCH_MIN_LENGTH,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });

  const directUuid: AdminSearchItem | null = useMemo(() => {
    const trimmed = query.trim();
    return UUID_V4_REGEX.test(trimmed)
      ? { id: trimmed, label: trimmed, sublabel: "Использовать введённый ID" }
      : null;
  }, [query]);

  const options: AdminSearchItem[] = useMemo(() => {
    const found = data?.items ?? [];
    if (!directUuid) return found;
    return [directUuid, ...found.filter((item) => item.id !== directUuid.id)];
  }, [directUuid, data]);

  // Сброс подсветки при смене списка.
  useEffect(() => {
    setHighlight(0);
  }, [options.length, debouncedQuery, entityType]);

  // Закрытие по клику вне пикера.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function select(item: AdminSearchItem) {
    onChange(item.id);
    setQuery(item.label);
    setOpen(false);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (mode !== "search") return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) setOpen(true);
      setHighlight((h) => Math.min(h + 1, Math.max(options.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (event.key === "Enter") {
      if (open && options[highlight]) {
        event.preventDefault();
        select(options[highlight]);
      }
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
    }
  }

  const searching = mode === "search" && open && debouncedQuery.length >= SEARCH_MIN_LENGTH;

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      {mode === "search" ? (
        <div className="relative">
          <Input
            value={query}
            disabled={disabled}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => {
              if (options.length > 0 || debouncedQuery.length >= SEARCH_MIN_LENGTH) setOpen(true);
            }}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            aria-label={ariaLabel ?? "Поиск сущности"}
            aria-expanded={open}
            aria-haspopup="listbox"
            autoComplete="off"
            role="combobox"
          />
          <Search
            className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-muted"
            aria-hidden
          />
        </div>
      ) : (
        <Input
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder={manualPlaceholder}
          aria-label={ariaLabel ? `${ariaLabel} (ввод вручную)` : "Ввод ID вручную"}
          aria-invalid={manualInvalid}
          className="font-mono text-xs"
        />
      )}

      <div className="mt-1 flex items-center justify-between gap-2">
        {value ? (
          <p className="min-w-0 truncate text-xs text-content-muted">
            Выбрано: <span className="font-mono">{value}</span>
          </p>
        ) : mode === "search" ? (
          <p className="text-xs text-content-muted">Начните вводить название{directUuid ? " или вставьте UUID" : ""}</p>
        ) : (
          <p className="text-xs text-content-muted">Ручной ввод ID</p>
        )}
        <div className="flex flex-shrink-0 items-center gap-1">
          {value ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => {
                onChange("");
                setQuery("");
              }}
              aria-label="Очистить выбор"
              className="px-2"
            >
              <X className="h-4 w-4" aria-hidden />
            </Button>
          ) : null}
          {allowManual ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => {
                setMode(mode === "search" ? "manual" : "search");
                setOpen(false);
              }}
              className="px-2"
            >
              {mode === "search" ? "ввести вручную" : "искать по названию"}
            </Button>
          ) : null}
        </div>
      </div>

      {mode === "manual" && manualInvalid ? (
        <p className="text-xs text-bad">ID должен быть UUID.</p>
      ) : null}

      {mode === "search" && open ? (
        <div
          role="listbox"
          aria-label={ariaLabel ? "Результаты поиска" : undefined}
          className="absolute z-40 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-line bg-surface-raised shadow-raised"
        >
          {searching && options.length === 0 ? (
            <p className="px-3 py-2 text-xs text-content-muted">
              {isFetching ? "Поиск..." : "Ничего не найдено"}
            </p>
          ) : null}
          {!searching && options.length === 0 ? (
            <p className="px-3 py-2 text-xs text-content-muted">Введите минимум 2 символа</p>
          ) : null}
          {options.map((option, index) => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={index === highlight}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => select(option)}
              onMouseEnter={() => setHighlight(index)}
              className={cn(
                "block w-full px-3 py-2 text-left text-sm transition-colors duration-fast",
                index === highlight ? "bg-surface-hover text-content" : "text-content-secondary"
              )}
            >
              <span className="block truncate">{option.label}</span>
              {option.sublabel ? (
                <span className="block truncate text-xs text-content-muted">{option.sublabel}</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}