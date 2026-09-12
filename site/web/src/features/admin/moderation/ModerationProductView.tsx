// M-001/M-002: почти та же product presentation, которую увидит buyer —
// cover, screenshots, описание, версии с artifact/validation статусом.
// Перенесено из app/admin/page.tsx (PLAN-017 §36), ключ ["admin-resource-detail", id] сохранён.
"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchAdminResourceDetail, formatRub } from "@/lib/api/admin";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Gallery } from "@/components/ui/Gallery";
import { LoadingSpinner } from "@/components/ui/States";
import { typeLabel } from "@/lib/domain";

export function ModerationProductView({ resourceId }: { resourceId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-resource-detail", resourceId],
    queryFn: () => fetchAdminResourceDetail(resourceId),
  });

  if (isLoading) return <LoadingSpinner label="Загрузка карточки товара..." className="py-6" />;
  if (error || !data)
    return (
      <p className="text-sm text-bad" role="alert">
        Не удалось загрузить карточку товара.
      </p>
    );

  const gallery = [
    ...(data.cover ? [{ id: "cover", url: data.cover, alt: "Обложка ресурса" }] : []),
    ...data.screenshots.map((s) => ({ id: s.id, url: s.url, alt: "Скриншот ресурса" })),
  ];

  return (
    <div className="rounded-card border border-line bg-surface p-4 space-y-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-content-muted">
        Товар так, как его увидит покупатель
      </p>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          {gallery.length > 0 ? (
            <Gallery images={gallery} aspect="aspect-video" />
          ) : (
            <div className="rounded-card border border-dashed border-line p-6 text-center text-sm text-content-muted">
              Медиа не загружено — покупатель увидит текстовую заглушку.
            </div>
          )}
        </div>
        <div className="space-y-2 text-sm">
          <p className="text-lg font-semibold">{data.resource.title}</p>
          <p className="text-content-secondary">
            {typeLabel(data.resource.type)} · {data.resource.price === 0 ? "Бесплатно" : formatRub(data.resource.price)}
          </p>
          {data.resource.seller ? (
            <p className="text-content-secondary">
              Продавец: {data.resource.seller.displayName || data.resource.seller.username}
            </p>
          ) : null}
          <p className="text-content-secondary whitespace-pre-line line-clamp-6">
            {data.resource.description}
          </p>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-content-muted mb-2">
          Версии и артефакты
        </p>
        {data.versions.length === 0 ? (
          <p className="text-sm text-content-muted">Версии не загружены.</p>
        ) : (
          <ul className="space-y-2">
            {data.versions.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm rounded-md border border-line p-2.5">
                <span className="font-semibold">v{v.version}</span>
                <StatusBadge status={v.releaseStatus === "PUBLISHED" ? "COMPLETED" : v.releaseStatus === "CANDIDATE" ? "DRAFT" : v.releaseStatus} />
                <span className="text-xs text-content-secondary">
                  {(v.fileSize / 1024).toFixed(1)} КБ
                </span>
                <span className="text-xs text-content-secondary">
                  {v.signed ? "подписан" : "без подписи"} · проверка: {v.validationStatus}
                </span>
                {v.changelog ? (
                  <span className="basis-full text-xs text-content-muted">{v.changelog}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}