// Price: единый показ цены / бесплатного статуса (PLAN-002 E-006).
import { formatRub } from "@/lib/api-ext";
import { cn } from "@/lib/utils";

export function Price({
  kopecks,
  size = "md",
  className,
}: {
  kopecks: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  if (kopecks === 0) {
    return (
      <span
        className={cn(
          "font-semibold text-ok",
          { sm: "text-sm", md: "text-base", lg: "text-2xl" }[size],
          className
        )}
      >
        Бесплатно
      </span>
    );
  }
  return (
    <span
      className={cn(
        "font-bold text-content",
        { sm: "text-sm", md: "text-lg", lg: "text-3xl" }[size],
        className
      )}
    >
      {formatRub(kopecks)}
    </span>
  );
}
