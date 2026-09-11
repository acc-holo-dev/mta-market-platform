// Admin (PLAN-002 I-001..I-006): control center — дашборд со статистикой,
// очередь модерации, заявки продавцов, споры, отзыв версий.
// Существующий backend/admin функционал сохранён, presentation переработана.
"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  fetchAdminStats,
  fetchAdminResources,
  adminSetResourceStatus,
  fetchAdminResourceDetail,
  fetchModerationEvents,
  fetchAdminSellers,
  adminSellerAction,
  fetchAdminDisputes,
  adminTransitionDispute,
  fetchDispute,
  postDisputeMessage,
  adminYankVersion,
  adminVersionCompatibility,
  fetchAdminServers,
  fetchAdminServerDetail,
  adminServerLifecycle,
  adminServerVerification,
  fetchAdminReports,
  adminResolveReport,
  adminModerateNews,
  adminModerateServerReview,
  adminModerateThread,
  formatRub,
  getErrorMessage,
  type Resource,
  type Dispute,
  type AdminServerRow,
  type AdminReport,
  fetchAdminArticles,
  adminArticleAction,
  type AdminArticle,
} from "@/lib/api-ext";
import { useAuthStore } from "@/store/auth";
import { bootstrapSession } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Select } from "@/components/ui/Input";
import { Tabs } from "@/components/ui/Tabs";
import { StatusBadge, statusLabel } from "@/components/ui/StatusBadge";
import { ResourceCover } from "@/components/ui/ResourceCover";
import { Gallery } from "@/components/ui/Gallery";
import { MessageThread } from "@/components/MessageThread";
import { LoadingSpinner, EmptyState } from "@/components/ui/States";
import { typeLabel, formatDate } from "@/lib/domain";
import { Shield, Gavel, Users, Ban, Inbox, Server, Flag, MessageSquare, FileText } from "lucide-react";

type Tab = "moderation" | "sellers" | "disputes" | "versions" | "servers" | "reports" | "community" | "articles";

export default function AdminPage() {
  const { user, isAuthenticated } = useAuthStore();
  const [tab, setTab] = useState<Tab>("moderation");
  const [booted, setBooted] = useState(false);

  // G-001/G-002: the access token is memory-only, so a direct visit to
  // /admin (fresh load or reload) must restore the session from the refresh
  // cookie BEFORE the role check, otherwise an admin sees "access denied".
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await bootstrapSession();
      if (!cancelled) setBooted(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!booted) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-12">
        <LoadingSpinner label="Загрузка админ-панели..." />
      </div>
    );
  }

  if (!isAuthenticated() || !user || (user.role !== "ADMIN" && user.role !== "MODERATOR")) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-16">
        <Card className="mx-auto max-w-md text-center">
          <CardContent className="py-10 space-y-3">
            <Shield className="h-10 w-10 text-bad mx-auto" />
            <CardTitle className="text-bad">Доступ запрещён</CardTitle>
            <CardDescription>Раздел доступен только администраторам и модераторам.</CardDescription>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <Shield className="h-7 w-7 text-accent" /> Панель управления
        </h1>
        <p className="mt-1 text-content-secondary">
          Модерация ресурсов, продавцы, серверы, споры, жалобы и версии
        </p>
      </div>

      <StatsCards />

      <Tabs
        className="my-6"
        value={tab}
        onChange={setTab}
        tabs={[
          ["moderation", "Модерация ресурсов"],
          ["sellers", "Продавцы"],
          ["disputes", "Споры"],
          ["versions", "Версии"],
          ["servers", "Серверы"],
          ["reports", "Жалобы"],
          ["community", "Контент сообщества"],
          ["articles", "Статьи"],
        ]}
      />

      {tab === "moderation" ? <ModerationSection /> : null}
      {tab === "sellers" ? <SellersSection /> : null}
      {tab === "disputes" ? <DisputesSection /> : null}
      {tab === "versions" ? <VersionsSection /> : null}
      {tab === "servers" ? <AdminServersSection /> : null}
      {tab === "reports" ? <ReportsSection /> : null}
      {tab === "community" ? <CommunityModerationSection /> : null}
      {tab === "articles" ? <ArticlesModerationSection /> : null}
    </div>
  );
}

