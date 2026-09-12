// Route-level loading skeleton (PLAN-017 §65): навигация в тяжёлые
// поверхности показывает каркас вместо пустого экрана.
import { Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 px-4 py-6" aria-busy="true" aria-label="Загрузка">
      <Skeleton className="h-8 w-64" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-48" />
        ))}
      </div>
    </div>
  );
}
