// PLAN-016 D-009: минимальный route-level loading (skeleton-shell на токенах;
// не имитирует содержимое).
export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-[1400px] animate-pulse px-4 py-8 sm:px-6">
      <div className="h-4 w-40 rounded bg-surface-hover" />
      <div className="mt-4 h-8 w-64 rounded-md bg-surface-hover" />
      <div className="mt-3 h-4 w-56 rounded-md bg-surface-hover" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-48 animate-pulse rounded-card border border-line bg-surface" />
        ))}
      </div>
    </div>
  );
}