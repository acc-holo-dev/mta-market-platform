// Gallery (PLAN-003 D-002): обложка + скриншоты с простым lightbox.
// Никакого тяжёлого image-viewer framework — модальное окно на fixed-оверлее
// с keyboard support (Esc, ←/→) и честными alt-текстами.
"use client";

import { useCallback, useEffect, useState } from "react";
import { mediaUrl } from "@/lib/api-ext";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface GalleryImage {
  id: string;
  url: string;
  alt: string;
}

export function Gallery({
  images,
  className,
  aspect = "aspect-video",
}: {
  images: GalleryImage[];
  className?: string;
  aspect?: string;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const close = useCallback(() => setOpenIndex(null), []);
  const step = useCallback(
    (delta: number) => {
      setOpenIndex((i) => {
        if (i === null) return null;
        const next = (i + delta + images.length) % images.length;
        return next;
      });
    },
    [images.length]
  );

  // Keyboard: Esc закрывает, стрелки листают (P-001).
  useEffect(() => {
    if (openIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [openIndex, close, step]);

  if (images.length === 0) return null;

  const active = openIndex !== null ? images[openIndex] : null;

  return (
    <div className={className}>
      {/* Main image + thumbnails strip */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setOpenIndex(0)}
          className="block w-full overflow-hidden rounded-card border border-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          aria-label={images[0].alt}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={mediaUrl(images[0].url) ?? ""}
            alt={images[0].alt}
            className={cn("w-full cursor-zoom-in object-cover", aspect)}
          />
        </button>
        {images.length > 1 ? (
          <div className="grid grid-cols-4 sm:grid-cols-5 gap-2" role="list" aria-label="Скриншоты">
            {images.map((img, i) => (
              <button
                key={img.id}
                type="button"
                role="listitem"
                onClick={() => setOpenIndex(i)}
                aria-label={`Открыть: ${img.alt}`}
                className="overflow-hidden rounded-md border border-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={mediaUrl(img.url) ?? ""}
                  alt={img.alt}
                  loading="lazy"
                  className="aspect-video w-full cursor-zoom-in object-cover transition-opacity hover:opacity-80"
                />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Lightbox */}
      {active ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Просмотр изображения"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={close}
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            onClick={close}
            aria-label="Закрыть просмотр"
          >
            <X className="h-5 w-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={mediaUrl(active.url) ?? ""}
            alt={active.alt}
            className="max-h-[85vh] max-w-full rounded-card object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          {images.length > 1 ? (
            <>
              <button
                type="button"
                className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                onClick={(e) => {
                  e.stopPropagation();
                  step(-1);
                }}
                aria-label="Предыдущее изображение"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                type="button"
                className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-3 text-white hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                onClick={(e) => {
                  e.stopPropagation();
                  step(1);
                }}
                aria-label="Следующее изображение"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
              <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-sm text-white/80">
                {openIndex! + 1} / {images.length}
              </p>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
