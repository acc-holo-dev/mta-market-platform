// PLAN-005 V/D: shared server-domain visual primitives.
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
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        v.cls,
        className
      )}
    >
      {state === "ONLINE" ? (
        <Signal className="h-3 w-3" />
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
      className="inline-flex items-center gap-1 rounded-full border border-ok/30 bg-ok/10 px-2 py-0.5 text-xs font-medium text-ok"
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
      className="group block overflow-hidden rounded-card border border-line bg-surface-raised transition-colors hover:border-line-strong"
    >
      <div className="relative h-24 w-full overflow-hidden bg-surface-hover">
        {banner ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={banner}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-r from-surface-hover to-surface-raised" />
        )}
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logo}
            alt={server.name}
            loading="lazy"
            className="absolute bottom-2 left-3 h-12 w-12 rounded-xl border border-line object-cover bg-surface"
          />
        ) : (
          <div className="absolute bottom-2 left-3 flex h-12 w-12 items-center justify-center rounded-xl border border-line bg-surface text-sm font-bold text-content-secondary">
            {server.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div className="absolute right-2 top-2">
          <MonitoringPill state={server.monitoring} />
        </div>
      </div>
      <div className="p-4">
        <div className="flex items-center gap-2">
          <h3 className="truncate font-semibold">{server.name}</h3>
          <VerificationBadge verification={server.verification} />
        </div>
        <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm text-content-secondary">
          {server.description || "Описание пока не заполнено."}
        </p>
        <div className="mt-3 flex items-center gap-3 text-xs text-content-muted">
          {server.playerCount != null && server.maxPlayers != null ? (
            <span className="inline-flex items-center gap-1">
              <Users className="h-3.5 w-3.5" />
              {server.playerCount}/{server.maxPlayers}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Users className="h-3 w-3" />—
            </span>
          )}
          {server.region ? <span>{server.region}</span> : null}
          {server.rating != null ? <span>★ {server.rating}</span> : null}
          {server.followerCount != null ? (
            <span>{server.followerCount.toLocaleString("ru-RU")} подписчиков</span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}