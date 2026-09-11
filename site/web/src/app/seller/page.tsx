// Seller Studio (PLAN-002 H-001..H-006): «Мой магазин» — дашборд, управление
// ресурсами с наглядными состояниями, услуги и заказы.
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/auth";
import api, { bootstrapSession } from "@/lib/api";
import {
  fetchSellerProfile,
  applySeller,
  fetchMyServices,
  createService,
  setResourceStatus,
  fetchMyPurchases,
  fetchMyServiceOrders,
  serviceOrderAction,
  formatRub,
  getErrorMessage,
  type ServiceOrder,
  type Resource,
  type Purchase,
  fetchSellerAnalytics,
  type SellerAnalytics,
} from "@/lib/api-ext";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { StatusBadge, statusLabel } from "@/components/ui/StatusBadge";
import { LoadingSpinner, EmptyState, ErrorState } from "@/components/ui/States";
import { MediaEditorButton } from "@/components/seller/MediaEditorButton";
import { Store, Package, Wrench, Plus, Wallet, Clock, Send, FileEdit,
  BarChart3,
} from "lucide-react";
import Link from "next/link";
import { typeLabel, formatDate } from "@/lib/domain";

export default function SellerPage() {
  const router = useRouter();
  const { accessToken, isAuthenticated } = useAuthStore();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // accessToken уже в памяти после логина — не делаем лишний /auth/refresh
      if (isAuthenticated()) return;
      const ok = await bootstrapSession();
      if (!cancelled && !ok) router.push("/auth/login");
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const {
    data: profile,
    isLoading: profileLoading,
    error: profileError,
    refetch: refetchProfile,
  } = useQuery({
    queryKey: ["seller-profile"],
    queryFn: fetchSellerProfile,
    enabled: accessToken !== null,
    retry: false,
  });

  if (!isAuthenticated()) return null;

  if (profileLoading) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-12">
        <LoadingSpinner label="Загрузка магазина..." />
      </div>
    );
  }

  if (profileError) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-12">
        <ErrorState error={profileError} onRetry={() => refetchProfile()} />
      </div>
    );
  }

  const status = profile?.status;

  // No profile or rejected -> allow applying (re-applying).
  if (!profile || status === "REJECTED") {
    return <ApplyForm rejected={status === "REJECTED"} />;
  }

  if (status === "PENDING") {
    return (
      <Notice
        title="Заявка на рассмотрении"
        text="Ваша заявка на статус продавца отправлена. Ожидайте решения модерации — обычно это занимает немного времени."
        badge="PENDING"
      />
    );
  }

  if (status !== "APPROVED") {
    return (
      <Notice
        title={`Статус продавца: ${statusLabel(status ?? "")}`}
        text="В настоящее время вы не можете публиковать ресурсы и услуги."
        badge={status}
      />
    );
  }

  return <SellerDashboard />;
}

