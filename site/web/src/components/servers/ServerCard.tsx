// PLAN-005 V/D: shared server-domain visual primitives (PLAN-013 restyle).
// Identity-карточка сервера: banner + перекрывающийся logo + статус-ряд.
// Platform layout stays controlled (workstream U): these components render
// server identity (logo/banner) inside the fixed MTA Market visual language.
import Link from "next/link";
import { ShieldCheck, Users, Signal, HelpCircle } from "lucide-react";
import { mediaUrl } from "@/lib/api-ext";
import { cn } from "@/lib/utils";

/** E-001/E-006: monitoring state pill — UNKNOWN is never shown as OFFLINE. */
export function MonitoringPill({
  state,
  className,
}: {
  state: string;
  className?: string;
}) {
  const map: Record<string, { label: string; cls: string }> = {
    ONLINE: { label: "Онлайн", cls: "bg-ok/15 text-ok border-ok/30" },
    OFFLINE: { label: "Оффлайн", cls: "bg-bad/10 text-bad border-bad/30" },
    UNKNOWN: { label: "Нет данных", cls: "bg-surface-hover text-content-muted border-line" },
  };
  const v = map[state] ?? map.UNKNOWN;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-0.5 text-xs font-medium",
        v.cls,
        className
      )}
    >
      {state === "ONLINE" ? (
        <span className="relative flex h-2 w-2" aria-hidden>
          <span className="mta-anim-ping absolute inline-flex h-full w-full rounded-full bg-ok opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-ok" />
        </span>
      ) : state === "OFFLINE" ? (
        <Signal className="h-3 w-3" />
      ) : (
        <HelpCircle className="h-3 w-3" />
      )}
      {v.label}
    </span>
  );
}

/** C-002: Verified Server badge — ownership/control verified, nothing more. */
export function VerificationBadge({ verification }: { verification: string }) {
  if (verification !== "VERIFIED") return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-pill border border-verified/30 bg-verified/10 px-2 py-0.5 text-xs font-medium text-verified"
      title="Владение сервером подтверждено"
    >
      <ShieldCheck className="h-3 w-3" />
      Verified
    </span>
  );
}

/** Servers-page card (SURFACE: logo, name, status, online, rating, region). */
export function ServerCard({
  server,
}: {
  server: {
    slug: string;
    name: string;
    description: string;
    logoUrl: string | null;
    bannerUrl: string | null;
    monitoring: string;
    playerCount: number | null;
    maxPlayers: number | null;
    verification: string;
    region?: string | null;
    rating?: number | null;
    followerCount?: number;
  };
}) {
  const banner = mediaUrl(server.bannerUrl);
  const logo = mediaUrl(server.logoUrl);
  return (
    <Link
      href={`/servers/${server.slug}`}
      className="group block overflow-hidden rounded-card border border-line bg-surface shadow-card transition-colors duration-fast hover:border-accent/50 hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {/* Banner: h-28, gradient overlay к поверхности карточки */}
      <div className="relative h-28 w-full overflow-hidden bg-surface-inset">
        {banner ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={banner}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-surface-hover via-surface-raised to-surface-inset" />
        )}
        <div
          className="absolute inset-0 bg-gradient-to-t from-surface-raised via-surface-raised/20 to-transparent"
          aria-hidden
        />
        <div className="absolute right-3 top-3">
          <MonitoringPill state={server.monitoring} />
        </div>
      </div>

      <div className="relative p-4 pt-9">
        {/* Логотип перекрывает границу banner/body */}
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logo}
            alt={server.name}
            loading="lazy"
            className="absolute -top-6 left-4 h-14 w-14 rounded-xl border-2 border-line bg-surface object-cover shadow-card"
          />
        ) : (
          <div className="absolute -top-6 left-4 flex h-14 w-14 items-center justify-center rounded-xl border-2 border-line bg-surface text-sm font-bold text-content-secondary shadow-card">
            {server.name.slice(0, 2).toUpperCase()}
          </div>
        )}

        <div className="flex items-center gap-2">
          <h3 className="truncate font-semibold text-content transition-colors duration-fast group-hover:text-accent-strong">
            {server.name}
          </h3>
          <VerificationBadge verification={server.verification} />
        </div>
        <p className="mt-1.5 line-clamp-2 min-h-[2.5rem] text-sm text-content-secondary">
          {server.description || "Описание пока не заполнено."}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-3 text-xs text-content-muted">
          {server.playerCount != null && server.maxPlayers != null ? (
            <span className="inline-flex items-center gap-1 font-medium tabular-nums text-ok">
              <Users className="h-3.5 w-3.5" />
              {server.playerCount}/{server.maxPlayers}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 tabular-nums">
              <Users className="h-3.5 w-3.5" />—
            </span>
          )}
          {server.region ? <span>{server.region}</span> : null}
          {server.rating != null ? (
            <span className="tabular-nums">★ {server.rating}</span>
          ) : null}
          {server.followerCount != null ? (
            <span className="tabular-nums">
              {server.followerCount.toLocaleString("ru-RU")} подписчиков
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}