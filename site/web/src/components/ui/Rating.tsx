// Rating: звёзды рейтинга (read-only) (PLAN-002 E-006/F-005).
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

export function Rating({
  value,
  count,
  size = "sm",
  className,
}: {
  value: number | null | undefined;
  count?: number | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const px = { sm: "h-3.5 w-3.5", md: "h-4 w-4", lg: "h-5 w-5" }[size];
  const rounded = value != null ? Math.round(value) : 0;

  if (value == null) {
    return (
      <span className={cn("inline-flex items-center gap-1 text-xs text-content-muted", className)}>
        <Star className={cn(px, "text-content-muted")} />
        <span>Нет оценок</span>
      </span>
    );
  }

  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-xs text-content-secondary", className)}
      title={`Рейтинг ${value.toFixed(1)}${count != null ? ` · ${count} отзывов` : ""}`}
    >
      <span className="flex">
        {[1, 2, 3, 4, 5].map((n) => (
          <Star
            key={n}
            className={cn(px, n <= rounded ? "text-amber-400 fill-amber-400" : "text-line-strong")}
          />
        ))}
      </span>
      <span className="font-medium text-content">{value.toFixed(1)}</span>
      {count != null ? <span className="text-content-muted">({count})</span> : null}
    </span>
  );
}
