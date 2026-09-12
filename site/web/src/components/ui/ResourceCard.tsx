// ResourceCard (PLAN-002 E-006 → PLAN-003 C-001..C-005 → PLAN-015 §17):
// товарная карточка с иерархией: Title → Creator → Trust → Rating → Price.
// Trust-строка показывает только РЕАЛЬНЫЕ сигналы (§19): статус публикации,
// верификация автора — без выдуманных badges. Cover через общий ResourceCover.
// Карточка полностью кликабельна (C-005): один Link, keyboard focus,
// hover — без nested interactive элементов.
import Link from "next/link";
import type { Resource } from "@/lib/api-ext";
import { Price } from "@/components/ui/Price";
import { Rating } from "@/components/ui/Rating";
import { ResourceCover } from "@/components/ui/ResourceCover";
import { TrustBadges } from "@/components/trust/TrustBadges";
import { typeLabel } from "@/lib/domain";

export function ResourceCard({ resource }: { resource: Resource }) {
  const sellerName = resource.seller?.displayName || resource.seller?.username || null;
  const sellerUsername = resource.seller?.username || null;
  // PUBLISHED в каталоге — уже знак модерации; подсвечиваем trust-меткой.
  const moderated = resource.status === "PUBLISHED";
  const free = resource.price === 0;

  return (
    <Link
      href={`/resources/${resource.slug}`}
      className="group flex h-full flex-col rounded-card border border-line bg-surface overflow-hidden transition-all duration-fast hover:border-line-strong hover:bg-surface-raised hover:shadow-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      aria-label={`${resource.title} — ${typeLabel(resource.type)}`}
    >
      <ResourceCover
        coverUrl={resource.coverUrl}
        type={resource.type}
        title={resource.title}
        className="aspect-video border-b border-line"
      />

      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold leading-snug text-content group-hover:text-accent-strong transition-colors duration-fast">
            {resource.title}
          </h3>
          <span className="flex-shrink-0 rounded-pill bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-strong">
            {typeLabel(resource.type)}
          </span>
        </div>

        {/* Creator — вторая строка иерархии (§17) */}
        {sellerName ? (
          <p className="text-xs text-content-muted truncate">
            <span className="text-content-secondary">{sellerName}</span>
          </p>
        ) : null}

        {/* Trust row (§19): только реальные сигналы, компактно */}
        <TrustBadges signals={[moderated ? "MODERATED" : null, free ? "COMMUNITY" : null]} />

        <p className="text-sm text-content-secondary line-clamp-2">{resource.description}</p>

        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <Price kopecks={resource.price} size="md" />
          <Rating value={resource.rating ?? null} count={resource.reviewCount ?? null} />
        </div>
      </div>
    </Link>
  );
}
