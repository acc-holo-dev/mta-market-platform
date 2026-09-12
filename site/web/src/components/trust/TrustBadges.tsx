// PLAN-015 §19: единая trust-система бейджей платформы.
// Один примитив — TrustBadge — вместо россыпи per-page дизайнов.
// Рендерит только РЕАЛЬНЫЕ сигналы (§41): верификация сервера/продавца,
// подтверждённое взаимодействие, модерация. Верификация = подтверждённый
// факт (владение/модерация), а не оценка качества (PRODUCT-MODEL §5).
import { ShieldCheck, BadgeCheck, CircleCheck, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type TrustSignal =
  | "VERIFIED_SERVER"
  | "VERIFIED_CREATOR"
  | "VERIFIED_INTERACTION"
  | "MODERATED"
  | "OFFICIAL"
  | "COMMUNITY";

interface TrustMeta {
  label: string;
  title: string;
  icon: typeof ShieldCheck;
  cls: string;
}

const TRUST_META: Record<TrustSignal, TrustMeta> = {
  VERIFIED_SERVER: {
    label: "Verified Server",
    title: "Владение сервером подтверждено интеграцией",
    icon: ShieldCheck,
    cls: "bg-verified-soft text-verified",
  },
  VERIFIED_CREATOR: {
    label: "Verified Creator",
    title: "Продавец прошёл проверку площадки",
    icon: BadgeCheck,
    cls: "bg-verified-soft text-verified",
  },
  VERIFIED_INTERACTION: {
    label: "Verified Interaction",
    title: "Отзыв подтверждён реальным взаимодействием",
    icon: CircleCheck,
    cls: "bg-ok-soft text-ok",
  },
  MODERATED: {
    label: "Проверен",
    title: "Прошёл модерацию площадки",
    icon: BadgeCheck,
    cls: "bg-ok-soft text-ok",
  },
  OFFICIAL: {
    label: "Official",
    title: "Официальный контент площадки",
    icon: ShieldCheck,
    cls: "bg-accent-soft text-accent-strong",
  },
  COMMUNITY: {
    label: "Community",
    title: "Контент сообщества",
    icon: HelpCircle,
    cls: "bg-info-soft text-info",
  },
};

export function TrustBadge({ signal, className }: { signal: TrustSignal; className?: string }) {
  const meta = TRUST_META[signal];
  const Icon = meta.icon;
  return (
    <span
      title={meta.title}
      className={cn(
        "inline-flex flex-shrink-0 items-center gap-1 rounded-pill px-2 py-0.5 text-[11px] font-medium",
        meta.cls,
        className
      )}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {meta.label}
    </span>
  );
}

/** Строка trust-бейджей; скрытые сигналы просто не передаются. */
export function TrustBadges({
  signals,
  className,
}: {
  signals: (TrustSignal | null | undefined)[];
  className?: string;
}) {
  const visible = signals.filter((s): s is TrustSignal => Boolean(s));
  if (!visible.length) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {visible.map((signal, i) => (
        <TrustBadge key={`${signal}-${i}`} signal={signal} />
      ))}
    </div>
  );
}
