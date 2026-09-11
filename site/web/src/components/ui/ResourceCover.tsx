// ResourceCover (PLAN-003 C-004/K-001): обложка товара или аккуратный
// типографический fallback. Единый компонент для Card / Detail / Moderation —
// один seller/товар выглядит одинаково по всему сайту.
"use client";

import { mediaUrl } from "@/lib/api-ext";
import { cn } from "@/lib/utils";

const TYPE_ABBR: Record<string, string> = {
  SCRIPT: "SC",
  MAP: "MP",
  MODEL: "MD",
  TEXTURE: "TX",
  SOUND: "SN",
  GAMEMODE: "GM",
};

export function ResourceCover({
  coverUrl,
  type,
  title,
  className,
  imageClassName,
}: {
  coverUrl?: string | null;
  type: string;
  title?: string;
  className?: string;
  imageClassName?: string;
}) {
  const resolved = mediaUrl(coverUrl);

  if (resolved) {
    return (
      <div className={cn("relative overflow-hidden bg-surface-raised", className)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={resolved}
          alt={title ? `Обложка: ${title}` : "Обложка ресурса"}
          loading="lazy"
          className={cn("h-full w-full object-cover", imageClassName)}
        />
      </div>
    );
  }

  // Типографический fallback — честная заглушка без фейковых изображений.
  const abbr = TYPE_ABBR[type] ?? type.slice(0, 2).toUpperCase();
  return (
    <div
      aria-hidden
      className={cn(
        "flex items-center justify-center border-b border-line bg-gradient-to-br from-accent-soft via-surface-raised to-surface",
        className
      )}
    >
      <span className="text-3xl font-black tracking-widest text-accent/70 select-none">
        {abbr}
      </span>
    </div>
  );
}
