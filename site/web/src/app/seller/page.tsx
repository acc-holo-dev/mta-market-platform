// Seller Studio (PLAN-002 H-001..H-006): «Мой магазин» — дашборд, управление
// ресурсами с наглядными состояниями, услуги и заказы.
"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
} from "@/lib/api-ext";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { StatusBadge, statusLabel } from "@/components/ui/StatusBadge";
import { LoadingSpinner, EmptyState, ErrorState } from "@/components/ui/States";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MediaEditorButton } from "@/components/seller/MediaEditorButton";
import { useFocusTrap, rememberTrigger, restoreTrigger } from "@/components/ui/focusTrap";
import { Store, Package, Wrench, Plus, Wallet, Clock, Send, FileEdit,
  BarChart3, CreditCard, Crown, History, Landmark,
} from "lucide-react";
import Link from "next/link";
import { typeLabel, formatDate } from "@/lib/domain";
import { myPurchasesKey, sellerProfileKey } from "@/lib/queries";
import {
  fetchPayoutBalance,
  fetchMyPayouts,
  requestPayout,
  fetchMyTransactions,
  fetchSubscriptionPlans,
  fetchMySubscriptions,
  createSubscription,
  cancelSubscription,
  resumeSubscription,
  setSubscriptionAutoRenew,
  apiErrorCode,
  type Payout,
  type MyTransactions,
  type TransactionPayment,
  type TransactionRefund,
  type TransactionPurchase,
  type SubscriptionPlan,
  type Subscription,
} from "@/lib/api/finance";

export default function SellerPage() {
  return (
    <Suspense fallback={<div className="w-full px-4 py-12"><LoadingSpinner label="Загрузка кабинета..." /></div>}>
      <SellerPageInner />
    </Suspense>
  );
}