// ---------- Apply form ----------
function ApplyForm({ rejected }: { rejected?: boolean }) {
  const [displayName, setDisplayName] = useState("");
  const [supportInfo, setSupportInfo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      applySeller({
        ...(displayName.trim() ? { displayName } : {}),
        ...(supportInfo.trim() ? { supportInfo } : {}),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["seller-profile"] }),
    onError: (e) => setError(getErrorMessage(e, "Не удалось отправить заявку")),
  });

  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Store className="h-6 w-6 text-accent" /> Стать продавцом
          </CardTitle>
          <CardDescription>
            {rejected
              ? "Ваша предыдущая заявка была отклонена. Вы можете подать новую."
              : "Откройте свой магазин: публикуйте ресурсы и услуги для игроков MTA:SA."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label htmlFor="seller-name" className="text-sm text-content-secondary">
              Название магазина
            </label>
            <Input
              id="seller-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Например: CoolScripts"
              className="mt-1"
            />
          </div>
          <div>
            <label htmlFor="seller-support" className="text-sm text-content-secondary">
              Контакт / поддержка (Discord, сайт...)
            </label>
            <Input
              id="seller-support"
              value={supportInfo}
              onChange={(e) => setSupportInfo(e.target.value)}
              placeholder="discord.gg/..."
              className="mt-1"
            />
          </div>
          {error ? <p className="text-sm text-bad">{error}</p> : null}
          <Button disabled={mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "Отправка..." : "Отправить заявку"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- Status notices ----------
function Notice({ title, text, badge }: { title: string; text: string; badge?: string }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Store className="h-6 w-6 text-accent" /> {title}
            </span>
            {badge ? <StatusBadge status={badge} /> : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-content-secondary">{text}</p>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- Approved seller dashboard (H-002) ----------
function SellerDashboard() {
  const { user } = useAuthStore();

  const { data: myResources } = useQuery({
    queryKey: ["seller-resources"],
    queryFn: async () => {
      const { data } = await api.get<{ data: Resource[] }>("/resources/my");
      return data.data;
    },
  });

  const { data: myServices } = useQuery({
    queryKey: ["seller-services"],
    queryFn: fetchMyServices,
  });

  const { data: purchases } = useQuery({
    queryKey: ["purchases", "my", "seller"],
    queryFn: fetchMyPurchases,
  });

  const soldCount = ((purchases as Purchase[] | undefined) ?? []).filter(
    (p) => p.status === "COMPLETED"
  ).length;

  const resources = myResources ?? [];
  const published = resources.filter((r) => r.status === "PUBLISHED").length;
  const pending = resources.filter(
    (r) => r.status === "PENDING_REVIEW" || r.status === "UNDER_REVIEW"
  ).length;
  const drafts = resources.filter((r) => r.status === "DRAFT").length;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Store className="h-7 w-7 text-accent" /> Мой магазин
          </h1>
          <p className="mt-1 text-content-secondary">
            <span className="sr-only">Кабинет продавца — </span>
            {user?.displayName || user?.username}
          </p>
        </div>
        <Link href="/seller/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" /> Новый ресурс
          </Button>
        </Link>
      </div>

      <SellerAnalyticsCard />

      {/* H-002: dashboard stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-10">
        <Stat icon={Package} label="Ресурсов" value={resources.length} />
        <Stat icon={Send} label="Опубликованных" value={published} />
        <Stat icon={Clock} label="На модерации" value={pending} />
        <Stat icon={FileEdit} label="Черновиков" value={drafts} />
        <Stat icon={Wallet} label="Продано копий" value={soldCount} />
      </div>

      <div className="space-y-8">
        <MyResourcesSection />
        <MyServicesSection />
        <SellerOrdersSection />
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <Icon className="h-4 w-4 text-content-muted mb-2" />
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs text-content-secondary">{label}</p>
      </CardContent>
    </Card>
  );
}

// ---------- My resources (H-003) ----------
function MyResourcesSection() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const {
    data: myResources,
    isLoading,
    error: loadError,
    refetch,
  } = useQuery({
    queryKey: ["seller-resources"],
    queryFn: async () => {
      const { data } = await api.get<{ data: Resource[] }>("/resources/my");
      return data.data;
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ slug, status }: { slug: string; status: string }) =>
      setResourceStatus(slug, status),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["seller-resources"] });
    },
    onError: (e) => setError(getErrorMessage(e, "Не удалось сменить статус")),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Package className="h-5 w-5 text-accent" /> Мои ресурсы
        </CardTitle>
        <CardDescription>
          Черновики, отправка на модерацию и статусы публикации
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error ? <p className="text-sm text-bad">{error}</p> : null}

        {isLoading ? (
          <LoadingSpinner label="Загрузка ресурсов..." />
        ) : loadError ? (
          <ErrorState error={loadError} onRetry={() => refetch()} />
        ) : (
          <div className="space-y-3">
            {(myResources ?? []).map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-start justify-between gap-3 p-4 rounded-card border border-line bg-surface-raised"
              >
                <div>
                  <p className="font-medium">
                    {r.title}
                    {r.status === "PUBLISHED" ? (
                      <Link
                        href={`/resources/${r.slug}`}
                        className="ml-2 text-xs text-accent-strong hover:underline"
                      >
                        открыть страницу →
                      </Link>
                    ) : null}
                  </p>
                  <p className="text-sm text-content-secondary">
                    {typeLabel(r.type)} · {r.price === 0 ? "Бесплатно" : formatRub(r.price)} ·
                    создан {formatDate(r.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <StatusBadge status={r.status} />
                  {/* B-006: медиа можно менять до публикации */}
                  {r.status === "DRAFT" || r.status === "PENDING_REVIEW" ? (
                    <MediaEditorButton resource={r} />
                  ) : null}
                  {r.status === "DRAFT" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        statusMutation.mutate({ slug: r.slug, status: "PENDING_REVIEW" })
                      }
                      disabled={statusMutation.isPending}
                    >
                      <Send className="mr-1.5 h-3.5 w-3.5" />
                      На модерацию
                    </Button>
                  ) : r.status === "PENDING_REVIEW" || r.status === "PUBLISHED" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => statusMutation.mutate({ slug: r.slug, status: "DRAFT" })}
                      disabled={statusMutation.isPending}
                    >
                      В черновик
                    </Button>
                  ) : null}
                </div>
              </div>
            ))}
            {myResources && myResources.length === 0 ? (
              <EmptyState
                icon={<Package className="h-12 w-12 text-content-muted mx-auto mb-4" />}
                title="У вас пока нет ресурсов"
                description="Создайте первый ресурс через мастер — он проведёт вас от описания до публикации"
                action={
                  <Link href="/seller/new">
                    <Button variant="primary" size="sm">
                      <Plus className="mr-1.5 h-4 w-4" /> Создать ресурс
                    </Button>
                  </Link>
                }
              />
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- My services ----------
function MyServicesSection() {
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState("CUSTOM_DEVELOPMENT");
  const [priceRub, setPriceRub] = useState("");
  const [deliveryDays, setDeliveryDays] = useState("3");
  const [requirements, setRequirements] = useState("");
  const [error, setError] = useState<string | null>(null);

  const {
    data: myServices,
    isLoading: servicesLoading,
    error: servicesError,
    refetch: refetchServices,
  } = useQuery({
    queryKey: ["seller-services"],
    queryFn: fetchMyServices,
  });

  const mutation = useMutation({
    mutationFn: () =>
      createService({
        title,
        description,
        type,
        price: Math.round(parseFloat(priceRub.replace(",", ".") || "0") * 100),
        deliveryDays: parseInt(deliveryDays || "1", 10),
        requirements: requirements.trim() || undefined,
      }),
    onSuccess: () => {
      setTitle("");
      setDescription("");
      setPriceRub("");
      setRequirements("");
      setError(null);
      qc.invalidateQueries({ queryKey: ["seller-services"] });
    },
    onError: (e) => setError(getErrorMessage(e, "Не удалось создать услугу")),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wrench className="h-5 w-5 text-accent" /> Мои услуги
        </CardTitle>
        <CardDescription>Услуги с фиксированным сроком выполнения</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="p-4 rounded-card border border-line bg-surface-raised space-y-3">
          <p className="text-sm font-medium">Новая услуга</p>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Название" aria-label="Название услуги" />
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Описание: что входит в услугу"
            aria-label="Описание услуги"
          />
          <div className="grid md:grid-cols-4 gap-3">
            <Select value={type} onChange={(e) => setType(e.target.value)} aria-label="Тип услуги">
              <option value="CUSTOM_DEVELOPMENT">Разработка</option>
              <option value="CONFIGURATION">Настройка сервера</option>
              <option value="SUPPORT">Поддержка</option>
              <option value="CONSULTATION">Консультация</option>
              <option value="OTHER">Другое</option>
            </Select>
            <Input
              value={priceRub}
              onChange={(e) => setPriceRub(e.target.value)}
              placeholder="Цена, ₽"
              type="number"
              min={0}
              aria-label="Цена, ₽"
            />
            <Input
              value={deliveryDays}
              onChange={(e) => setDeliveryDays(e.target.value)}
              placeholder="Дней на выполнение"
              type="number"
              min={1}
              aria-label="Дней на выполнение"
            />
            <Input
              value={requirements}
              onChange={(e) => setRequirements(e.target.value)}
              placeholder="Требования к заказчику"
              aria-label="Требования к заказчику"
            />
          </div>
          <Button
            size="sm"
            disabled={!title.trim() || !description.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Создать услугу
          </Button>
          {error ? <p className="text-sm text-bad">{error}</p> : null}
        </div>

        {servicesLoading ? (
          <LoadingSpinner label="Загрузка услуг..." />
        ) : servicesError ? (
          <ErrorState error={servicesError} onRetry={() => refetchServices()} />
        ) : (
          <div className="space-y-3">
            {(myServices ?? []).map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-start justify-between gap-3 p-4 rounded-card border border-line bg-surface-raised"
              >
                <div>
                  <p className="font-medium">{s.title}</p>
                  <p className="text-sm text-content-secondary">
                    {formatRub(s.price)} · {s.deliveryDays} дн. · /{s.slug}
                  </p>
                </div>
              </div>
            ))}
            {myServices && myServices.length === 0 ? (
              <EmptyState title="У вас пока нет услуг" description="Добавьте первую услугу" />
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Service orders for my services (seller side) ----------
const ORDER_STEPS = ["PENDING", "IN_PROGRESS", "DELIVERED", "ACCEPTED", "CLOSED"];

function SellerOrdersSection() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, error: loadError, refetch } = useQuery({
    queryKey: ["seller-service-orders"],
    queryFn: fetchMyServiceOrders,
  });

  const action = useMutation({
    mutationFn: ({ id, act, body }: { id: string; act: string; body?: Record<string, unknown> }) =>
      serviceOrderAction(id, act, body),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["seller-service-orders"] });
    },
    onError: (e) => setError(getErrorMessage(e, "Действие не выполнено")),
  });

  const orders: ServiceOrder[] = data?.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Заказы на мои услуги</CardTitle>
        <CardDescription>Доставка и закрытие заказов</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <p className="text-sm text-bad">{error}</p> : null}
        {isLoading ? (
          <LoadingSpinner label="Загрузка заказов..." />
        ) : loadError ? (
          <ErrorState error={loadError} onRetry={() => refetch()} />
        ) : orders.length === 0 ? (
          <EmptyState
            title="Заказов пока нет"
            description="Заказы на ваши услуги появятся здесь"
          />
        ) : (
          orders.map((o) => (
            <div
              key={o.id}
              className="p-4 rounded-card border border-line bg-surface-raised space-y-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{o.service.title}</p>
                  <p className="text-sm text-content-secondary">
                    {formatRub(o.finalPrice)} · {formatDate(o.createdAt)} · #
                    {o.id.slice(0, 8)}
                  </p>
                  {o.buyerNotes ? (
                    <p className="text-sm text-content-secondary mt-1">
                      Заметки покупателя: {o.buyerNotes}
                    </p>
                  ) : null}
                </div>
                <StatusBadge status={o.status} />
              </div>

              {/* Status timeline */}
              <div className="flex items-center gap-1 text-xs flex-wrap">
                {ORDER_STEPS.map((step, i) => {
                  const idx = ORDER_STEPS.indexOf(o.status);
                  const reached = idx >= 0 && i <= idx;
                  return (
                    <span
                      key={step}
                      className={`px-2 py-1 rounded ${
                        reached
                          ? "bg-accent-soft text-accent-strong"
                          : "bg-surface text-content-muted"
                      }`}
                    >
                      {statusLabel(step)}
                    </span>
                  );
                })}
              </div>

              <div className="flex gap-2 flex-wrap">
                {o.status === "PENDING" || o.status === "IN_PROGRESS" ? (
                  <Button
                    size="sm"
                    disabled={action.isPending}
                    onClick={() => action.mutate({ id: o.id, act: "deliver", body: { notes: "Выполнено" } })}
                  >
                    Доставить
                  </Button>
                ) : null}
                {o.status === "ACCEPTED" || o.status === "DELIVERED" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={action.isPending}
                    onClick={() => action.mutate({ id: o.id, act: "close" })}
                  >
                    Закрыть
                  </Button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}


// ---------- PLAN-010: Аналитика (30 дней) — честный сигнал спроса ----------
function SellerAnalyticsCard() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["seller", "analytics"],
    queryFn: fetchSellerAnalytics,
  });

  return (
    <Card className="mt-8">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-accent" /> Аналитика
        </CardTitle>
        <CardDescription>
          Просмотры страниц ресурсов и конверсия в покупки за{" "}
          {data?.days ?? 30} дней. Только ваши данные; просмотры считаются по
          открытиям страниц и не показываются покупателям.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <LoadingSpinner label="Загрузка аналитики…" />
        ) : error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : !data || data.byResource.length === 0 ? (
          <EmptyState
            title="Пока нечего анализировать"
            description="Опубликуйте ресурс — здесь появятся просмотры и конверсия."
          />
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-center sm:grid-cols-3">
              <div className="rounded-card border border-line bg-surface-raised p-4">
                <p className="text-xs text-content-secondary">Просмотры (30 дней)</p>
                <p className="mt-1 text-2xl font-bold">
                  {data.totalViews.toLocaleString("ru-RU")}
                </p>
              </div>
              <div className="rounded-card border border-line bg-surface-raised p-4">
                <p className="text-xs text-content-secondary">Покупки (30 дней)</p>
                <p className="mt-1 text-2xl font-bold">
                  {data.totalPurchases.toLocaleString("ru-RU")}
                </p>
              </div>
              <div className="rounded-card border border-line bg-surface-raised p-4">
                <p className="text-xs text-content-secondary">Средняя конверсия</p>
                <p className="mt-1 text-2xl font-bold">
                  {data.totalViews > 0
                    ? `${Math.round((data.totalPurchases / data.totalViews) * 100)}%`
                    : "—"}
                </p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-content-secondary">
                    <th className="py-2 pr-3">Ресурс</th>
                    <th className="py-2 pr-3 text-right">Просмотры</th>
                    <th className="py-2 pr-3 text-right">Покупки</th>
                    <th className="py-2 text-right">Конверсия</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byResource.map((r) => (
                    <tr key={r.resourceId} className="border-t border-line">
                      <td className="py-2 pr-3">
                        <Link href={`/resources/${r.slug}`} className="hover:text-accent-strong">
                          {r.title}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 text-right">{r.views30d}</td>
                      <td className="py-2 pr-3 text-right">{r.purchases30d}</td>
                      <td className="py-2 text-right">
                        {r.conversionPct == null ? "—" : `${r.conversionPct}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