// ---------- Dashboard (I-002) ----------
function StatsCards() {
  const { data } = useQuery({ queryKey: ["admin-stats"], queryFn: fetchAdminStats });

  const cards: { label: string; value: string | number; accent?: boolean }[] = [
    { label: "Пользователи", value: data?.users.total ?? "—" },
    { label: "Активные", value: data?.users.active ?? "—" },
    { label: "Забанены", value: data?.users.banned ?? "—" },
    { label: "Ресурсы", value: data?.resources.total ?? "—" },
    { label: "Опубликованы", value: data?.resources.published ?? "—" },
    { label: "На модерации", value: data?.resources.pendingReview ?? "—", accent: true },
    { label: "Отзывы", value: data?.reviews.total ?? "—" },
    {
      label: "Средняя оценка",
      value: data?.reviews.averageRating != null ? data.reviews.averageRating.toFixed(1) : "—",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map((c) => (
        <Card key={c.label} className={c.accent ? "border-accent/40" : undefined}>
          <CardContent className="pt-6">
            <p className="text-xs font-medium text-content-secondary">{c.label}</p>
            <div className="text-2xl font-bold mt-1">{c.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------- Moderation queue (I-003/I-004/I-005 + PLAN-003 M-001/M-002) ----------
function ModerationSection() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [eventsFor, setEventsFor] = useState<string | null>(null);
  const [detailFor, setDetailFor] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-resources", "PENDING_REVIEW"],
    queryFn: () => fetchAdminResources("PENDING_REVIEW", 1),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status, reason }: { id: string; status: string; reason?: string }) =>
      adminSetResourceStatus(id, status, reason),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin-resources"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
      qc.invalidateQueries({ queryKey: ["moderation-events"] });
      setDetailFor(null);
    },
    onError: (e) => setError(getErrorMessage(e, "Не удалось изменить статус")),
  });

  const list: Resource[] = data?.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Очередь модерации</CardTitle>
        <CardDescription>Полная продуктовая карточка каждого ресурса</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <p className="text-sm text-bad">{error}</p> : null}
        {isLoading ? (
          <LoadingSpinner label="Загрузка очереди..." />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-12 w-12 text-content-muted mx-auto mb-4" />}
            title="Очередь пуста."
            description="Все отправленные ресурсы обработаны"
          />
        ) : (
          list.map((r) => (
            <div
              key={r.id}
              className="p-4 rounded-card border border-line bg-surface-raised space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  {/* M-001/M-002: модератор видит тот же product view, что и покупатель */}
                  <div className="w-28 flex-shrink-0">
                    <ResourceCover
                      coverUrl={r.coverUrl}
                      type={r.type}
                      title={r.title}
                      className="aspect-video rounded-md border border-line"
                    />
                  </div>
                  <div>
                    <p className="font-medium">{r.title}</p>
                    <p className="text-sm text-content-secondary">
                      {typeLabel(r.type)} · /{r.slug} ·{" "}
                      {r.price === 0 ? "бесплатно" : formatRub(r.price)} · отправлен{" "}
                      {formatDate(r.createdAt)}
                    </p>
                    {r.seller?.displayName || r.seller?.username ? (
                      <p className="text-xs text-content-muted">
                        Продавец: {r.seller?.displayName || r.seller?.username}
                      </p>
                    ) : null}
                    <p className="mt-1 text-sm text-content-secondary line-clamp-2 max-w-xl">
                      {r.description}
                    </p>
                  </div>
                </div>
                <StatusBadge status={r.status} />
              </div>

              <div className="flex gap-2 flex-wrap">
                <Button size="sm" disabled={statusMutation.isPending} onClick={() => statusMutation.mutate({ id: r.id, status: "PUBLISHED" })}>
                  Опубликовать
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={statusMutation.isPending}
                  onClick={() =>
                    statusMutation.mutate({
                      id: r.id,
                      status: "SUSPENDED",
                      reason: reasons[r.id] || "Отклонено модератором",
                    })
                  }
                >
                  Отклонить
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setDetailFor(detailFor === r.id ? null : r.id)}>
                  {detailFor === r.id ? "Скрыть товар" : "Проверить товар"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setEventsFor(eventsFor === r.id ? null : r.id)}>
                  История модерации
                </Button>
              </div>

              <Input
                value={reasons[r.id] ?? ""}
                onChange={(e) => setReasons((m) => ({ ...m, [r.id]: e.target.value }))}
                placeholder="Причина (для отклонения)"
                aria-label={`Причина отклонения для ${r.title}`}
              />

              {detailFor === r.id ? (
                <ModerationProductView resourceId={r.id} />
              ) : null}
              {eventsFor === r.id ? <ModerationEvents resourceId={r.id} /> : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

// M-001/M-002: почти та же product presentation, которую увидит buyer —
// cover, screenshots, описание, версии с artifact/validation статусом.
function ModerationProductView({ resourceId }: { resourceId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-resource-detail", resourceId],
    queryFn: () => fetchAdminResourceDetail(resourceId),
  });

  if (isLoading) return <LoadingSpinner label="Загрузка карточки товара..." className="py-6" />;
  if (error || !data)
    return (
      <p className="text-sm text-bad" role="alert">
        Не удалось загрузить карточку товара.
      </p>
    );

  const gallery = [
    ...(data.cover ? [{ id: "cover", url: data.cover, alt: "Обложка ресурса" }] : []),
    ...data.screenshots.map((s) => ({ id: s.id, url: s.url, alt: "Скриншот ресурса" })),
  ];

  return (
    <div className="rounded-card border border-line bg-surface p-4 space-y-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-content-muted">
        Товар так, как его увидит покупатель
      </p>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          {gallery.length > 0 ? (
            <Gallery images={gallery} aspect="aspect-video" />
          ) : (
            <div className="rounded-card border border-dashed border-line p-6 text-center text-sm text-content-muted">
              Медиа не загружено — покупатель увидит текстовую заглушку.
            </div>
          )}
        </div>
        <div className="space-y-2 text-sm">
          <p className="text-lg font-semibold">{data.resource.title}</p>
          <p className="text-content-secondary">
            {typeLabel(data.resource.type)} · {data.resource.price === 0 ? "Бесплатно" : formatRub(data.resource.price)}
          </p>
          {data.resource.seller ? (
            <p className="text-content-secondary">
              Продавец: {data.resource.seller.displayName || data.resource.seller.username}
            </p>
          ) : null}
          <p className="text-content-secondary whitespace-pre-line line-clamp-6">
            {data.resource.description}
          </p>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-content-muted mb-2">
          Версии и артефакты
        </p>
        {data.versions.length === 0 ? (
          <p className="text-sm text-content-muted">Версии не загружены.</p>
        ) : (
          <ul className="space-y-2">
            {data.versions.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm rounded-md border border-line p-2.5">
                <span className="font-semibold">v{v.version}</span>
                <StatusBadge status={v.releaseStatus === "PUBLISHED" ? "COMPLETED" : v.releaseStatus === "CANDIDATE" ? "DRAFT" : v.releaseStatus} />
                <span className="text-xs text-content-secondary">
                  {(v.fileSize / 1024).toFixed(1)} КБ
                </span>
                <span className="text-xs text-content-secondary">
                  {v.signed ? "подписан" : "без подписи"} · проверка: {v.validationStatus}
                </span>
                {v.changelog ? (
                  <span className="basis-full text-xs text-content-muted">{v.changelog}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ModerationEvents({ resourceId }: { resourceId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["moderation-events", resourceId],
    queryFn: () => fetchModerationEvents(resourceId),
  });

  if (isLoading) return <LoadingSpinner label="Загрузка истории..." className="py-6" />;

  const list = (Array.isArray(data) ? data : ((data as { data?: unknown[] })?.data ?? [])) as {
    fromStatus?: string;
    toStatus?: string;
    reason?: string | null;
    createdAt?: string;
    actorId?: string;
  }[];

  return (
    <div className="p-3 rounded-md bg-surface text-sm">
      <p className="text-xs font-medium mb-2 text-content-secondary">События модерации</p>
      {list.length === 0 ? (
        <p className="text-xs text-content-muted">Событий нет.</p>
      ) : (
        <ul className="space-y-1.5">
          {list.map((ev, i) => (
            <li key={i} className="text-xs text-content-secondary">
              {ev.createdAt ? formatDate(ev.createdAt) : "—"}:{" "}
              <StatusBadge status={ev.toStatus ?? "UNKNOWN"} />{" "}
              {ev.reason ? <span className="text-content-muted">— {ev.reason}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- Seller approvals (I-006) ----------
interface SellerRow {
  id: string;
  userId: string;
  status: string;
  displayName?: string | null;
  user?: { username?: string; email?: string };
}

function SellersSection() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-sellers", "PENDING"],
    queryFn: () => fetchAdminSellers("PENDING"),
  });

  const action = useMutation({
    mutationFn: ({ userId, act }: { userId: string; act: "approve" | "reject" }) =>
      adminSellerAction(userId, act, act === "reject" ? reason || "Отклонено" : undefined),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin-sellers"] });
      qc.invalidateQueries({ queryKey: ["admin-stats"] });
    },
    onError: (e) => setError(getErrorMessage(e, "Действие не выполнено")),
  });

  const list = (Array.isArray(data) ? data : ((data as { data?: unknown[] })?.data ?? [])) as SellerRow[];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5 text-accent" /> Заявки продавцов
        </CardTitle>
        <CardDescription>Ожидают одобрения</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <p className="text-sm text-bad">{error}</p> : null}
        {isLoading ? (
          <LoadingSpinner label="Загрузка заявок..." />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Users className="h-12 w-12 text-content-muted mx-auto mb-4" />}
            title="Нет заявок"
            description="Новые заявки на статус продавца появятся здесь"
          />
        ) : (
          <>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Причина отклонения (необязательно)"
              aria-label="Причина отклонения"
            />
            {list.map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-start justify-between gap-3 p-4 rounded-card border border-line bg-surface-raised"
              >
                <div>
                  <p className="font-medium">{s.displayName || s.user?.username || s.userId}</p>
                  <p className="text-xs text-content-muted">{s.user?.email ?? s.userId}</p>
                  <p className="text-[11px] font-mono text-content-muted/70">{s.userId}</p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={action.isPending}
                    onClick={() => action.mutate({ userId: s.userId, act: "approve" })}
                  >
                    Одобрить
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={action.isPending}
                    onClick={() => action.mutate({ userId: s.userId, act: "reject" })}
                  >
                    Отклонить
                  </Button>
                </div>
              </div>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Disputes ----------
const DISPUTE_TRANSITIONS: [string, string][] = [
  ["UNDER_REVIEW", "На рассмотрении"],
  ["RESOLVED_BUYER", "Решён в пользу покупателя"],
  ["RESOLVED_SELLER", "Решён в пользу продавца"],
  ["PARTIAL_REFUND", "Частичный возврат"],
  ["CLOSED", "Закрыт"],
];

function DisputesSection() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-disputes"],
    queryFn: () => fetchAdminDisputes(),
  });

  const transition = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      adminTransitionDispute(id, status),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin-disputes"] });
    },
    onError: (e) => setError(getErrorMessage(e, "Не удалось изменить статус спора")),
  });

  const list: Dispute[] = data?.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gavel className="h-5 w-5 text-accent" /> Споры
        </CardTitle>
        <CardDescription>Все споры и переходы статусов</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <p className="text-sm text-bad">{error}</p> : null}
        {isLoading ? (
          <LoadingSpinner label="Загрузка споров..." />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Gavel className="h-12 w-12 text-content-muted mx-auto mb-4" />}
            title="Споров нет"
            description="Открытые споры покупателей появятся здесь"
          />
        ) : (
          list.map((d) => (
            <div
              key={d.id}
              className="p-4 rounded-card border border-line bg-surface-raised space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">
                    Спор #{d.id.slice(0, 8)} · {d.targetType === "PURCHASE" ? "Покупка" : "Услуга"}
                  </p>
                  <p className="text-xs text-content-muted">
                    {new Date(d.createdAt).toLocaleString("ru-RU")}
                  </p>
                  <p className="text-sm text-content-secondary mt-1">{d.reason}</p>
                </div>
                <StatusBadge status={d.status} />
              </div>
              <div className="flex gap-2 flex-wrap">
                {DISPUTE_TRANSITIONS.filter(([t]) => t !== d.status).map(([t, label]) => (
                  <Button
                    key={t}
                    variant="outline"
                    size="sm"
                    disabled={transition.isPending}
                    onClick={() => transition.mutate({ id: d.id, status: t })}
                  >
                    {label}
                  </Button>
                ))}
                <Button variant="ghost" size="sm" onClick={() => setOpen(open === d.id ? null : d.id)}>
                  Переписка
                </Button>
              </div>
              {open === d.id ? <AdminDisputeMessages disputeId={d.id} /> : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function AdminDisputeMessages({ disputeId }: { disputeId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["dispute", disputeId],
    queryFn: () => fetchDispute(disputeId),
  });

  if (isLoading) return <LoadingSpinner label="Загрузка переписки..." className="py-6" />;
  if (!data) return <p className="text-sm text-bad">Не удалось загрузить переписку.</p>;

  return (
    <div className="p-3 rounded-md bg-surface">
      <MessageThread
        messageIdPrefix="dispute"
        messages={data.messages}
        sendFn={(body) => postDisputeMessage(disputeId, body)}
      />
    </div>
  );
}

// ---------- Versions (yank) ----------
function VersionsSection() {
  const [versionId, setVersionId] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const yank = useMutation({
    mutationFn: () => adminYankVersion(versionId.trim(), reason.trim() || "Отозвано админом"),
    onSuccess: () => {
      setResult("Версия отозвана (yank)");
      setError(null);
    },
    onError: (e) => {
      setResult(null);
      setError(getErrorMessage(e, "Не удалось отозвать версию"));
    },
  });

  const compat = useMutation({
    mutationFn: () => adminVersionCompatibility(versionId.trim()),
    onSuccess: (data) => {
      setResult(JSON.stringify(data, null, 2));
      setError(null);
    },
    onError: (e) => {
      setResult(null);
      setError(getErrorMessage(e, "Не удалось получить совместимость"));
    },
  });

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Ban className="h-5 w-5 text-bad" /> Отзыв версии (yank)
        </CardTitle>
        <CardDescription>Укажите ID версии и причину</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Input
          value={versionId}
          onChange={(e) => setVersionId(e.target.value)}
          placeholder="ID версии"
          aria-label="ID версии"
        />
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Причина отзыва"
          aria-label="Причина отзыва"
        />
        <div className="flex gap-2">
          <Button
            variant="danger"
            size="sm"
            disabled={!versionId.trim() || yank.isPending}
            onClick={() => yank.mutate()}
          >
            Отозвать версию
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!versionId.trim() || compat.isPending}
            onClick={() => compat.mutate()}
          >
            Проверить совместимость
          </Button>
        </div>
        {result ? (
          <pre className="text-xs bg-surface-raised border border-line p-3 rounded-md overflow-x-auto text-content-secondary">
            {result}
          </pre>
        ) : null}
        {error ? <p className="text-sm text-bad">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

// =====================================================================
// PLAN-005 Q/R: серверы, жалобы и модерация контента сообщества
// =====================================================================

// ---------- Server-domain chips (общие для новых секций) ----------
const LIFECYCLE_LABELS: Record<string, string> = {
  CREATED: "Создан",
  PENDING_VERIFICATION: "Ожидает проверки",
  VERIFIED: "Верифицирован",
  ACTIVE: "Активен",
  SUSPENDED: "Приостановлен",
  ARCHIVED: "Архивирован",
};

const REPORT_TARGET_LABELS: Record<string, string> = {
  THREAD: "Тема форума",
  POST: "Сообщение",
  REVIEW: "Отзыв",
  NEWS: "Новость",
  SERVER: "Сервер",
  PROFILE: "Профиль",
};

function AdminChip({
  tone = "muted",
  children,
}: {
  tone?: "ok" | "warn" | "bad" | "muted";
  children: React.ReactNode;
}) {
  const tones = {
    ok: "border-ok/30 bg-ok/10 text-ok",
    warn: "border-warn/30 bg-warn/10 text-warn",
    bad: "border-bad/30 bg-bad/10 text-bad",
    muted: "border-line bg-surface-hover text-content-muted",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function LifecycleChip({ lifecycle }: { lifecycle: string }) {
  const tone =
    lifecycle === "SUSPENDED"
      ? "bad"
      : lifecycle === "VERIFIED" || lifecycle === "ACTIVE"
        ? "ok"
        : lifecycle === "PENDING_VERIFICATION"
          ? "warn"
          : "muted";
  return <AdminChip tone={tone}>{LIFECYCLE_LABELS[lifecycle] ?? lifecycle}</AdminChip>;
}

function VerificationChip({ verification }: { verification: string }) {
  if (verification === "VERIFIED") return <AdminChip tone="ok">Проверен</AdminChip>;
  if (verification === "FAILED") return <AdminChip tone="bad">Проверка не пройдена</AdminChip>;
  if (verification === "PENDING") return <AdminChip tone="warn">Ожидает проверки</AdminChip>;
  return <AdminChip tone="muted">{verification}</AdminChip>;
}

function MonitoringChip({ state }: { state: string }) {
  return (
    <AdminChip tone={state === "ONLINE" ? "ok" : state === "OFFLINE" ? "bad" : "muted"}>
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          state === "ONLINE" ? "bg-ok" : state === "OFFLINE" ? "bg-bad" : "bg-line-strong"
        }`}
        aria-hidden
      />
      {state === "ONLINE" ? "Онлайн" : state === "OFFLINE" ? "Оффлайн" : "Нет данных"}
    </AdminChip>
  );
}

// ---------- Серверы (Q): список, проверка, верификация, жизненный цикл ----------
const SERVER_LIFECYCLE_FILTERS: [string, string][] = [
  ["all", "Все"],
  ["CREATED", "Создан"],
  ["PENDING_VERIFICATION", "Ожидает проверки"],
  ["VERIFIED", "Верифицирован"],
  ["ACTIVE", "Активен"],
  ["SUSPENDED", "Приостановлен"],
  ["ARCHIVED", "Архивирован"],
];

function AdminServersSection() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [lifecycle, setLifecycle] = useState("all");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [detailFor, setDetailFor] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-servers", lifecycle],
    queryFn: () => fetchAdminServers(lifecycle === "all" ? undefined : lifecycle),
  });

  const lifecycleMutation = useMutation({
    mutationFn: ({ id, next, reason }: { id: string; next: string; reason?: string }) =>
      adminServerLifecycle(id, next, reason),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin-servers"] });
      qc.invalidateQueries({ queryKey: ["admin-server-detail"] });
    },
    onError: (e) => setError(getErrorMessage(e, "Не удалось изменить состояние сервера")),
  });

  const verificationMutation = useMutation({
    mutationFn: ({ id, verification, note }: { id: string; verification: string; note?: string }) =>
      adminServerVerification(id, verification, note),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin-servers"] });
      qc.invalidateQueries({ queryKey: ["admin-server-detail"] });
    },
    onError: (e) => setError(getErrorMessage(e, "Не удалось изменить верификацию сервера")),
  });

  const list: AdminServerRow[] = data?.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="h-5 w-5 text-accent" /> Серверы
        </CardTitle>
        <CardDescription>Проверка верификации и модерация жизненного цикла</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-xs">
          <Select
            value={lifecycle}
            onChange={(e) => setLifecycle(e.target.value)}
            aria-label="Фильтр жизненного цикла сервера"
          >
            {SERVER_LIFECYCLE_FILTERS.map(([value, label]) => (
              <option key={value} value={value}>
                {value === "all" ? label : LIFECYCLE_LABELS[value] ?? value}
              </option>
            ))}
          </Select>
        </div>
        {error ? <p className="text-sm text-bad">{error}</p> : null}
        {isLoading ? (
          <LoadingSpinner label="Загрузка серверов..." />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Server className="h-12 w-12 text-content-muted mx-auto mb-4" />}
            title="Серверов нет"
            description="Зарегистрированные серверы появятся здесь"
          />
        ) : (
          list.map((s) => (
            <div
              key={s.id}
              className="p-4 rounded-card border border-line bg-surface-raised space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={`/servers/${s.slug}`}
                    className="font-medium hover:text-accent-strong"
                  >
                    {s.name}
                  </Link>
                  <p className="text-xs text-content-muted">
                    Владелец: {s.owner?.displayName || s.owner?.username || s.ownerId}
                  </p>
                  <p className="text-[11px] font-mono text-content-muted/70">{s.id}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <LifecycleChip lifecycle={s.lifecycle} />
                  <VerificationChip verification={s.verification} />
                  <MonitoringChip state={s.monitoring} />
                </div>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-content-secondary">
                <span>
                  Игроки:{" "}
                  {s.playerCount != null
                    ? `${s.playerCount}${s.maxPlayers != null ? `/${s.maxPlayers}` : ""}`
                    : "—"}
                </span>
                <span>Подписчиков: {s.followerCount ?? 0}</span>
                <span>Проверен: {s.verifiedAt ? formatDate(s.verifiedAt) : "—"}</span>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDetailFor(detailFor === s.id ? null : s.id)}
                >
                  {detailFor === s.id ? "Скрыть проверку" : "Проверить"}
                </Button>
              </div>
              <Input
                value={reasons[s.id] ?? ""}
                onChange={(e) => setReasons((m) => ({ ...m, [s.id]: e.target.value }))}
                placeholder="Причина / примечание (используется действиями ниже)"
                aria-label={`Причина для ${s.name}`}
              />
              <div className="flex gap-2 flex-wrap">
                <Button
                  size="sm"
                  disabled={verificationMutation.isPending}
                  onClick={() =>
                    verificationMutation.mutate({
                      id: s.id,
                      verification: "VERIFIED",
                      note: reasons[s.id] || undefined,
                    })
                  }
                >
                  Подтвердить верификацию
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={verificationMutation.isPending}
                  onClick={() =>
                    verificationMutation.mutate({
                      id: s.id,
                      verification: "FAILED",
                      note: reasons[s.id] || "Проверка не пройдена",
                    })
                  }
                >
                  Отклонить верификацию
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={lifecycleMutation.isPending}
                  onClick={() =>
                    lifecycleMutation.mutate({
                      id: s.id,
                      next: "SUSPENDED",
                      reason: reasons[s.id] || undefined,
                    })
                  }
                >
                  Приостановить
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={lifecycleMutation.isPending}
                  onClick={() => lifecycleMutation.mutate({ id: s.id, next: "VERIFIED" })}
                >
                  Восстановить
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={lifecycleMutation.isPending}
                  onClick={() =>
                    lifecycleMutation.mutate({
                      id: s.id,
                      next: "ARCHIVED",
                      reason: reasons[s.id] || undefined,
                    })
                  }
                >
                  Архивировать
                </Button>
              </div>
              <p className="text-xs text-content-muted">действие фиксируется в журнале аудита</p>
              {detailFor === s.id ? <AdminServerDetailPanel serverId={s.id} /> : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

// Раскрытая проверка сервера: приватные поля + владелец + счётчики + новости.
function AdminServerDetailPanel({ serverId }: { serverId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-server-detail", serverId],
    queryFn: () => fetchAdminServerDetail(serverId),
  });

  if (isLoading) return <LoadingSpinner label="Загрузка данных сервера..." className="py-6" />;
  if (error || !data)
    return (
      <p className="text-sm text-bad" role="alert">
        Не удалось загрузить данные сервера.
      </p>
    );

  const { server, owner, counts, recentNews } = data;

  return (
    <div className="rounded-card border border-line bg-surface p-4 space-y-4 text-sm">
      <div className="space-y-1 text-content-secondary">
        <p>
          <span className="text-content-muted">Email владельца:</span> {owner?.email ?? "—"}
        </p>
        <p>
          <span className="text-content-muted">Адрес:</span> {server.host ?? "—"}
          {server.port != null ? `:${server.port}` : ""}
        </p>
        <p>
          <span className="text-content-muted">Подписчики:</span> {counts.followers} ·{" "}
          <span className="text-content-muted">Отзывы:</span> {counts.reviews} ·{" "}
          <span className="text-content-muted">Ресурсы:</span> {counts.resources}
        </p>
        <p>
          <span className="text-content-muted">Приватность:</span>{" "}
          {server.showStats ? "статистика вкл" : "статистика выкл"} ·{" "}
          {server.showStaff ? "стафф вкл" : "стафф выкл"} ·{" "}
          {server.showResources ? "ресурсы вкл" : "ресурсы выкл"} ·{" "}
          {server.showCommunity ? "сообщество вкл" : "сообщество выкл"} ·{" "}
          {server.showTechStack ? "стек вкл" : "стек выкл"}
        </p>
        {server.verificationNote ? (
          <p>
            <span className="text-content-muted">Примечание проверки:</span>{" "}
            {server.verificationNote}
          </p>
        ) : null}
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-muted">
          Последние новости
        </p>
        {recentNews.length === 0 ? (
          <p className="text-xs text-content-muted">Новостей нет.</p>
        ) : (
          <ul className="space-y-1.5">
            {recentNews.map((n) => (
              <li
                key={n.id}
                className="flex flex-wrap items-center gap-2 text-xs text-content-secondary"
              >
                <span className="font-medium text-content">{n.title}</span>
                <StatusBadge status={n.status} />
                {n.publishedAt ? <span>{formatDate(n.publishedAt)}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------- Жалобы (R) ----------
function ReportsSection() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("OPEN");
  const [resolutions, setResolutions] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["admin-reports", status],
    queryFn: () => fetchAdminReports(status),
  });

  const resolve = useMutation({
    mutationFn: ({
      id,
      decision,
      resolution,
    }: {
      id: string;
      decision: "RESOLVED" | "DISMISSED";
      resolution?: string;
    }) => adminResolveReport(id, decision, resolution),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin-reports"] });
    },
    onError: (e) => setError(getErrorMessage(e, "Не удалось обработать жалобу")),
  });

  const list: AdminReport[] = data?.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Flag className="h-5 w-5 text-accent" /> Жалобы
        </CardTitle>
        <CardDescription>Очередь обращений пользователей</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-xs">
          <Select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Статус жалоб"
          >
            <option value="OPEN">Открытые</option>
            <option value="RESOLVED">Меры приняты</option>
            <option value="DISMISSED">Отклонённые</option>
            <option value="ALL">Все</option>
          </Select>
        </div>
        {error ? <p className="text-sm text-bad">{error}</p> : null}
        {isLoading ? (
          <LoadingSpinner label="Загрузка жалоб..." />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Flag className="h-12 w-12 text-content-muted mx-auto mb-4" />}
            title="Жалоб нет"
            description="Новые обращения пользователей появятся здесь"
          />
        ) : (
          list.map((r) => (
            <div
              key={r.id}
              className="p-4 rounded-card border border-line bg-surface-raised space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <AdminChip tone="muted">
                      {REPORT_TARGET_LABELS[r.targetType] ?? r.targetType}
                    </AdminChip>
                    <span className="text-xs text-content-muted">
                      Статус:{" "}
                      {r.status === "OPEN"
                        ? "открыта"
                        : r.status === "RESOLVED"
                          ? "меры приняты"
                          : "отклонена"}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-xs text-content-muted">{r.targetId}</p>
                  <p className="mt-1 text-sm text-content-secondary">{r.reason}</p>
                  <p className="mt-1 text-xs text-content-muted">
                    Автор: {r.reporter?.displayName || r.reporter?.username || "—"} ·{" "}
                    {formatDate(r.createdAt)}
                  </p>
                  {r.resolution ? (
                    <p className="mt-1 text-xs text-content-secondary">Решение: {r.resolution}</p>
                  ) : null}
                </div>
              </div>
              {r.status === "OPEN" ? (
                <>
                  <Textarea
                    value={resolutions[r.id] ?? ""}
                    onChange={(e) => setResolutions((m) => ({ ...m, [r.id]: e.target.value }))}
                    placeholder="Решение (необязательно)"
                    aria-label={`Решение по жалобе ${r.id}`}
                    rows={2}
                  />
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      size="sm"
                      disabled={resolve.isPending}
                      onClick={() =>
                        resolve.mutate({
                          id: r.id,
                          decision: "RESOLVED",
                          resolution: resolutions[r.id] || undefined,
                        })
                      }
                    >
                      Меры приняты
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={resolve.isPending}
                      onClick={() =>
                        resolve.mutate({
                          id: r.id,
                          decision: "DISMISSED",
                          resolution: resolutions[r.id] || undefined,
                        })
                      }
                    >
                      Отклонить
                    </Button>
                  </div>
                </>
              ) : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Контент сообщества: отзывы / темы / новости (утилитарно) ----------
function CommunityModerationSection() {
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const [reviewId, setReviewId] = useState("");
  const [reviewReason, setReviewReason] = useState("");
  const [threadId, setThreadId] = useState("");
  const [threadState, setThreadState] = useState("LOCKED");
  const [threadPinned, setThreadPinned] = useState(false);
  const [newsId, setNewsId] = useState("");
  const [newsReason, setNewsReason] = useState("");

  const reviewModeration = useMutation({
    mutationFn: ({ status }: { status: "VISIBLE" | "HIDDEN" }) =>
      adminModerateServerReview(reviewId.trim(), status, reviewReason.trim() || undefined),
    onSuccess: () => {
      setError(null);
      setResult(`Отзыв ${reviewId.trim()} обновлён`);
    },
    onError: (e) => {
      setResult(null);
      setError(getErrorMessage(e, "Не удалось изменить отзыв"));
    },
  });

  const threadModeration = useMutation({
    mutationFn: () =>
      adminModerateThread(threadId.trim(), threadState, threadPinned ? true : undefined),
    onSuccess: () => {
      setError(null);
      setResult(`Тема ${threadId.trim()} обновлена`);
    },
    onError: (e) => {
      setResult(null);
      setError(getErrorMessage(e, "Не удалось изменить тему"));
    },
  });

  const newsModeration = useMutation({
    mutationFn: ({ status }: { status: "DRAFT" | "PUBLISHED" }) =>
      adminModerateNews(newsId.trim(), status, newsReason.trim() || undefined),
    onSuccess: () => {
      setError(null);
      setResult(`Новость ${newsId.trim()} обновлена`);
    },
    onError: (e) => {
      setResult(null);
      setError(getErrorMessage(e, "Не удалось изменить новость"));
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-accent" /> Контент сообщества
        </CardTitle>
        <CardDescription>Модерация отзывов, тем форума и новостей серверов</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error ? <p className="text-sm text-bad">{error}</p> : null}
        {result ? <p className="text-sm text-ok">{result}</p> : null}

        {/* Скрытие отзывов о серверах */}
        <div className="p-4 rounded-card border border-line bg-surface-raised space-y-3">
          <p className="text-sm font-semibold">Отзыв: скрыть / вернуть</p>
          <Input
            value={reviewId}
            onChange={(e) => setReviewId(e.target.value)}
            placeholder="ID отзыва"
            aria-label="ID отзыва"
          />
          <Input
            value={reviewReason}
            onChange={(e) => setReviewReason(e.target.value)}
            placeholder="Причина (для скрытия)"
            aria-label="Причина скрытия отзыва"
          />
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="danger"
              size="sm"
              disabled={!reviewId.trim() || reviewModeration.isPending}
              onClick={() => reviewModeration.mutate({ status: "HIDDEN" })}
            >
              Скрыть отзыв
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!reviewId.trim() || reviewModeration.isPending}
              onClick={() => reviewModeration.mutate({ status: "VISIBLE" })}
            >
              Вернуть отзыв
            </Button>
          </div>
        </div>

        {/* Состояние и закрепление темы */}
        <div className="p-4 rounded-card border border-line bg-surface-raised space-y-3">
          <p className="text-sm font-semibold">Тема форума: состояние / закрепление</p>
          <Input
            value={threadId}
            onChange={(e) => setThreadId(e.target.value)}
            placeholder="ID темы"
            aria-label="ID темы"
          />
          <div className="max-w-xs">
            <Select
              value={threadState}
              onChange={(e) => setThreadState(e.target.value)}
              aria-label="Состояние темы"
            >
              <option value="OPEN">Открыта</option>
              <option value="LOCKED">Закрыта</option>
              <option value="ARCHIVED">В архиве</option>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm text-content-secondary">
            <input
              type="checkbox"
              checked={threadPinned}
              onChange={(e) => setThreadPinned(e.target.checked)}
              className="h-4 w-4"
            />
            Закрепить тему
          </label>
          <Button
            size="sm"
            disabled={!threadId.trim() || threadModeration.isPending}
            onClick={() => threadModeration.mutate()}
          >
            Применить к теме
          </Button>
        </div>

        {/* Снятие / публикация новости сервера */}
        <div className="p-4 rounded-card border border-line bg-surface-raised space-y-3">
          <p className="text-sm font-semibold">Новость сервера: снять / опубликовать</p>
          <Input
            value={newsId}
            onChange={(e) => setNewsId(e.target.value)}
            placeholder="ID новости"
            aria-label="ID новости"
          />
          <Input
            value={newsReason}
            onChange={(e) => setNewsReason(e.target.value)}
            placeholder="Причина (для снятия)"
            aria-label="Причина снятия новости"
          />
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="danger"
              size="sm"
              disabled={!newsId.trim() || newsModeration.isPending}
              onClick={() => newsModeration.mutate({ status: "DRAFT" })}
            >
              Снять с публикации
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!newsId.trim() || newsModeration.isPending}
              onClick={() => newsModeration.mutate({ status: "PUBLISHED" })}
            >
              Опубликовать
            </Button>
          </div>
        </div>

        <p className="text-xs text-content-muted">действие фиксируется в журнале аудита</p>
      </CardContent>
    </Card>
  );
}


// ---------- PLAN-007 D: статьи — очередь модерации ----------
function ArticlesModerationSection() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("PENDING_REVIEW");
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["admin-articles", status],
    queryFn: () => fetchAdminArticles(status),
  });

  const act = useMutation({
    mutationFn: ({ id, action, reason }: { id: string; action: "approve" | "reject" | "hide"; reason?: string }) =>
      adminArticleAction(id, action, reason),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin-articles"] });
    },
    onError: (e) => setError(getErrorMessage(e, "Не удалось обработать статью")),
  });

  const list: AdminArticle[] = data?.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-accent" /> Статьи
        </CardTitle>
        <CardDescription>Модерация контента авторов (PLAN-007)</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-xs">
          <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Статус статей">
            <option value="PENDING_REVIEW">На модерации</option>
            <option value="PUBLISHED">Опубликованные</option>
            <option value="ARCHIVED">Скрытые</option>
            <option value="DRAFT">Черновики</option>
            <option value="ALL">Все</option>
          </Select>
        </div>
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
        {isLoading ? (
          <LoadingSpinner label="Загрузка…" />
        ) : list.length === 0 ? (
          <EmptyState title="Нет статей в этом статусе" />
        ) : (
          <div className="space-y-3">
            {list.map((a) => (
              <div key={a.id} className="rounded-card border border-line bg-surface-raised p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{a.title}</p>
                    <p className="mt-0.5 truncate text-xs text-content-secondary">{a.excerpt}</p>
                    <p className="mt-1 text-xs text-content-muted">
                      {a.author?.displayName || a.author?.username || "Автор"} · {a.status}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
                    {a.status === "PENDING_REVIEW" ? (
                      <>
                        <Button size="sm" disabled={act.isPending} onClick={() => act.mutate({ id: a.id, action: "approve" })}>
                          Опубликовать
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={act.isPending}
                          onClick={() => act.mutate({ id: a.id, action: "reject", reason: reasons[a.id] })}
                        >
                          Вернуть
                        </Button>
                      </>
                    ) : null}
                    {a.status === "PUBLISHED" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={act.isPending}
                        onClick={() => act.mutate({ id: a.id, action: "hide", reason: reasons[a.id] })}
                      >
                        Скрыть
                      </Button>
                    ) : null}
                  </div>
                </div>
                {a.status === "PENDING_REVIEW" || a.status === "PUBLISHED" ? (
                  <input
                    value={reasons[a.id] ?? ""}
                    onChange={(e) => setReasons((r) => ({ ...r, [a.id]: e.target.value }))}
                    placeholder={a.status === "PENDING_REVIEW" ? "Причина возврата (для «Вернуть»)" : "Причина скрытия"}
                    className="mt-3 w-full rounded-card border border-line bg-background px-3 py-2 text-sm"
                    aria-label="Причина"
                  />
                ) : null}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
