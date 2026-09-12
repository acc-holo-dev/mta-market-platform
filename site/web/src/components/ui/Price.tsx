// Price: единый показ цены / бесплатного статуса (PLAN-002 E-006).
// PLAN-017 §57: платная и бесплатная цены занимают одинаковый размер
// (одинаковый text-size/leading — строки карточек не «прыгают»), табличные
// цифры, вариант со скидкой (зачёркнутая оригинальная цена + финальная).
import { formatRub } from "@/lib/api-ext";
import { cn } from "@/lib/utils";

const SIZES = { sm: "text-sm leading-5", md: "text-lg leading-6", lg: "text-2xl leading-8" } as const;

export function Price({
  kopecks,
  size = "md",
  originalKopecks,
  className,
}: {
  kopecks: number;
  size?: "sm" | "md" | "lg";
  /** Оригинальная цена до скидки — рисуется зачёркнутой рядом с финальной. */
  originalKopecks?: number | null;
  className?: string;
}) {
  const hasDiscount = typeof originalKopecks === "number" && originalKopecks > kopecks;
  return (
    <span className={cn("inline-flex min-w-0 items-baseline gap-1.5", className)}>
      {kopecks === 0 ? (
        <span className={cn("whitespace-nowrap font-semibold text-ok tabular-nums", SIZES[size])}>
          Бесплатно
        </span>
      ) : (
        <span className={cn("whitespace-nowrap font-bold text-content tabular-nums", SIZES[size])}>
          {formatRub(kopecks)}
        </span>
      )}
      {hasDiscount ? (
        <span className="whitespace-nowrap text-xs font-medium text-content-muted line-through tabular-nums">
          {formatRub(originalKopecks)}
        </span>
      ) : null}
    </span>
  );
}
