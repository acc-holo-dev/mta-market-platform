// Панель управления сервером (PLAN-005 N): обзор, настройки, брендинг,
// приватность, новости, обновления, персонал, ресурсы, верификация.
// Доступ только для staff: GET /servers/:slug/manage отдаёт 403 всем остальным.
"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  BadgeCheck,
  Check,
  Eye,
  Globe,
  Heart,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  Lock,
  Newspaper,
  Package,
  Plus,
  RefreshCcw,
  Settings,
  ShieldCheck,
  Star,
  Trash2,
  UserCog,
} from "lucide-react";
import { bootstrapSession } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import {
  addServerStaff,
  createServerNews,
  createServerUpdate,
  deleteServerNews,
  deleteServerUpdate,
  fetchServerManage,
  fetchServerNews,
  fetchServerResources,
  fetchServerStaff,
  fetchServerUpdates,
  fetchVerification,
  getErrorMessage,
  issueIntegrationToken,
  linkServerResource,
  mediaUrl,
  publishServerNews,
  removeServerStaff,
  unlinkServerResource,
  updateServer,
  updateServerPrivacy,
  uploadMedia,
  type ServerManage,
  type ServerNewsItem,
  type ServerResourceCard,
  type ServerUpdateItem,
} from "@/lib/api-ext";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { Tabs } from "@/components/ui/Tabs";
import { Avatar } from "@/components/ui/Avatar";
import { Skeleton } from "@/components/ui/Skeleton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { MonitoringPill } from "@/components/servers/ServerCard";

type TabKey =
  | "overview"
  | "settings"
  | "branding"
  | "privacy"
  | "news"
  | "updates"
  | "staff"
  | "resources"
  | "verification";

const TABS: [TabKey, string][] = [
  ["overview", "Обзор"],
  ["settings", "Настройки"],
  ["branding", "Брендинг"],
  ["privacy", "Приватность"],
  ["news", "Новости"],
  ["updates", "Обновления"],
  ["staff", "Персонал"],
  ["resources", "Ресурсы"],
  ["verification", "Верификация"],
];

/** Полная строка сервера из /manage: фактический payload шире TS-типа. */
type ManageServerRow = ServerManage["server"] & {
  host?: string | null;
  port?: number | null;
  showTechStack?: boolean;
};

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export default function ServerManagePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug: rawSlug } = use(params);
  const slug = decodeURIComponent(rawSlug);
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();

  // Auth-guard bootstrap: гость → /auth/login.
  const [booted, setBooted] = useState(false);
  const [tab, setTab] = useState<TabKey>("overview");
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await bootstrapSession();
      if (!cancelled && !ok) router.push("/auth/login");
      if (!cancelled) setBooted(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const manageQuery = useQuery({
    queryKey: ["server-manage", slug],
    queryFn: () => fetchServerManage(slug),
    enabled: booted && isAuthenticated(),
    retry: false,
  });

  if (!booted || !isAuthenticated()) {
    return null;
  }

  const errStatus =
    (manageQuery.error as { response?: { status?: number } } | null)?.response?.status ?? null;

  if (manageQuery.isLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-10">
        <Skeleton className="h-10 w-1/2" />
        <Skeleton className="mt-4 h-4 w-1/3" />
        <Skeleton className="mt-8 h-10 w-full" />
        <div className="mt-6 grid gap-4 md:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-card" />
          ))}
        </div>
        <Skeleton className="mt-6 h-48 w-full rounded-card" />
      </div>
    );
  }

  if (errStatus === 403) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-bad" />
              Доступ запрещён
            </CardTitle>
            <CardDescription>
              У вас нет прав персонала на этом сервере. Панель управления доступна владельцу и
              назначенным администраторам.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/servers">
              <Button variant="outline" size="sm">
                Ко всем серверам
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (manageQuery.error || !manageQuery.data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <ErrorState error={manageQuery.error} onRetry={() => manageQuery.refetch()} />
      </div>
    );
  }

  const manage = manageQuery.data;
  const server = manage.server as ManageServerRow;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <nav aria-label="Хлебные крошки" className="mb-4 text-sm text-content-muted">
        <Link href="/" className="hover:text-accent-strong">
          Главная
        </Link>
        <span className="mx-2">/</span>
        <Link href="/servers" className="hover:text-accent-strong">
          Серверы
        </Link>
        <span className="mx-2">/</span>
        <Link href={`/servers/${slug}`} className="hover:text-accent-strong">
          {server.name}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-content-secondary">Управление</span>
      </nav>

      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex flex-wrap items-center gap-3 text-3xl font-bold tracking-tight">
            Управление сервером
            <MonitoringPill state={server.monitoring} />
          </h1>
          <p className="mt-1 text-content-secondary">
            {server.name} · ваша роль: {staffRoleLabel(manage.staffRole)}
          </p>
        </div>
        <Link href={`/servers/${slug}`}>
          <Button variant="outline" size="sm">
            <Globe className="mr-2 h-4 w-4" />
            Открыть страницу
          </Button>
        </Link>
      </div>

      <Tabs tabs={TABS} value={tab} onChange={setTab} className="mb-6" />

      {tab === "overview" ? <OverviewTab manage={manage} server={server} /> : null}
      {tab === "settings" ? <SettingsTab slug={slug} server={server} /> : null}
      {tab === "branding" ? <BrandingTab slug={slug} server={server} /> : null}
      {tab === "privacy" ? <PrivacyTab slug={slug} server={server} /> : null}
      {tab === "news" ? <NewsTab slug={slug} /> : null}
      {tab === "updates" ? <UpdatesTab slug={slug} /> : null}
      {tab === "staff" ? <StaffTab slug={slug} /> : null}
      {tab === "resources" ? <ResourcesTab slug={slug} showResources={Boolean(server.showResources)} /> : null}
      {tab === "verification" ? <VerificationTab slug={slug} staffRole={manage.staffRole} /> : null}
    </div>
  );
}

