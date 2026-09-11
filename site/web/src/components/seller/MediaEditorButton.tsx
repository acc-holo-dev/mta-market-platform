// MediaEditorButton (PLAN-003 B-006): раскрытый редактор оформления
// в кабинете продавца. Медиа можно менять, пока статус это позволяет
// (DRAFT / PENDING_REVIEW) — сервер отклоняет изменения для опубликованных.
"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchResourceMedia } from "@/lib/api-ext";
import { Button } from "@/components/ui/Button";
import { MediaManager } from "@/components/seller/MediaManager";
import { ImagePlus } from "lucide-react";

export function MediaEditorButton({ resource }: { resource: { slug: string; title: string; status: string } }) {
  const [open, setOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["resource-media", resource.slug],
    queryFn: () => fetchResourceMedia(resource.slug),
    enabled: open,
  });

  return (
    <div className="w-full">
      <Button variant="outline" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <ImagePlus className="mr-1.5 h-3.5 w-3.5" />
        {open ? "Скрыть оформление" : "Оформление"}
      </Button>

      {open ? (
        <div className="mt-4 w-full rounded-card border border-line bg-surface p-4">
          {isLoading ? (
            <p className="text-sm text-content-muted" aria-live="polite">
              Загрузка оформления...
            </p>
          ) : error || !data ? (
            <p className="text-sm text-bad" role="alert">
              Не удалось загрузить медиа ресурса.
            </p>
          ) : !data.editable ? (
            <p className="text-sm text-content-secondary">
              Оформление опубликованного ресурса изменить нельзя — сначала верните ресурс в
              черновик.
            </p>
          ) : (
            <>
              <p className="text-xs text-content-muted mb-3">
                Ресурс «{resource.title}» · изменения сохраняются сразу
              </p>
              <MediaManager
                slug={resource.slug}
                initialCover={data.coverUrl}
                initialScreenshots={data.screenshots}
              />
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