function SellerPageInner() {
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
    queryKey: sellerProfileKey(),
    queryFn: fetchSellerProfile,
    enabled: accessToken !== null,
    retry: false,
  });

  if (!isAuthenticated()) return null;

  if (profileLoading) {
    return (
      <div className="w-full px-4 py-8 sm:px-6">
        <LoadingSpinner label="Загрузка магазина..." />
      </div>
    );
  }

  if (profileError) {
    return (
      <div className="w-full px-4 py-8 sm:px-6">
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
    onSuccess: () => qc.invalidateQueries({ queryKey: sellerProfileKey() }),
    onError: (e) => setError(getErrorMessage(e, "Не удалось отправить заявку")),
  });

  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <Card className="shadow-card">
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
          <div className="space-y-1.5">
            <label
              htmlFor="seller-name"
              className="block text-xs font-semibold uppercase tracking-wide text-content-secondary"
            >
              Название магазина
            </label>
            <Input
              id="seller-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Например: CoolScripts"
            />
          </div>
          <div className="space-y-1.5">
            <label
              htmlFor="seller-support"
              className="block text-xs font-semibold uppercase tracking-wide text-content-secondary"
            >
              Контакт / поддержка (Discord, сайт...)
            </label>
            <Input
              id="seller-support"
              value={supportInfo}
              onChange={(e) => setSupportInfo(e.target.value)}
              placeholder="discord.gg/..."
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
  const searchParams = useSearchParams();
  // PLAN-015 §35: вкладки Creator Studio; ?tab= синхронизирован с сайдбаром.
  const tab = searchParams.get("tab") ?? "overview";

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
    queryKey: myPurchasesKey("seller"),
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

  const tabs: [string, string][] = [
    ["overview", "Обзор"],
    ["resources", "Ресурсы"],
    ["services", "Услуги"],
    ["orders", "Заказы"],
    ["analytics", "Аналитика"],
    ["finance", "Финансы"],
  ];

  return (
    <div className="w-full px-4 py-8 sm:px-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Store className="h-7 w-7 text-accent" /> Кабинет продавца
          </h1>
          <p className="mt-1 text-content-secondary">
            <span className="sr-only">Продавец: </span>
            {user?.displayName || user?.username}
          </p>
        </div>
        {/* PLAN-015 §35: первичное действие студии — Publish */}
        <Link href="/seller/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" /> Опубликовать
          </Button>
        </Link>
      </div>

      {/* Вкладки студии (§35) */}
      <div
        role="group"
        aria-label="Разделы кабинета"
        className="mb-8 flex flex-wrap gap-1 rounded-md border border-line p-1 w-fit"
      >
        {tabs.map(([value, label]) => (
          <Link
            key={value}
            href={`/seller?tab=${value}`}
            aria-pressed={tab === value}
            className={`rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors duration-fast ${
              tab === value
                ? "bg-accent text-on-accent"
                : "text-content-secondary hover:bg-surface-hover hover:text-content"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      {tab === "overview" ? (
        <>
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
        </>
      ) : null}

      {tab === "resources" ? <MyResourcesSection /> : null}
      {tab === "services" ? <MyServicesSection /> : null}
      {tab === "orders" ? <SellerOrdersSection /> : null}
      {tab === "analytics" ? (
        <>
          <SellerAnalyticsCard />
          <div className="mt-6 grid grid-cols-2 md:grid-cols-5 gap-4">
            <Stat icon={Package} label="Ресурсов" value={resources.length} />
            <Stat icon={Wallet} label="Продано копий" value={soldCount} />
          </div>
        </>
      ) : null}

      {/* PLAN-018 A-007: Финансы — баланс, выплаты, история операций, Premium */}
      {tab === "finance" ? <SellerFinanceSection /> : null}
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
    <Card className="shadow-card">
      <CardContent className="pt-6">
        <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-md bg-accent-soft">
          <Icon className="h-4 w-4 text-accent-strong" />
        </span>
        <p className="text-2xl font-bold tabular-nums">{value}</p>
        <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-content-muted">
          {label}
        </p>
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
                      className={`rounded-pill px-2.5 py-1 text-xs font-medium ${
                        reached
                          ? "bg-accent-soft text-accent-strong"
                          : "bg-surface-inset text-content-muted"
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
              <div className="rounded-card border border-line bg-surface-raised p-4 shadow-card">
                <p className="text-xs font-semibold uppercase tracking-wide text-content-muted">
                  Просмотры (30 дней)
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums">
                  {data.totalViews.toLocaleString("ru-RU")}
                </p>
              </div>
              <div className="rounded-card border border-line bg-surface-raised p-4 shadow-card">
                <p className="text-xs font-semibold uppercase tracking-wide text-content-muted">
                  Покупки (30 дней)
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums">
                  {data.totalPurchases.toLocaleString("ru-RU")}
                </p>
              </div>
              <div className="rounded-card border border-line bg-surface-raised p-4 shadow-card">
                <p className="text-xs font-semibold uppercase tracking-wide text-content-muted">
                  Средняя конверсия
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums">
                  {data.totalViews > 0
                    ? `${Math.round((data.totalPurchases / data.totalViews) * 100)}%`
                    : "—"}
                </p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-content-muted">
                    <th className="py-2 pr-3 font-semibold">Ресурс</th>
                    <th className="py-2 pr-3 text-right font-semibold">Просмотры</th>
                    <th className="py-2 pr-3 text-right font-semibold">Покупки</th>
                    <th className="py-2 text-right font-semibold">Конверсия</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byResource.map((r) => (
                    <tr key={r.resourceId} className="border-t border-line">
                      <td className="py-2 pr-3">
                        <Link
                          href={`/resources/${r.slug}`}
                          className="transition-colors duration-fast hover:text-accent-strong"
                        >
                          {r.title}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.views30d}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.purchases30d}</td>
                      <td className="py-2 text-right tabular-nums">
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

// =====================================================================
// PLAN-018 A-007: вкладка «Финансы» — баланс, заявки на выплату,
// история операций и Premium-подписки. Все деньги в копейках (minor units);
// формат вывода — formatRub. Серверное значение баланса всегда главнее
// клиентского (F-003/INV-012): UI только подсказывает и пере-проверяет.
// =====================================================================

function SellerFinanceSection() {
  const qc = useQueryClient();

  const {
    data: balance,
    isLoading: balanceLoading,
    error: balanceError,
    refetch: refetchBalance,
  } = useQuery({
    queryKey: ["finance", "payout-balance"],
    queryFn: fetchPayoutBalance,
    retry: false,
  });

  const [payoutDialogOpen, setPayoutDialogOpen] = useState(false);
  const [payoutCreated, setPayoutCreated] = useState(false);

  const requestPayoutSuccess = () => {
    setPayoutDialogOpen(false);
    setPayoutCreated(true);
    qc.invalidateQueries({ queryKey: ["finance", "payout-balance"] });
    qc.invalidateQueries({ queryKey: ["finance", "payouts"] });
  };

  return (
    <div className="space-y-8">
      {/* Баланс: Доступно / В эскроу */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <BalanceCard
          icon={Wallet}
          label="Доступно к выплате"
          value={balance ? formatRub(balance.available) : null}
          loading={balanceLoading}
        />
        <BalanceCard
          icon={Landmark}
          label="В эскроу"
          value={balance ? formatRub(balance.inEscrow) : null}
          loading={balanceLoading}
        />
        <Card className="shadow-card">
          <CardContent className="pt-6">
            <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-md bg-accent-soft">
              <CreditCard className="h-4 w-4 text-accent-strong" />
            </span>
            <Button
              size="sm"
              disabled={!balance}
              onClick={() => setPayoutDialogOpen(true)}
            >
              <Plus className="mr-1.5 h-4 w-4" /> Запросить выплату
            </Button>
            <p className="mt-2 text-xs text-content-muted">
              Выплата требует одобренного профиля продавца с включёнными выплатами.
            </p>
          </CardContent>
        </Card>
      </div>

      {balanceError ? (
        <ErrorState error={balanceError} onRetry={() => refetchBalance()} />
      ) : null}
      {payoutCreated ? (
        <p className="text-sm text-ok" role="status">
          Заявка на выплату создана — она появится в таблице ниже.
        </p>
      ) : null}

      <PayoutsSection />

      <TransactionsSection />

      {/* PLAN-018 J: Premium — компактный блок в самом низу вкладки.
          Флаг выключен / ручки нет → секция честно скрывается целиком. */}
      <PremiumSection />

      <PayoutRequestDialog
        open={payoutDialogOpen}
        onClose={() => setPayoutDialogOpen(false)}
        onCreated={requestPayoutSuccess}
        availableMinor={balance?.available ?? null}
      />
    </div>
  );
}

function BalanceCard({
  icon: Icon,
  label,
  value,
  loading,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | null;
  loading?: boolean;
}) {
  return (
    <Card className="shadow-card">
      <CardContent className="pt-6">
        <span className="mb-2 flex h-8 w-8 items-center justify-center rounded-md bg-accent-soft">
          <Icon className="h-4 w-4 text-accent-strong" />
        </span>
        {loading || value === null ? (
          <p className="text-2xl font-bold tabular-nums text-content-muted">—</p>
        ) : (
          <p className="text-2xl font-bold tabular-nums">{value}</p>
        )}
        <p className="mt-0.5 text-xs font-semibold uppercase tracking-wide text-content-muted">
          {label}
        </p>
      </CardContent>
    </Card>
  );
}

// ---------- Payout statuses (локальный чип:PROCESSING/FAILED отсутствуют в ui/StatusBadge) ----------
const PAYOUT_STATUS_TONES: Record<string, string> = {
  PENDING: "border-warn/30 bg-warn/10 text-warn",
  PROCESSING: "border-info/30 bg-info/10 text-info",
  COMPLETED: "border-ok/30 bg-ok/10 text-ok",
  FAILED: "border-bad/30 bg-bad/10 text-bad",
  CANCELLED: "border-line bg-surface-hover text-content-muted",
};

const PAYOUT_STATUS_LABELS: Record<string, string> = {
  PENDING: "Ожидает",
  PROCESSING: "В обработке",
  COMPLETED: "Выполнена",
  FAILED: "Неуспешна",
  CANCELLED: "Отменена",
};

function PayoutStatusChip({ status }: { status: string | null }) {
  const key = status ?? "";
  const tone = PAYOUT_STATUS_TONES[key] ?? PAYOUT_STATUS_TONES.CANCELLED;
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-pill border px-2.5 py-0.5 text-xs font-medium ${tone}`}
    >
      {PAYOUT_STATUS_LABELS[key] ?? status ?? "—"}
    </span>
  );
}

/** Человеческие тексты для 409/403 выплаты (коды из PayoutError). */
function humanizePayoutError(error: unknown, availableMinor: number | null): string {
  const code = apiErrorCode(error);
  switch (code) {
    case "open_payout_exists":
      return "У вас уже есть незавершённая заявка на выплату";
    case "insufficient_balance":
      return availableMinor !== null
        ? `Недостаточно средств: доступно ${formatRub(availableMinor)}`
        : "Недостаточно средств для выплаты";
    case "amount_too_large":
      return "Сумма выплаты превышает допустимый максимум";
    case "invalid_amount":
      return "Введите корректную сумму выплаты";
    case "seller_payout_not_enabled":
      return "Выплаты требуют одобренного профиля продавца с включёнными выплатами";
    default:
      return getErrorMessage(error, "Не удалось создать заявку на выплату");
  }
}

/** «1234.5» / «1234,50» → minor units; null при некорректном вводе. */
function parseRubToMinor(input: string): number | null {
  const normalized = input.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return Math.round(parseFloat(normalized) * 100);
}

function PayoutRequestDialog({
  open,
  onClose,
  onCreated,
  availableMinor,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  availableMinor: number | null;
}) {
  const [amountRub, setAmountRub] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const amountMinor = parseRubToMinor(amountRub);
  const amountValid = amountMinor !== null && amountMinor > 0;
  const withinBalance =
    amountMinor === null || availableMinor === null || amountMinor <= availableMinor;

  const mutation = useMutation({
    mutationFn: () =>
      requestPayout({
        amountMinor: amountMinor as number,
        ...(note.trim() ? { note: note.trim().slice(0, 500) } : {}),
      }),
    onSuccess: () => {
      setAmountRub("");
      setNote("");
      setError(null);
      onCreated();
    },
    onError: (e) => setError(humanizePayoutError(e, availableMinor)),
  });

  useEffect(() => {
    if (open) rememberTrigger(document.activeElement as HTMLElement | null);
  }, [open]);
  useFocusTrap(open, dialogRef, {
    onEscape: () => {
      if (!mutation.isPending) onClose();
    },
    autofocus: open,
  });
  useEffect(() => {
    if (!open) restoreTrigger();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 p-4"
      onClick={() => {
        if (!mutation.isPending) onClose();
      }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Заявка на выплату"
        className="w-full max-w-md rounded-card border border-line bg-surface p-6 space-y-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-content">Заявка на выплату</h2>
        <p className="text-sm text-content-secondary">
          {availableMinor !== null
            ? `Доступно: ${formatRub(availableMinor)}`
            : "Баланс загружается..."}
        </p>
        <div className="space-y-1.5">
          <label
            htmlFor="payout-amount"
            className="block text-xs font-semibold uppercase tracking-wide text-content-secondary"
          >
            Сумма, ₽
          </label>
          <Input
            id="payout-amount"
            value={amountRub}
            onChange={(e) => setAmountRub(e.target.value)}
            placeholder="1000.00"
            inputMode="decimal"
            aria-label="Сумма выплаты, ₽"
          />
          {amountRub.trim() !== "" && !amountValid ? (
            <p className="text-xs text-bad">Введите сумму до копеек, например 1000.50</p>
          ) : null}
          {amountValid && !withinBalance ? (
            <p className="text-xs text-bad">Сумма превышает доступный баланс</p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <label
            htmlFor="payout-note"
            className="block text-xs font-semibold uppercase tracking-wide text-content-secondary"
          >
            Комментарий (необязательно)
          </label>
          <Textarea
            id="payout-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Например: реквизиты или пояснение"
            rows={2}
            maxLength={500}
          />
        </div>
        {error ? <p className="text-sm text-bad">{error}</p> : null}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={mutation.isPending}>
            Отмена
          </Button>
          <Button
            size="sm"
            disabled={!amountValid || !withinBalance || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Отправка..." : "Создать заявку"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function PayoutsSection() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["finance", "payouts"],
    queryFn: () => fetchMyPayouts(1, 20),
    retry: false,
  });

  const payouts: Payout[] = data?.payouts ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Landmark className="h-5 w-5 text-accent" /> Заявки на выплату
        </CardTitle>
        <CardDescription>История ваших заявок и их статусы</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <LoadingSpinner label="Загрузка выплат..." />
        ) : error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : payouts.length === 0 ? (
          <EmptyState
            icon={<Landmark className="h-12 w-12 text-content-muted mx-auto mb-4" />}
            title="Заявок на выплату пока нет"
            description="Когда появятся заработанные средства — запросите первую выплату"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-content-muted">
                  <th className="py-2 pr-3 font-semibold">Сумма</th>
                  <th className="py-2 pr-3 font-semibold">Статус</th>
                  <th className="py-2 pr-3 font-semibold">Создана</th>
                  <th className="py-2 pr-3 font-semibold">Решение</th>
                  <th className="py-2 pr-3 font-semibold">Референс</th>
                  <th className="py-2 font-semibold">Комментарий</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id || `payout-${p.payoutRef ?? p.requestedAt}`} className="border-t border-line">
                    <td className="py-2 pr-3 font-semibold tabular-nums">{formatRub(p.amountMinor)}</td>
                    <td className="py-2 pr-3">
                      <PayoutStatusChip status={p.status} />
                    </td>
                    <td className="py-2 pr-3 text-content-secondary">
                      {p.requestedAt ? formatDate(p.requestedAt) : "—"}
                    </td>
                    <td className="py-2 pr-3 text-content-secondary">
                      {p.decidedAt ? formatDate(p.decidedAt) : "—"}
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-content-secondary">
                      {p.payoutRef ?? "—"}
                    </td>
                    <td className="py-2 text-content-secondary">
                      {p.note ? <span className="line-clamp-1">{p.note}</span> : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- История операций (GET /payments/transactions/mine) ----------

type HistoryRow = {
  key: string;
  kind: "payment" | "refund" | "purchase";
  typeLabel: string;
  amountMinor: number;
  direction: "out" | "in" | "ref";
  status: string | null;
  date: string | null;
  detail: string | null;
};

const TRANSACTION_STATUS_LABELS: Record<string, string> = {
  PENDING: "Ожидает",
  SUCCEEDED: "Успешен",
  FAILED: "Неуспешен",
  COMPLETED: "Завершена",
  CANCELLED: "Отменён",
};

function TransactionsSection() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["finance", "transactions"],
    queryFn: fetchMyTransactions,
    retry: false,
  });

  const transactions: MyTransactions | undefined = data;
  const rows: HistoryRow[] = transactions
    ? [
        ...transactions.payments.map((p: TransactionPayment, i: number): HistoryRow => ({
          key: `pay-${p.id}-${i}`,
          kind: "payment",
          typeLabel: "Платёж",
          amountMinor: p.amount,
          direction: "out",
          status: p.status ?? null,
          date: p.createdAt ?? null,
          detail: p.provider ?? null,
        })),
        ...transactions.refunds.map((r: TransactionRefund, i: number): HistoryRow => ({
          key: `ref-${r.id}-${i}`,
          kind: "refund",
          typeLabel: "Возврат",
          amountMinor: r.amount,
          direction: "in",
          status: r.status ?? null,
          date: r.createdAt ?? null,
          detail: r.reason ?? null,
        })),
        ...transactions.purchases.map((p: TransactionPurchase, i: number): HistoryRow => ({
          key: `pur-${p.id}-${i}`,
          kind: "purchase",
          typeLabel: "Покупка",
          amountMinor: p.finalPrice,
          direction: "ref",
          status: p.status ?? null,
          date: p.createdAt ?? null,
          detail: null,
        })),
      ].sort((a, b) => {
        const ta = a.date ? new Date(a.date).getTime() : 0;
        const tb = b.date ? new Date(b.date).getTime() : 0;
        return tb - ta;
      })
    : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-5 w-5 text-accent" /> История операций
        </CardTitle>
        <CardDescription>
          Платежи, возвраты и покупки по вашему аккаунту (последние 50 по каждому типу)
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <LoadingSpinner label="Загрузка истории..." />
        ) : error ? (
          <ErrorState error={error} onRetry={() => refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="Операций пока нет"
            description="Здесь появятся ваши платежи, возвраты и покупки"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-content-muted">
                  <th className="py-2 pr-3 font-semibold">Тип</th>
                  <th className="py-2 pr-3 text-right font-semibold">Сумма</th>
                  <th className="py-2 pr-3 font-semibold">Статус</th>
                  <th className="py-2 pr-3 font-semibold">Дата</th>
                  <th className="py-2 font-semibold">Детали</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className="border-t border-line">
                    <td className="py-2 pr-3 font-medium">{row.typeLabel}</td>
                    <td
                      className={`py-2 pr-3 text-right tabular-nums ${
                        row.direction === "in"
                          ? "text-ok"
                          : row.direction === "out"
                            ? "text-content"
                            : "text-content-secondary"
                      }`}
                    >
                      {row.direction === "out"
                        ? `− ${formatRub(row.amountMinor)}`
                        : row.direction === "in"
                          ? `+ ${formatRub(row.amountMinor)}`
                          : formatRub(row.amountMinor)}
                    </td>
                    <td className="py-2 pr-3">
                      <span className="text-content-secondary">
                        {row.status
                          ? (TRANSACTION_STATUS_LABELS[row.status] ?? row.status)
                          : "—"}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-content-secondary">
                      {row.date ? formatDate(row.date) : "—"}
                    </td>
                    <td className="py-2 text-content-secondary">
                      {row.detail ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------- Premium-подписки (PLAN-018 J; флаг выключен → секция скрыта) ----------

function PremiumSection() {
  const plansQuery = useQuery({
    queryKey: ["finance", "subscription-plans"],
    queryFn: fetchSubscriptionPlans,
    retry: false,
  });
  const mineQuery = useQuery({
    queryKey: ["finance", "my-subscriptions"],
    queryFn: fetchMySubscriptions,
    retry: false,
  });

  const plans: SubscriptionPlan[] = plansQuery.data?.plans ?? [];
  const mine: Subscription[] = mineQuery.data ?? [];

  // Честное сокрытие: 404 (флаг выключен или ручка ещё не включена) и любые
  // другие ошибки → секции нет, никакого «сломанного» UI.
  if (plansQuery.error) return null;
  if (!plansQuery.isLoading && plans.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Crown className="h-5 w-5 text-accent" /> Premium
        </CardTitle>
        <CardDescription>
          Расширенные возможности платформы через подписку
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {plansQuery.isLoading ? (
          <LoadingSpinner label="Загрузка тарифов..." />
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {plans.map((plan) => (
                <PlanCard key={String(plan.kind ?? plan.label)} plan={plan} />
              ))}
            </div>

            {mineQuery.data && mine.length > 0 ? (
              <div className="space-y-3">
                <p className="text-sm font-semibold">Мои подписки</p>
                {mine.map((sub) => (
                  <MySubscriptionRow key={sub.id} subscription={sub} plans={plans} />
                ))}
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PlanChip({ tone, children }: { tone: "ok" | "muted" | "info"; children: React.ReactNode }) {
  const tones = {
    ok: "border-ok/30 bg-ok/10 text-ok",
    info: "border-info/30 bg-info/10 text-info",
    muted: "border-line bg-surface-hover text-content-muted",
  } as const;
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-pill border px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function PlanCard({ plan }: { plan: SubscriptionPlan }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const kind = typeof plan.kind === "string" ? plan.kind : "";
  const enabled = plan.enabled === true;
  const available = plan.available !== false;

  const mutation = useMutation({
    mutationFn: () => createSubscription(kind),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["finance", "my-subscriptions"] });
    },
    onError: (e) => setError(getErrorMessage(e, "Не удалось подключить подписку")),
  });

  return (
    <div className="space-y-3 rounded-card border border-line bg-surface-raised p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{plan.label ?? kind ?? "Тариф"}</p>
          {plan.description ? (
            <p className="mt-0.5 text-sm text-content-secondary">{plan.description}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          <PlanChip tone={enabled ? "ok" : "muted"}>
            {enabled ? "Модуль включён" : "Модуль отключён"}
          </PlanChip>
          <PlanChip tone={available ? "info" : "muted"}>
            {available ? "Доступен вам" : "Недоступен"}
          </PlanChip>
        </div>
      </div>
      {Array.isArray(plan.features) && plan.features.length > 0 ? (
        <ul className="space-y-1 text-sm text-content-secondary">
          {plan.features.map((feature, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <span className="mt-1.5 h-1 w-1 flex-shrink-0 rounded-full bg-content-muted" aria-hidden />
              {feature}
            </li>
          ))}
        </ul>
      ) : null}
      {plan.note ? (
        <p className="rounded-md border border-line bg-surface-inset px-3 py-2 text-xs text-content-secondary">
          {plan.note}
        </p>
      ) : null}
      {error ? <p className="text-sm text-bad">{error}</p> : null}
      <Button
        size="sm"
        disabled={!enabled || !available || !kind || mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {mutation.isPending ? "Подключение..." : "Подключить"}
      </Button>
    </div>
  );
}

function MySubscriptionRow({
  subscription,
  plans,
}: {
  subscription: Subscription;
  plans: SubscriptionPlan[];
}) {
  const qc = useQueryClient();
  const [confirmAction, setConfirmAction] = useState<"cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const labelByKind = new Map(
    plans.filter((p) => typeof p.kind === "string").map((p) => [p.kind as string, p.label ?? p.kind])
  );

  const action = useMutation({
    mutationFn: (input: { kind: "cancel" | "resume" | "auto" }) => {
      if (input.kind === "cancel") return cancelSubscription(subscription.id);
      if (input.kind === "resume") return resumeSubscription(subscription.id);
      return setSubscriptionAutoRenew(subscription.id, !(subscription.autoRenew === true));
    },
    onSuccess: () => {
      setConfirmAction(null);
      setError(null);
      qc.invalidateQueries({ queryKey: ["finance", "my-subscriptions"] });
    },
    onError: (e) => {
      setConfirmAction(null);
      setError(getErrorMessage(e, "Действие не выполнено"));
    },
  });

  const status = typeof subscription.status === "string" ? subscription.status : "";
  const canCancel = status === "ACTIVE";
  const canResume = status === "CANCELLED" || status === "PAUSED";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface-raised p-4">
      <div>
        <p className="font-medium">
          {labelByKind.get(String(subscription.kind ?? "")) ?? String(subscription.kind ?? "Подписка")}
        </p>
        <p className="text-sm text-content-secondary">
          {subscription.expiresAt ? `Действует до ${formatDate(subscription.expiresAt)}` : "—"}
          {" · "}
          Автопродление: {subscription.autoRenew === true ? "вкл" : "выкл"}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {subscription.status ? <StatusBadge status={subscription.status} /> : null}
        {canCancel ? (
          <Button variant="outline" size="sm" onClick={() => setConfirmAction("cancel")}>
            Отменить
          </Button>
        ) : null}
        {canResume ? (
          <Button
            variant="outline"
            size="sm"
            disabled={action.isPending}
            onClick={() => action.mutate({ kind: "resume" })}
          >
            Возобновить
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          disabled={action.isPending}
          onClick={() => action.mutate({ kind: "auto" })}
        >
          Автопродление {subscription.autoRenew === true ? "выключить" : "включить"}
        </Button>
      </div>
      {error ? <p className="w-full text-sm text-bad">{error}</p> : null}
      <ConfirmDialog
        open={confirmAction === "cancel"}
        title="Отменить подписку?"
        description="Подписка перестанет продлеваться; доступ к премиум-функциям сохранится до конца оплаченного периода."
        confirmLabel="Отменить подписку"
        busy={action.isPending}
        onConfirm={() => action.mutate({ kind: "cancel" })}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}