function staffRoleLabel(role: string): string {
  switch (role) {
    case "OWNER":
      return "Владелец";
    case "ADMIN":
      return "Администратор";
    case "MODERATOR":
      return "Модератор";
    default:
      return role;
  }
}

/* ============================== Обзор ============================== */

function OverviewTab({ manage, server }: { manage: ServerManage; server: ManageServerRow }) {
  const stats = manage.stats;

  const cards: { label: string; value: string; icon: React.ReactNode }[] = [
    {
      label: "Подписчики",
      value: stats.followerCount.toLocaleString("ru-RU"),
      icon: <Heart className="h-4 w-4" />,
    },
    {
      label: "Отзывы",
      value: String(stats.reviewCount),
      icon: <Star className="h-4 w-4" />,
    },
    {
      label: "Рейтинг",
      value: stats.rating != null ? String(stats.rating) : "—",
      icon: <Star className="h-4 w-4" />,
    },
    {
      label: "Черновики новостей",
      value: String(stats.draftNewsCount),
      icon: <Newspaper className="h-4 w-4" />,
    },
    {
      label: "Ресурсы",
      value: String(stats.resourceCount),
      icon: <Package className="h-4 w-4" />,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {cards.map((c) => (
          <Card key={c.label} className="p-4">
            <div className="flex items-center gap-2 text-xs text-content-muted">
              {c.icon}
              {c.label}
            </div>
            <p className="mt-2 text-2xl font-bold tracking-tight">{c.value}</p>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Мониторинг</CardTitle>
          <CardDescription>Данные приходят от модуля интеграции (heartbeat).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {manage.heartbeat.fresh ? (
            <p className="flex items-center gap-2 text-sm text-ok">
              <BadgeCheck className="h-4 w-4" />
              Heartbeat получен
              {manage.heartbeat.lastSeenAt
                ? ` · ${new Date(manage.heartbeat.lastSeenAt).toLocaleString("ru-RU")}`
                : ""}
            </p>
          ) : (
            <p className="flex flex-wrap items-center gap-2 text-sm text-bad">
              <Lock className="h-4 w-4" />
              Heartbeat не поступал
              <span className="text-xs text-content-muted">
                (ожидались данные не старше {Math.max(1, Math.round(manage.heartbeat.staleMs / 60_000))} мин;
                последний: {manage.heartbeat.lastSeenAt ? new Date(manage.heartbeat.lastSeenAt).toLocaleString("ru-RU") : "нет"})
              </span>
            </p>
          )}
          <p className="text-xs text-content-secondary">
            Игроки: {server.playerCount != null ? `${server.playerCount}/${server.maxPlayers ?? "—"}` : "—/—"} ·
            верификация: {server.verification}
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Последние новости</CardTitle>
          </CardHeader>
          <CardContent>
            {manage.recentNews.length === 0 ? (
              <p className="text-sm text-content-muted">Новостей пока нет.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {manage.recentNews.slice(0, 5).map((n) => (
                  <li key={n.id} className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate">{n.title}</span>
                    <span
                      className={
                        n.status === "PUBLISHED"
                          ? "flex-shrink-0 text-xs text-ok"
                          : "flex-shrink-0 text-xs text-content-muted"
                      }
                    >
                      {n.status === "PUBLISHED" ? "Опубликовано" : "Черновик"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Последние обновления</CardTitle>
          </CardHeader>
          <CardContent>
            {manage.recentUpdates.length === 0 ? (
              <p className="text-sm text-content-muted">Обновлений пока нет.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {manage.recentUpdates.slice(0, 5).map((u) => (
                  <li key={u.id} className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate">
                      <span className="mr-2 rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-strong">
                        v{u.version}
                      </span>
                      {u.title}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ============================== Настройки ============================== */

function SettingsTab({ slug, server }: { slug: string; server: ManageServerRow }) {
  const qc = useQueryClient();
  const [name, setName] = useState(server.name);
  const [description, setDescription] = useState(server.description ?? "");
  const [region, setRegion] = useState(server.region ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(server.websiteUrl ?? "");
  const [discordUrl, setDiscordUrl] = useState(server.discordUrl ?? "");
  const [host, setHost] = useState(server.host ?? "");
  const [port, setPort] = useState(server.port != null ? String(server.port) : "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const mut = useMutation({
    mutationFn: () =>
      updateServer(slug, {
        name: name.trim(),
        description: description.trim(),
        region: region.trim() || null,
        websiteUrl: websiteUrl.trim() || null,
        discordUrl: discordUrl.trim() || null,
        host: host.trim() || null,
        port: port.trim() === "" ? null : parseInt(port, 10),
      }),
    onSuccess: () => {
      setSaved(true);
      setError(null);
      qc.invalidateQueries({ queryKey: ["server-manage", slug] });
      qc.invalidateQueries({ queryKey: ["server", slug] });
    },
    onError: (err) => {
      setSaved(false);
      setError(getErrorMessage(err, "Не удалось сохранить настройки"));
    },
  });

  const save = () => {
    setSaved(false);
    if (name.trim().length < 3 || name.trim().length > 60) {
      setError("Название сервера: от 3 до 60 символов");
      return;
    }
    if (websiteUrl.trim() && !isHttpUrl(websiteUrl.trim())) {
      setError("Сайт должен быть ссылкой вида https://...");
      return;
    }
    if (discordUrl.trim() && !isHttpUrl(discordUrl.trim())) {
      setError("Ссылка на Discord должна быть вида https://...");
      return;
    }
    const portNum = port.trim() === "" ? null : parseInt(port, 10);
    if (portNum !== null && (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535)) {
      setError("Порт должен быть целым числом от 1 до 65535");
      return;
    }
    setError(null);
    mut.mutate();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Настройки сервера</CardTitle>
        <CardDescription>Основная информация, ссылки и подключение.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <label htmlFor="m-name" className="mb-1.5 block text-sm font-medium">
            Название
          </label>
          <Input id="m-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </div>
        <div>
          <label htmlFor="m-desc" className="mb-1.5 block text-sm font-medium">
            Описание
          </label>
          <Textarea
            id="m-desc"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={8000}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="m-region" className="mb-1.5 block text-sm font-medium">
              Регион
            </label>
            <Input id="m-region" value={region} onChange={(e) => setRegion(e.target.value)} maxLength={64} />
          </div>
          <div>
            <label htmlFor="m-site" className="mb-1.5 block text-sm font-medium">
              Сайт
            </label>
            <Input
              id="m-site"
              type="url"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://example.com"
            />
          </div>
        </div>
        <div>
          <label htmlFor="m-discord" className="mb-1.5 block text-sm font-medium">
            Discord
          </label>
          <Input
            id="m-discord"
            type="url"
            value={discordUrl}
            onChange={(e) => setDiscordUrl(e.target.value)}
            placeholder="https://discord.gg/..."
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-[1fr_160px]">
          <div>
            <label htmlFor="m-host" className="mb-1.5 block text-sm font-medium">
              Host <span className="text-xs text-content-muted">(приватно по умолчанию)</span>
            </label>
            <Input id="m-host" value={host} onChange={(e) => setHost(e.target.value)} />
          </div>
          <div>
            <label htmlFor="m-port" className="mb-1.5 block text-sm font-medium">
              Port <span className="text-xs text-content-muted">(приватно по умолчанию)</span>
            </label>
            <Input
              id="m-port"
              inputMode="numeric"
              value={port}
              onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ""))}
            />
          </div>
        </div>
        <p className="text-xs text-content-muted">
          Host и port используются модулем мониторинга и никогда не публикуются автоматически.
        </p>

        {error ? (
          <p role="alert" className="text-sm text-bad">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p className="flex items-center gap-2 text-sm text-ok">
            <Check className="h-4 w-4" />
            Сохранено
          </p>
        ) : null}

        <Button onClick={save} disabled={mut.isPending}>
          {mut.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Сохраняем...
            </>
          ) : (
            <>
              <Settings className="mr-2 h-4 w-4" />
              Сохранить настройки
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

/* ============================== Брендинг ============================== */

function BrandingTab({ slug, server }: { slug: string; server: ManageServerRow }) {
  const qc = useQueryClient();
  const [logoUrl, setLogoUrl] = useState<string | null>(server.logoUrl);
  const [bannerUrl, setBannerUrl] = useState<string | null>(server.bannerUrl);
  const [accentColor, setAccentColor] = useState(server.accentColor ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const saveMut = useMutation({
    mutationFn: (patch: Record<string, unknown>) => updateServer(slug, patch),
    onSuccess: () => {
      setSaved(true);
      setError(null);
      qc.invalidateQueries({ queryKey: ["server-manage", slug] });
      qc.invalidateQueries({ queryKey: ["server", slug] });
    },
    onError: (err) => {
      setSaved(false);
      setError(getErrorMessage(err, "Не удалось сохранить брендинг"));
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Брендинг</CardTitle>
        <CardDescription>Логотип, баннер и акцентный цвет страницы сервера.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <MediaUploadField
          label="Логотип"
          hint="Квадратное изображение; показывается на карточке и в шапке страницы"
          value={logoUrl}
          onUploaded={(url) => {
            setLogoUrl(url);
            saveMut.mutate({ logoUrl: url });
          }}
          onCleared={() => {
            setLogoUrl(null);
            saveMut.mutate({ logoUrl: null });
          }}
        />
        <MediaUploadField
          label="Баннер"
          hint="Широкое изображение для шапки страницы сервера"
          value={bannerUrl}
          previewClass="h-24 w-full max-w-md rounded-card object-cover"
          onUploaded={(url) => {
            setBannerUrl(url);
            saveMut.mutate({ bannerUrl: url });
          }}
          onCleared={() => {
            setBannerUrl(null);
            saveMut.mutate({ bannerUrl: null });
          }}
        />

        <div>
          <label htmlFor="m-accent" className="mb-1.5 block text-sm font-medium">
            Акцентный цвет (#RRGGBB)
          </label>
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="h-10 w-10 flex-shrink-0 rounded-md border border-line"
              style={{ backgroundColor: /^#[0-9a-fA-F]{6}$/.test(accentColor) ? accentColor : undefined }}
            />
            <Input
              id="m-accent"
              value={accentColor}
              onChange={(e) => setAccentColor(e.target.value)}
              placeholder="#7C5CFF"
              className="max-w-40"
            />
          </div>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-bad">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p className="flex items-center gap-2 text-sm text-ok">
            <Check className="h-4 w-4" />
            Сохранено
          </p>
        ) : null}

        <Button
          onClick={() => {
            setSaved(false);
            if (accentColor.trim() && !/^#[0-9a-fA-F]{6}$/.test(accentColor.trim())) {
              setError("Акцентный цвет должен быть в формате #RRGGBB");
              return;
            }
            saveMut.mutate({ accentColor: accentColor.trim() || null });
          }}
          disabled={saveMut.isPending}
        >
          {saveMut.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Сохраняем...
            </>
          ) : (
            "Сохранить акцентный цвет"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

/* ============================== Приватность ============================== */

const PRIVACY_OPTIONS: {
  key: "showStats" | "showStaff" | "showResources" | "showTechStack" | "showCommunity";
  label: string;
  description: string;
}[] = [
  {
    key: "showStats",
    label: "Показывать статистику онлайна",
    description:
      "Публичными станут счётчик онлайна, график за 24 часа и время последней активности.",
  },
  {
    key: "showStaff",
    label: "Показывать персонал",
    description: "Список администрации сервера появится на публичной странице.",
  },
  {
    key: "showResources",
    label: "Показывать ресурсы",
    description:
      "Используемые сервером ресурсы Маркетплейса будут видны на публичной странице.",
  },
  {
    key: "showTechStack",
    label: "Показывать технологический стек",
    description: "Технологии, на которых работает сервер, будут видны на публичной странице.",
  },
  {
    key: "showCommunity",
    label: "Показывать сообщество",
    description: "Вкладка «Сообщество»: участники сервера и связанные темы форума.",
  },
];

function PrivacyTab({ slug, server }: { slug: string; server: ManageServerRow }) {
  const qc = useQueryClient();
  const [values, setValues] = useState<Record<string, boolean>>({
    showStats: server.showStats,
    showStaff: server.showStaff,
    showResources: server.showResources,
    showTechStack: server.showTechStack ?? false,
    showCommunity: server.showCommunity,
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const mut = useMutation({
    mutationFn: () =>
      updateServerPrivacy(slug, {
        showStats: values.showStats,
        showStaff: values.showStaff,
        showResources: values.showResources,
        showTechStack: values.showTechStack,
        showCommunity: values.showCommunity,
      }),
    onSuccess: () => {
      setSaved(true);
      setError(null);
      qc.invalidateQueries({ queryKey: ["server-manage", slug] });
      qc.invalidateQueries({ queryKey: ["server", slug] });
      qc.invalidateQueries({ queryKey: ["server-resources", slug] });
      qc.invalidateQueries({ queryKey: ["server-staff", slug] });
    },
    onError: (err) => {
      setSaved(false);
      setError(getErrorMessage(err, "Не удалось сохранить настройки приватности"));
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Приватность и видимость</CardTitle>
        <CardDescription>
          Управляйте тем, что видно на публичной странице сервера. По умолчанию всё приватно, кроме
          статистики онлайна.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {PRIVACY_OPTIONS.map((opt) => (
          <PrivacyToggle
            key={opt.key}
            label={opt.label}
            description={opt.description}
            checked={values[opt.key]}
            onChange={(v) => {
              setValues((prev) => ({ ...prev, [opt.key]: v }));
              setSaved(false);
            }}
          />
        ))}

        {error ? (
          <p role="alert" className="text-sm text-bad">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p className="flex items-center gap-2 text-sm text-ok">
            <Check className="h-4 w-4" />
            Сохранено
          </p>
        ) : null}

        <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
          {mut.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Сохраняем...
            </>
          ) : (
            "Сохранить приватность"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

function PrivacyToggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start justify-between gap-4 rounded-card border border-line bg-surface-raised p-4 text-left transition-colors hover:bg-surface-hover"
    >
      <span className="flex items-start gap-3">
        {checked ? (
          <Eye className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" />
        ) : (
          <Lock className="mt-0.5 h-4 w-4 flex-shrink-0 text-content-muted" />
        )}
        <span>
          <span className="block text-sm font-medium text-content">{label}</span>
          <span className="mt-1 block text-xs text-content-secondary">{description}</span>
        </span>
      </span>
      <span
        className={`mt-0.5 inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full border transition-colors ${
          checked ? "border-accent bg-accent" : "border-line bg-surface-hover"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </span>
    </button>
  );
}

/* ============================== Новости ============================== */

function NewsTab({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const newsQuery = useQuery({
    queryKey: ["server-news-manage", slug],
    queryFn: () => fetchServerNews(slug, 1),
  });

  const createMut = useMutation({
    mutationFn: () =>
      createServerNews(slug, {
        title: title.trim(),
        content: content.trim(),
        ...(coverUrl ? { coverUrl } : {}),
      }),
    onSuccess: () => {
      setTitle("");
      setContent("");
      setCoverUrl(null);
      setError(null);
      qc.invalidateQueries({ queryKey: ["server-news-manage", slug] });
      qc.invalidateQueries({ queryKey: ["server-manage", slug] });
    },
    onError: (err) => setError(getErrorMessage(err, "Не удалось создать новость")),
  });

  const submit = () => {
    if (title.trim().length < 3 || title.trim().length > 120) {
      setError("Заголовок новости: от 3 до 120 символов");
      return;
    }
    if (content.trim().length < 3) {
      setError("Текст новости обязателен (от 3 символов)");
      return;
    }
    setError(null);
    createMut.mutate();
  };

  const items = newsQuery.data?.data ?? [];
  const drafts = items.filter((n) => n.status !== "PUBLISHED");
  const published = items.filter((n) => n.status === "PUBLISHED");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Новая новость</CardTitle>
          <CardDescription>Новость создаётся черновиком — опубликуйте её из списка ниже.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label htmlFor="n-title" className="mb-1.5 block text-sm font-medium">
              Заголовок
            </label>
            <Input
              id="m-news-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder="Открытие нового сезона"
            />
          </div>
          <div>
            <label htmlFor="m-news-content" className="mb-1.5 block text-sm font-medium">
              Текст новости
            </label>
            <Textarea
              id="m-news-content"
              rows={5}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Что нового на сервере..."
            />
          </div>
          <MediaUploadField
            label="Обложка"
            hint="Необязательно; широкое изображение до 5 МБ"
            value={coverUrl}
            previewClass="h-24 w-full max-w-md rounded-card object-cover"
            onUploaded={(url) => setCoverUrl(url)}
            onCleared={() => setCoverUrl(null)}
          />
          {error ? (
            <p role="alert" className="text-sm text-bad">
              {error}
            </p>
          ) : null}
          <Button onClick={submit} disabled={createMut.isPending}>
            {createMut.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Сохраняем...
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                Создать черновик
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Черновики {drafts.length > 0 ? `(${drafts.length})` : ""}</CardTitle>
          <CardDescription>Публикация уведомит подписчиков сервера.</CardDescription>
        </CardHeader>
        <CardContent>
          {newsQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : newsQuery.error ? (
            <ErrorState error={newsQuery.error} onRetry={() => newsQuery.refetch()} />
          ) : drafts.length === 0 ? (
            <p className="text-sm text-content-muted">Черновиков нет.</p>
          ) : (
            <ul className="space-y-3">
              {drafts.map((n) => (
                <NewsRow key={n.id} slug={slug} item={n} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Опубликованные</CardTitle>
        </CardHeader>
        <CardContent>
          {published.length === 0 ? (
            <p className="text-sm text-content-muted">Опубликованных новостей пока нет.</p>
          ) : (
            <ul className="space-y-3">
              {published.map((n) => (
                <NewsRow key={n.id} slug={slug} item={n} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function NewsRow({ slug, item }: { slug: string; item: ServerNewsItem }) {
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [createDiscussion, setCreateDiscussion] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const publishMut = useMutation({
    mutationFn: () => publishServerNews(slug, item.id, createDiscussion),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["server-news-manage", slug] });
      qc.invalidateQueries({ queryKey: ["server-manage", slug] });
    },
    onError: (err) => setError(getErrorMessage(err, "Не удалось опубликовать")),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteServerNews(slug, item.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["server-news-manage", slug] });
      qc.invalidateQueries({ queryKey: ["server-manage", slug] });
    },
    onError: (err) => setError(getErrorMessage(err, "Не удалось удалить")),
  });

  return (
    <li className="rounded-card border border-line bg-surface-raised p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{item.title}</p>
          <p className="mt-0.5 line-clamp-1 text-xs text-content-secondary">{item.content}</p>
          <p className="mt-1 text-xs text-content-muted">
            {new Date(item.publishedAt ?? item.createdAt).toLocaleString("ru-RU")}
            {item.thread ? ` · обсуждение: ${item.thread.replyCount} ответов` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {item.status !== "PUBLISHED" ? (
            <Button size="sm" onClick={() => publishMut.mutate()} disabled={publishMut.isPending}>
              {publishMut.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Опубликовать
            </Button>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} aria-label="Удалить новость">
            <Trash2 className="h-4 w-4 text-bad" />
          </Button>
        </div>
      </div>
      {item.status !== "PUBLISHED" ? (
        <label className="mt-3 flex items-center gap-2 text-xs text-content-secondary">
          <input
            type="checkbox"
            checked={createDiscussion}
            onChange={(e) => setCreateDiscussion(e.target.checked)}
            className="h-4 w-4 rounded border-line-strong bg-surface-raised accent-[hsl(var(--primary))]"
          />
          Создать обсуждение на форуме при публикации
        </label>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm text-bad">
          {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        title="Удалить новость?"
        description={`«${item.title}» будет удалена безвозвратно.`}
        confirmLabel="Удалить"
        danger
        busy={deleteMut.isPending}
        onConfirm={() => deleteMut.mutate()}
        onCancel={() => setConfirmDelete(false)}
      />
    </li>
  );
}

/* ============================== Обновления ============================== */

function UpdatesTab({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const [version, setVersion] = useState("");
  const [title, setTitle] = useState("");
  const [changelog, setChangelog] = useState("");
  const [createDiscussion, setCreateDiscussion] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updatesQuery = useQuery({
    queryKey: ["server-updates-manage", slug],
    queryFn: () => fetchServerUpdates(slug, 1),
  });

  const createMut = useMutation({
    mutationFn: () =>
      createServerUpdate(slug, {
        version: version.trim(),
        title: title.trim(),
        changelog: changelog.trim(),
        ...(createDiscussion ? { createDiscussion: true } : {}),
      }),
    onSuccess: () => {
      setVersion("");
      setTitle("");
      setChangelog("");
      setCreateDiscussion(false);
      setError(null);
      qc.invalidateQueries({ queryKey: ["server-updates-manage", slug] });
      qc.invalidateQueries({ queryKey: ["server-manage", slug] });
    },
    onError: (err) => setError(getErrorMessage(err, "Не удалось создать обновление")),
  });

  const submit = () => {
    if (!version.trim()) {
      setError("Укажите версию (например, 1.2.0)");
      return;
    }
    if (title.trim().length < 3) {
      setError("Заголовок обновления: от 3 символов");
      return;
    }
    if (changelog.trim().length < 3) {
      setError("Опишите изменения в changelog");
      return;
    }
    setError(null);
    createMut.mutate();
  };

  const items: ServerUpdateItem[] = updatesQuery.data?.data ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Новый релиз</CardTitle>
          <CardDescription>Обновление видно игрокам сразу после создания.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
            <div>
              <label htmlFor="m-upd-version" className="mb-1.5 block text-sm font-medium">
                Версия
              </label>
              <Input
                id="m-upd-version"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="1.2.0"
              />
            </div>
            <div>
              <label htmlFor="m-upd-title" className="mb-1.5 block text-sm font-medium">
                Заголовок
              </label>
              <Input
                id="m-upd-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Античит и новые работы"
              />
            </div>
          </div>
          <div>
            <label htmlFor="m-upd-changelog" className="mb-1.5 block text-sm font-medium">
              Changelog
            </label>
            <Textarea
              id="m-upd-changelog"
              rows={4}
              value={changelog}
              onChange={(e) => setChangelog(e.target.value)}
              placeholder="- Что изменилось..."
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-content-secondary">
            <input
              type="checkbox"
              checked={createDiscussion}
              onChange={(e) => setCreateDiscussion(e.target.checked)}
              className="h-4 w-4 rounded border-line-strong bg-surface-raised"
            />
            Создать обсуждение на форуме
          </label>
          {error ? (
            <p role="alert" className="text-sm text-bad">
              {error}
            </p>
          ) : null}
          <Button onClick={submit} disabled={createMut.isPending}>
            {createMut.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Публикуем...
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                Выпустить обновление
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Список обновлений</CardTitle>
        </CardHeader>
        <CardContent>
          {updatesQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : updatesQuery.error ? (
            <ErrorState error={updatesQuery.error} onRetry={() => updatesQuery.refetch()} />
          ) : items.length === 0 ? (
            <EmptyState
              icon={<RefreshCcw className="h-10 w-10 text-content-muted mx-auto mb-3" />}
              title="Обновлений пока нет"
              description="Выпустите первую версию, чтобы игроки видели прогресс."
            />
          ) : (
            <ul className="space-y-3">
              {items.map((u) => (
                <UpdateRow key={u.id} slug={slug} item={u} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function UpdateRow({ slug, item }: { slug: string; item: ServerUpdateItem }) {
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteMut = useMutation({
    mutationFn: () => deleteServerUpdate(slug, item.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["server-updates-manage", slug] });
      qc.invalidateQueries({ queryKey: ["server-manage", slug] });
    },
  });

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 rounded-card border border-line bg-surface-raised p-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent-strong">
            v{item.version}
          </span>
          <p className="text-sm font-medium">{item.title}</p>
        </div>
        {item.changelog ? (
          <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-content-secondary">
            {item.changelog}
          </p>
        ) : null}
        <p className="mt-1 text-xs text-content-muted">
          {new Date(item.publishedAt).toLocaleString("ru-RU")}
        </p>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setConfirmDelete(true)}
        aria-label="Удалить обновление"
      >
        <Trash2 className="h-4 w-4 text-bad" />
      </Button>

      <ConfirmDialog
        open={confirmDelete}
        title="Удалить обновление?"
        description={`Обновление v${item.version} будет удалено безвозвратно.`}
        danger
        busy={deleteMut.isPending}
        onConfirm={() => deleteMut.mutate()}
        onCancel={() => setConfirmDelete(false)}
      />
    </li>
  );
}

/* ============================== Персонал ============================== */

function StaffTab({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<"ADMIN" | "MODERATOR">("MODERATOR");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const staffQuery = useQuery({
    queryKey: ["server-staff", slug],
    queryFn: () => fetchServerStaff(slug),
  });

  const addMut = useMutation({
    mutationFn: () => addServerStaff(slug, userId.trim(), role),
    onSuccess: () => {
      setUserId("");
      setError(null);
      setSaved(true);
      qc.invalidateQueries({ queryKey: ["server-staff", slug] });
    },
    onError: (err) => {
      setSaved(false);
      setError(getErrorMessage(err, "Не удалось добавить участника"));
    },
  });

  const rows = staffQuery.data?.data ?? [];

  const submit = () => {
    if (!userId.trim()) {
      setError("Укажите userId пользователя (ID из базы, не никнейм)");
      return;
    }
    setError(null);
    setSaved(false);
    addMut.mutate();
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Добавить участника</CardTitle>
          <CardDescription>
            Нужен внутренний userId пользователя — скопируйте его из профиля или обратитесь к
            разработчику: никнейм сюда вводить нельзя.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
            <div>
              <label htmlFor="m-staff-user" className="mb-1.5 block text-sm font-medium">
                userId
              </label>
              <Input
                id="m-staff-user"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="clxxxxxxxxxxxxxxxxxxxxx"
              />
            </div>
            <div>
              <label htmlFor="m-staff-role" className="mb-1.5 block text-sm font-medium">
                Роль
              </label>
              <Select
                id="m-staff-role"
                value={role}
                onChange={(e) => setRole(e.target.value as "ADMIN" | "MODERATOR")}
              >
                <option value="MODERATOR">Модератор</option>
                <option value="ADMIN">Администратор</option>
              </Select>
            </div>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-bad">
              {error}
            </p>
          ) : null}
          {saved ? (
            <p className="flex items-center gap-2 text-sm text-ok">
              <Check className="h-4 w-4" />
              Участник добавлен
            </p>
          ) : null}
          <Button onClick={submit} disabled={addMut.isPending}>
            {addMut.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Добавляем...
              </>
            ) : (
              <>
                <UserCog className="mr-2 h-4 w-4" />
                Добавить в персонал
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Персонал сервера</CardTitle>
        </CardHeader>
        <CardContent>
          {staffQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : staffQuery.error ? (
            <ErrorState error={staffQuery.error} onRetry={() => staffQuery.refetch()} />
          ) : rows.length === 0 ? (
            <p className="text-sm text-content-muted">Список пуст.</p>
          ) : (
            <ul className="space-y-3">
              {rows.map((m) => (
                <StaffRow key={m.userId} slug={slug} member={m} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StaffRow({
  slug,
  member,
}: {
  slug: string;
  member: { userId: string; role: string; username: string | null; displayName: string | null; avatar: string | null };
}) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const removeMut = useMutation({
    mutationFn: () => removeServerStaff(slug, member.userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["server-staff", slug] });
      qc.invalidateQueries({ queryKey: ["server-manage", slug] });
    },
  });

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface-raised p-3">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar src={member.avatar} name={member.displayName || member.username || "Участник"} size="sm" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {member.displayName || member.username || "Участник"}
          </p>
          <p className="text-xs text-content-secondary">
            {staffRoleLabel(member.role)}
            {member.username ? ` · @${member.username}` : ""}
          </p>
        </div>
      </div>
      {member.role !== "OWNER" ? (
        <Button variant="ghost" size="sm" onClick={() => setConfirm(true)} aria-label="Убрать из персонала">
          <Trash2 className="h-4 w-4 text-bad" />
        </Button>
      ) : (
        <span className="text-xs text-content-muted">Владелец</span>
      )}

      <ConfirmDialog
        open={confirm}
        title="Убрать из персонала?"
        description={`${member.displayName || member.username || "Участник"} потеряет доступ к панели управления.`}
        confirmLabel="Убрать"
        danger
        busy={removeMut.isPending}
        onConfirm={() => removeMut.mutate()}
        onCancel={() => setConfirm(false)}
      />
    </li>
  );
}

/* ============================== Ресурсы ============================== */

function ResourcesTab({ slug, showResources }: { slug: string; showResources: boolean }) {
  const qc = useQueryClient();
  const [resourceId, setResourceId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const resourcesQuery = useQuery({
    queryKey: ["server-resources", slug],
    queryFn: () => fetchServerResources(slug),
  });

  const addMut = useMutation({
    mutationFn: () =>
      linkServerResource(slug, {
        ...(resourceId.trim() ? { resourceId: resourceId.trim() } : {}),
        displayName: displayName.trim(),
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: () => {
      setResourceId("");
      setDisplayName("");
      setNote("");
      setError(null);
      setSaved(true);
      qc.invalidateQueries({ queryKey: ["server-resources", slug] });
      qc.invalidateQueries({ queryKey: ["server-manage", slug] });
    },
    onError: (err) => {
      setSaved(false);
      setError(getErrorMessage(err, "Не удалось привязать ресурс"));
    },
  });

  const rows = resourcesQuery.data?.data ?? [];

  const submit = () => {
    if (!displayName.trim() && !resourceId.trim()) {
      setError("Укажите название ресурса или resourceId с Маркетплейса");
      return;
    }
    if (!displayName.trim()) {
      setError("Название ресурса обязательно");
      return;
    }
    setError(null);
    setSaved(false);
    addMut.mutate();
  };

  return (
    <div className="space-y-6">
      {!showResources ? (
        <p className="rounded-card border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn">
          Список публичен только при включённой опции «Показывать ресурсы» на вкладке «Приватность».
          Сейчас он виден только персоналу.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Привязать ресурс</CardTitle>
          <CardDescription>
            Отметьте ресурсы Маркетплейса (по resourceId) или сторонние решения (по названию).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="m-res-id" className="mb-1.5 block text-sm font-medium">
                resourceId (необязательно)
              </label>
              <Input
                id="m-res-id"
                value={resourceId}
                onChange={(e) => setResourceId(e.target.value)}
                placeholder="ID ресурса с Маркетплейса"
              />
            </div>
            <div>
              <label htmlFor="m-res-name" className="mb-1.5 block text-sm font-medium">
                Название
              </label>
              <Input
                id="m-res-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Например: HUD Minimal"
                maxLength={120}
              />
            </div>
          </div>
          <div>
            <label htmlFor="m-res-note" className="mb-1.5 block text-sm font-medium">
              Заметка
            </label>
            <Input
              id="m-res-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Для чего используется"
              maxLength={300}
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-bad">
              {error}
            </p>
          ) : null}
          {saved ? (
            <p className="flex items-center gap-2 text-sm text-ok">
              <Check className="h-4 w-4" />
              Ресурс привязан
            </p>
          ) : null}
          <Button onClick={submit} disabled={addMut.isPending}>
            {addMut.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Привязываем...
              </>
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                Привязать ресурс
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Используемые ресурсы</CardTitle>
        </CardHeader>
        <CardContent>
          {resourcesQuery.isLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : resourcesQuery.error ? (
            <ErrorState error={resourcesQuery.error} onRetry={() => resourcesQuery.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState
              icon={<Package className="h-10 w-10 text-content-muted mx-auto mb-3" />}
              title="Ресурсы не привязаны"
              description="Привяжите ресурсы, которые использует сервер, — это честная витрина зависимостей."
            />
          ) : (
            <ul className="space-y-3">
              {rows.map((r) => (
                <ResourceLinkRow key={r.id} slug={slug} row={r} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ResourceLinkRow({ slug, row }: { slug: string; row: ServerResourceCard }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const cover = mediaUrl(row.coverUrl);

  const unlinkMut = useMutation({
    mutationFn: () => unlinkServerResource(slug, row.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["server-resources", slug] });
      qc.invalidateQueries({ queryKey: ["server-manage", slug] });
    },
  });

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface-raised p-3">
      <div className="flex min-w-0 items-center gap-3">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt="" loading="lazy" className="h-10 w-10 flex-shrink-0 rounded-md object-cover" />
        ) : (
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md bg-surface-hover text-content-muted">
            <Package className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0">
          {row.slug ? (
            <Link href={`/resources/${row.slug}`} className="truncate text-sm font-medium hover:text-accent">
              {row.displayName}
            </Link>
          ) : (
            <p className="truncate text-sm font-medium">{row.displayName}</p>
          )}
          {row.note ? <p className="truncate text-xs text-content-secondary">{row.note}</p> : null}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setConfirm(true)}
        aria-label="Отвязать ресурс"
      >
        <Trash2 className="h-4 w-4 text-bad" />
      </Button>

      <ConfirmDialog
        open={confirm}
        title="Отвязать ресурс?"
        description={`«${row.displayName}» больше не будет связан с сервером.`}
        confirmLabel="Отвязать"
        danger
        busy={unlinkMut.isPending}
        onConfirm={() => unlinkMut.mutate()}
        onCancel={() => setConfirm(false)}
      />
    </li>
  );
}

/* ============================== Верификация ============================== */

const VERIFICATION_LABELS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Ожидает подтверждения", cls: "bg-accent-soft text-accent-strong border-accent/30" },
  VERIFIED: { label: "Подтверждён", cls: "bg-ok/10 text-ok border-ok/30" },
  FAILED: { label: "Не прошёл проверку", cls: "bg-bad/10 text-bad border-bad/30" },
  EXPIRED: { label: "Токен истёк", cls: "bg-surface-hover text-content-secondary border-line" },
};

function VerificationTab({ slug, staffRole }: { slug: string; staffRole: string }) {
  const verifyQuery = useQuery({
    queryKey: ["server-verification", slug],
    queryFn: () => fetchVerification(slug),
  });

  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const issueMut = useMutation({
    mutationFn: () => issueIntegrationToken(slug),
    onSuccess: (data) => {
      setToken(data.token);
      setError(null);
      verifyQuery.refetch();
    },
    onError: (err) => setError(getErrorMessage(err, "Не удалось выпустить токен")),
  });

  const state = verifyQuery.data;
  const badge = state ? VERIFICATION_LABELS[state.verification] ?? null : null;
  const isOwner = staffRole === "OWNER";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-accent" />
          Верификация владения
        </CardTitle>
        <CardDescription>
          Токен подтверждает, что сервером управляет его владелец. Выпуск и перевыпуск доступен только
          владельцу.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-content-secondary">Статус:</span>
            {verifyQuery.isLoading ? (
              <Skeleton className="h-6 w-40" />
            ) : badge ? (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${badge.cls}`}
              >
                {badge.label}
              </span>
            ) : (
              <span className="text-sm text-content-muted">Токен ещё не выпущен</span>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => verifyQuery.refetch()}
            disabled={verifyQuery.isFetching}
          >
            <RefreshCcw className={`mr-2 h-4 w-4 ${verifyQuery.isFetching ? "animate-spin" : ""}`} />
            Обновить
          </Button>
        </div>

        {state?.note ? (
          <p className="rounded-card border border-line bg-surface-raised px-4 py-3 text-sm text-content-secondary">
            {state.note}
          </p>
        ) : null}
        {state?.issuedAt ? (
          <p className="text-xs text-content-muted">
            Токен выпущен: {new Date(state.issuedAt).toLocaleString("ru-RU")}
            {state.verifiedAt
              ? ` · подтверждён: ${new Date(state.verifiedAt).toLocaleString("ru-RU")}`
              : ""}
          </p>
        ) : null}

        {token ? (
          <div className="space-y-3">
            <p className="text-sm font-medium">Новый токен (показывается один раз):</p>
            <div className="flex items-start gap-2 rounded-card border border-accent bg-accent-soft p-4">
              <code className="min-w-0 flex-1 break-all font-mono text-sm text-accent-strong select-all">
                {token}
              </code>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(token);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  } catch {
                    setError("Не удалось скопировать — выделите токен вручную");
                  }
                }}
              >
                {copied ? (
                  <>
                    <Check className="mr-1 h-4 w-4 text-ok" />
                    Скопировано
                  </>
                ) : (
                  <>
                    <KeyRound className="mr-1 h-4 w-4" />
                    Копировать
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="space-y-2 rounded-card border border-line bg-surface-raised p-4 text-sm text-content-secondary">
          <p className="flex items-start gap-2">
            <KeyRound className="mt-0.5 h-4 w-4 flex-shrink-0 text-content-muted" />
            Установите токен в конфигурацию модуля интеграции на вашем сервере MTA:SA.
          </p>
          <p className="flex items-start gap-2">
            <Activity className="mt-0.5 h-4 w-4 flex-shrink-0 text-content-muted" />
            Статус VERIFIED появится после первого heartbeat от модуля.
          </p>
          {!state?.verification || state.verification === "FAILED" ? (
            <p className="flex items-start gap-2">
              <Lock className="mt-0.5 h-4 w-4 flex-shrink-0 text-content-muted" />
              FAILED — токен не совпал или heartbeat с неверным токеном; перевыпустите токен и
              проверьте конфигурацию.
            </p>
          ) : null}
          {state?.verification === "EXPIRED" ? (
            <p className="flex items-start gap-2">
              <Lock className="mt-0.5 h-4 w-4 flex-shrink-0 text-content-muted" />
              EXPIRED — срок действия токена истёк; выпустите новый токен и обновите конфигурацию.
            </p>
          ) : null}
        </div>

        {error ? (
          <p role="alert" className="text-sm text-bad">
            {error}
          </p>
        ) : null}

        <div>
          <Button
            onClick={() => issueMut.mutate()}
            disabled={issueMut.isPending || !isOwner}
          >
            {issueMut.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Выпускаем...
              </>
            ) : (
              <>
                <KeyRound className="mr-2 h-4 w-4" />
                Выпустить токен интеграции
              </>
            )}
          </Button>
          {!isOwner ? (
            <p className="mt-2 text-xs text-content-muted">
              Выпуск токена доступен только владельцу сервера.
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

/* ============================== Медиа-поле ============================== */

function MediaUploadField({
  label,
  hint,
  value,
  previewClass,
  onUploaded,
  onCleared,
}: {
  label: string;
  hint?: string;
  value: string | null;
  previewClass?: string;
  onUploaded: (url: string) => void;
  onCleared: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const res = await uploadMedia(file);
      onUploaded(res.url);
    } catch (err) {
      setError(getErrorMessage(err, "Не удалось загрузить изображение"));
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const resolved = mediaUrl(value);

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      {hint ? <p className="text-xs text-content-muted">{hint}</p> : null}
      <div className="flex flex-wrap items-center gap-4">
        {resolved ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={resolved}
            alt={label}
            loading="lazy"
            className={previewClass ?? "h-16 w-16 rounded-xl object-cover"}
          />
        ) : (
          <div
            className={`flex items-center justify-center border border-dashed border-line bg-surface-raised text-content-muted ${
              previewClass?.includes("w-full") ? "h-24 w-full max-w-md" : "h-16 w-16 rounded-xl"
            }`}
          >
            <ImageIcon className="h-4 w-4" />
          </div>
        )}
        <div className="space-y-2">
          <input
            type="file"
            accept="image/*"
            onChange={onFile}
            disabled={uploading}
            aria-label={`Загрузить ${label.toLowerCase()}`}
            className="block w-full text-sm text-content-secondary file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-surface-hover file:px-3 file:py-1.5 file:text-sm file:text-content hover:file:bg-accent-soft"
          />
          {value ? (
            <Button variant="ghost" size="sm" onClick={onCleared} disabled={uploading}>
              Убрать
            </Button>
          ) : null}
          {uploading ? (
            <p className="flex items-center gap-2 text-xs text-content-secondary">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загрузка...
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-xs text-bad">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
