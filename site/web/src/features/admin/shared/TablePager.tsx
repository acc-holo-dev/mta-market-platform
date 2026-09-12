// PLAN-017 §36: compact pager for admin tables (users / audit / logs).
"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function TablePager({
  page,
  limit,
  total,
  onPage,
  disabled = false,
}: {
  page: number;
  limit: number;
  total: number;
  onPage: (page: number) => void;
  disabled?: boolean;
}) {
  const pages = Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, limit)));

  return (
    <div className="flex items-center justify-between gap-3 pt-3">
      <p className="text-xs text-content-muted tabular-nums">Всего: {total}</p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Предыдущая страница"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          Назад
        </Button>
        <span className="text-xs text-content-secondary tabular-nums">
          Стр. {page} из {pages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || page >= pages}
          onClick={() => onPage(page + 1)}
          aria-label="Следующая страница"
        >
          Вперёд
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}