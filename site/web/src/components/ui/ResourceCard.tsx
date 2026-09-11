// ResourceCard (PLAN-002 E-006 → PLAN-003 C-001..C-005): полноценная товарная
// карточка. Cover через общий ResourceCover (типографический fallback — C-004),
// seller identity, тип, цена, рейтинг. Карточка полностью кликабельна (C-005):
// один Link, keyboard focus, hover — без nested interactive элементов.
import Link from "next/link";
import type { Resource } from "@/lib/api-ext";
import { Price } from "@/components/ui/Price";
import { Rating } from "@/components/ui/Rating";
import { ResourceCover } from "@/components/ui/ResourceCover";
import { typeLabel } from "@/lib/domain";

export function ResourceCard({ resource }: { resource: Resource }) {
  const sellerName = resource.seller?.displayName || resource.seller?.username || null;

  return (
    <Link
      href={`/resources/${resource.slug}`}
      className="group block rounded-card border border-line bg-surface overflow-hidden transition-colors hover:border-line-strong hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      aria-label={`${resource.title} — ${typeLabel(resource.type)}`}
    >
      <ResourceCover
        coverUrl={resource.coverUrl}
        type={resource.type}
        title={resource.title}
        className="aspect-video border-b border-line"
      />

      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold leading-snug group-hover:text-accent-strong transition-colors">
            {resource.title}
          </h3>
          <span className="flex-shrink-0 rounded bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-strong">
            {typeLabel(resource.type)}
          </span>
        </div>

        <p className="text-sm text-content-secondary line-clamp-2">{resource.description}</p>

        <div className="flex items-center justify-between gap-2 pt-1">
          <Price kopecks={resource.price} size="md" />
          <Rating value={resource.rating ?? null} count={resource.reviewCount ?? null} />
        </div>

        {sellerName ? (
          <p className="text-xs text-content-muted truncate">
            Продавец: <span className="text-content-secondary">{sellerName}</span>
          </p>
        ) : null}
      </div>
    </Link>
  );
}
