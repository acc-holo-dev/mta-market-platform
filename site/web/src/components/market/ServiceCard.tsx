// PLAN-015 §25: карточка услуги — собственный вид (не ресурс):
// цена + срок доставки + рейтинг автора. Только реальные поля контракта
// GET /services (title/description/type/price/deliveryDays).
import Link from "next/link";
import type { Service } from "@/lib/api-ext";
import { Price } from "@/components/ui/Price";
import { Clock, FileText } from "lucide-react";
import { typeLabel } from "@/lib/domain";

export function ServiceCard({ service }: { service: Service }) {
  return (
    <Link
      href={`/services/${service.slug}`}
      className="group flex h-full flex-col rounded-card border border-line bg-surface p-4 transition-all duration-fast hover:border-line-strong hover:bg-surface-raised hover:shadow-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      aria-label={`${service.title} — услуга, ${typeLabel(service.type)}`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-pill bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-strong">
          <FileText className="h-3 w-3" aria-hidden />
          {typeLabel(service.type)}
        </span>
        <Price kopecks={service.price} size="md" />
      </div>

      <h3 className="font-semibold leading-snug text-content group-hover:text-accent-strong transition-colors duration-fast">
        {service.title}
      </h3>

      <p className="mt-1.5 text-sm text-content-secondary line-clamp-2">{service.description}</p>

      <div className="mt-auto flex items-center gap-1.5 pt-3 text-xs text-content-secondary">
        <Clock className="h-3.5 w-3.5" aria-hidden />
        Срок: {service.deliveryDays}{" "}
        {service.deliveryDays === 1 ? "день" : service.deliveryDays < 5 ? "дня" : "дней"}
      </div>
    </Link>
  );
}
