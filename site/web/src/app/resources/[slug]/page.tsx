// Resource Detail (PLAN-002 F-001..F-006): полноценная product page.
// Вся логика покупки/отзывов из PLAN-001 сохранена, presentation перестроена:
// hero area с CTA, DRM-блок, читаемая история версий, полноценные отзывы.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  fetchResource,
  fetchResourceVersions,
  fetchResourceReviews,
  fetchMyPurchases,
  createPurchase,
  createPayment,
  postReview,
  countResourceView,
  formatRub,
  getErrorMessage,
  followResource,
  unfollowResource,
  fetchMyResourceFollows,
  type Purchase,
} from "@/lib/api-ext";
import { useAuthStore } from "@/store/auth";
import { bootstrapSession } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Price } from "@/components/ui/Price";
import { Rating } from "@/components/ui/Rating";
import { Gallery } from "@/components/ui/Gallery";
import { Avatar } from "@/components/ui/Avatar";
import { typeLabel, formatDate } from "@/lib/domain";
import { Star, ShieldCheck, Package, Store, CheckCircle2, Clock } from "lucide-react";

export default function ResourceDetailPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;
  const { user, accessToken, isAuthenticated } = useAuthStore();
  const qc = useQueryClient();

  // Restore session from refresh cookie on reload (token is memory-only).
  // useEffect — иначе React strict-mode дважды монтирует компонент и
  // bootstrapSession спамит /auth/refresh (это выжигает rate-limit квоту).
  useEffect(() => {
    if (!accessToken) {
      void bootstrapSession();
    }
  }, [accessToken]);

  const { data: resource, isLoading, error } = useQuery({
    queryKey: ["resource", slug],
    queryFn: () => fetchResource(slug),
  });

  const { data: versions } = useQuery({
    queryKey: ["resource-versions", slug],
    queryFn: () => fetchResourceVersions(slug),
  });

  const { data: reviewsData } = useQuery({
    queryKey: ["resource-reviews", slug],
    queryFn: () => fetchResourceReviews(slug, 1, 20),
  });

  // Ownership: needed for the "already acquired" state and the review form.
  const { data: myPurchases } = useQuery({
    queryKey: ["purchases", "my", slug],
    queryFn: fetchMyPurchases,
    enabled: accessToken !== null,
  });

  const owned = useMemo(
    () =>
      (myPurchases as Purchase[] | undefined)?.some(
        (p) => p.resource.slug === slug && p.status === "COMPLETED"
      ) ?? false,
    [myPurchases, slug]
  );

  // PLAN-010 C-001: honest page view — once per mount, fire-and-forget.
  const viewFired = useRef(false);
  useEffect(() => {
    if (resource?.slug && resource?.status === "PUBLISHED" && !viewFired.current) {
      viewFired.current = true;
      countResourceView(resource.slug);
    }
  }, [resource?.slug, resource?.status]);

  // PLAN-008 E-002: resource follow (§26 — optional relationship on top of
  // the purchase relationship). Own state only; aggregate count from payload.
  const { data: myResourceFollows } = useQuery({
    queryKey: ["me", "follows", "resources", accessToken ?? "guest"],
    queryFn: fetchMyResourceFollows,
    enabled: isAuthenticated() && !!accessToken,
    retry: false,
  });
  const [followState, setFollowState] = useState<{ following: boolean; count: number } | null>(null);
  const isFollowingResource = followState
    ? followState.following
    : (myResourceFollows ?? []).some((f: any) => f.slug === resource?.slug);

  const followToggle = useMutation({
    mutationFn: async () => {
      if (!resource) throw new Error("no resource");
      return isFollowingResource
        ? unfollowResource(resource.slug)
        : followResource(resource.slug);
    },
    onSuccess: (res: any) => {
      setFollowState({ following: res.following, count: res.resourceFollowers });
      qc?.invalidateQueries({ queryKey: ["me", "follows", "resources"] });
    },
  });

  // ---------- Checkout state (M-004/M-005) ----------
  const [discountCode, setDiscountCode] = useState("");
  const [checkoutResult, setCheckoutResult] = useState<
    | { kind: "completed"; licenseId: string }
    | {
        kind: "pending";
        purchaseId: string;
        amount: number;
        originalAmount: number;
        discount?: { amount: number; percentage: number };
        devMessage?: string;
      }
    | null
  >(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleBuy = async () => {
    if (!isAuthenticated()) {
      router.push("/auth/login");
      return;
    }
    setBusy(true);
    setCheckoutError(null);
    try {
      const purchase = await createPurchase(slug, discountCode.trim() || undefined);

      if (purchase.status === "completed") {
        setCheckoutResult({ kind: "completed", licenseId: purchase.licenseId });
        qc.invalidateQueries({ queryKey: ["purchases"] });
        return;
      }

      // Paid purchase (possibly discounted): create the YooKassa payment.
      let devMessage: string | undefined;
      try {
        const payment = await createPayment(purchase.purchaseId);
        if (payment.paymentUrl) {
          window.location.href = payment.paymentUrl;
          return;
        }
        devMessage = payment.message;
      } catch (pe) {
        devMessage = getErrorMessage(pe, "Не удалось создать платёж");
      }

      setCheckoutResult({
        kind: "pending",
        purchaseId: purchase.purchaseId,
        amount: purchase.amount,
        originalAmount: purchase.originalAmount,
        discount: purchase.discount,
        devMessage,
      });
      qc.invalidateQueries({ queryKey: ["purchases"] });
    } catch (e) {
      setCheckoutError(getErrorMessage(e, "Ошибка при оформлении покупки"));
    } finally {
      setBusy(false);
    }
  };

  // ---------- Review form ----------
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");
  const [reviewMsg, setReviewMsg] = useState<string | null>(null);
  const [reviewErr, setReviewErr] = useState<string | null>(null);

  const reviewMutation = useMutation({
    mutationFn: () => postReview(slug, rating, comment),
    onSuccess: () => {
      setReviewMsg("Отзыв отправлен. Спасибо!");
      setComment("");
      setReviewErr(null);
      qc.invalidateQueries({ queryKey: ["resource-reviews", slug] });
    },
    onError: (e) => {
      setReviewMsg(null);
      setReviewErr(getErrorMessage(e, "Не удалось отправить отзыв"));
    },
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-12">
        <div className="animate-pulse space-y-4">
          <div className="h-40 rounded-card bg-surface-hover" />
          <div className="h-8 w-1/2 rounded bg-surface-hover" />
          <div className="h-24 rounded-card bg-surface-hover" />
        </div>
      </div>
    );
  }

  if (error || !resource) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-16">
        <Card className="mx-auto max-w-lg text-center">
          <CardContent className="py-10 space-y-4">
            <Package className="h-10 w-10 text-content-muted mx-auto" />
            <h1 className="text-xl font-semibold">Ресурс не найден</h1>
            <p className="text-sm text-content-secondary">
              Возможно, он был удалён или ещё не опубликован.
            </p>
            <Link href="/resources">
              <Button variant="outline">Вернуться в Маркетплейс</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const latestVersion = versions && versions.length > 0 ? versions[0] : null;
  const sellerName = resource.seller
    ? resource.seller.displayName || resource.seller.username || null
    : null;
  const sellerUsername = resource.seller?.username ?? null;

  // D-002: галерея — cover + screenshots (реальные данные, без заглушек).
  const galleryImages = [
    ...(resource.coverUrl
      ? [{ id: "cover", url: resource.coverUrl, alt: `Обложка: ${resource.title}` }]
      : []),
    ...(resource.screenshots ?? []).map((s) => ({
      id: s.id,
      url: s.url,
      alt: `Скриншот ${resource.title}`,
    })),
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* Breadcrumbs (N-001): Главная / Маркетплейс / Ресурс */}
      <nav aria-label="Хлебные крошки" className="mb-6 text-sm text-content-muted">
        <Link href="/" className="hover:text-accent-strong">
          Главная
        </Link>
        <span className="mx-2">/</span>
        <Link href="/resources" className="hover:text-accent-strong">
          Маркетплейс
        </Link>
        <span className="mx-2">/</span>
        <span className="text-content-secondary">{resource.title}</span>
      </nav>

      <div className="grid lg:grid-cols-3 gap-8">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-8">
          {/* Gallery (D-001/D-002): cover + screenshots с лайтбоксом */}
          {galleryImages.length > 0 ? (
            <Gallery
              images={galleryImages}
              aspect="aspect-video"
              className={resource.coverUrl ? "" : "hidden"}
            />
          ) : null}

          {/* Hero area (D-001) */}
          <div className="rounded-card border border-line bg-gradient-to-br from-accent-soft via-surface-raised to-surface p-8 flex flex-col items-start gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent-strong">
                {typeLabel(resource.type)}
              </span>
              {latestVersion ? (
                <span className="rounded bg-surface px-2.5 py-1 text-xs font-medium text-content-secondary border border-line">
                  v{latestVersion.version}
                </span>
              ) : null}
            </div>
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">{resource.title}</h1>
            <p className="text-content-secondary leading-relaxed max-w-2xl line-clamp-3">
              {resource.description}
            </p>
            <div className="flex flex-wrap items-center gap-4 text-sm">
              {/* D-005: seller identity ведёт в витрину продавца */}
              {sellerUsername ? (
                <Link
                  href={`/sellers/${sellerUsername}`}
                  className="inline-flex items-center gap-1.5 text-content-secondary hover:text-accent-strong transition-colors"
                >
                  <Avatar
                    src={resource.seller?.avatar ?? null}
                    name={sellerName ?? resource.seller?.username ?? "?"}
                    size="sm"
                  />
                  <span className="underline-offset-2 group-hover:underline">{sellerName}</span>
                </Link>
              ) : sellerName ? (
                <span className="inline-flex items-center gap-1.5 text-content-secondary">
                  <Store className="h-4 w-4" /> {sellerName}
                </span>
              ) : null}
              <Rating
                value={resource.rating ?? reviewsData?.stats.averageRating ?? null}
                count={resource.reviewCount ?? reviewsData?.stats.total ?? null}
                size="md"
              />
              <span className="text-content-muted">Опубликовано {formatDate(resource.createdAt)}</span>
            </div>
          </div>

          {/* DRM info */}
          <div className="flex items-start gap-3 p-4 rounded-card border border-line bg-surface">
            <ShieldCheck className="h-6 w-6 text-ok flex-shrink-0" />
            <div>
              <h2 className="font-semibold">Лицензия с DRM-защитой</h2>
              <p className="text-sm text-content-secondary">
                После подтверждения оплаты вы получаете персональную лицензию, привязанную к вашему
                серверу. Загрузка ресурса доступна из раздела покупок.
              </p>
            </div>
          </div>

          {/* Description (F-003) */}
          <Card>
            <CardHeader>
              <CardTitle>Описание</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-content-secondary whitespace-pre-line leading-relaxed">
                {resource.description}
              </p>
            </CardContent>
          </Card>

          {/* Versions (F-006) */}
          <Card>
            <CardHeader>
              <CardTitle>История версий</CardTitle>
            </CardHeader>
            <CardContent>
              {!versions || versions.length === 0 ? (
                <p className="text-sm text-content-muted">Версии пока не опубликованы.</p>
              ) : (
                <ol className="relative space-y-6 border-l border-line pl-6">
                  {versions.map((v, i) => (
                    <li key={v.id} className="relative">
                      <span
                        className={`absolute -left-[1.9rem] top-1 h-3 w-3 rounded-full border-2 ${
                          i === 0 ? "bg-accent border-accent" : "bg-surface border-line-strong"
                        }`}
                      />
                      <div className="flex items-center gap-3">
                        <span className="font-semibold">v{v.version}</span>
                        {i === 0 ? (
                          <span className="rounded bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-strong">
                            Актуальная
                          </span>
                        ) : null}
                        <span className="text-xs text-content-muted">{formatDate(v.createdAt)}</span>
                      </div>
                      {v.changelog ? (
                        <p className="text-sm text-content-secondary mt-1">{v.changelog}</p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          {/* Reviews (F-005) */}
          <Card>
            <CardHeader>
              <CardTitle>Отзывы</CardTitle>
              <CardDescription>
                {reviewsData?.stats?.total
                  ? `Средняя оценка: ${reviewsData.stats.averageRating?.toFixed(1) ?? "—"} · ${reviewsData.stats.total} отзывов`
                  : "Пока нет отзывов"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {accessToken && owned ? (
                <div className="p-4 rounded-card border border-line bg-surface-raised space-y-3">
                  <p className="text-sm font-medium">Оставить отзыв</p>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setRating(n)}
                        aria-label={`Оценка ${n}`}
                        className="p-1 rounded hover:bg-surface-hover"
                      >
                        <Star
                          className={`h-6 w-6 ${
                            n <= rating
                              ? "text-amber-400 fill-amber-400"
                              : "text-line-strong"
                          }`}
                        />
                      </button>
                    ))}
                  </div>
                  <Input
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Ваш отзыв"
                  />
                  <Button
                    size="sm"
                    disabled={reviewMutation.isPending}
                    onClick={() => reviewMutation.mutate()}
                  >
                    Отправить отзыв
                  </Button>
                  {reviewMsg ? <p className="text-sm text-ok">{reviewMsg}</p> : null}
                  {reviewErr ? (
                    <p className="text-sm text-bad" role="alert">
                      {reviewErr}
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-content-muted">
                  Войдите и приобретите ресурс, чтобы оставить отзыв.
                </p>
              )}

              {reviewsData && reviewsData.data.length === 0 ? (
                <p className="text-sm text-content-muted">
                  Отзывов пока нет — станьте первым покупателем, который поделится мнением.
                </p>
              ) : null}

              {reviewsData?.data.map((r) => (
                <div key={r.id} className="p-4 rounded-card border border-line space-y-2">
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-sm">
                      {r.user?.displayName || r.user?.username || "Пользователь"}
                    </span>
                    <span className="flex">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star
                          key={n}
                          className={`h-4 w-4 ${
                            n <= r.rating ? "text-amber-400 fill-amber-400" : "text-line-strong"
                          }`}
                        />
                      ))}
                    </span>
                    <span className="text-xs text-content-muted ml-auto">
                      {formatDate(r.createdAt)}
                    </span>
                  </div>
                  {r.comment ? <p className="text-sm text-content-secondary">{r.comment}</p> : null}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar: purchase area (F-004) + PLAN-008 follow */}
        <div className="space-y-6 lg:sticky lg:top-24 self-start">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-content-secondary">
                  Следят:{" "}
                  <span className="font-semibold text-content">
                    {(followState ? followState.count : (resource?.resourceFollowers ?? 0)).toLocaleString("ru-RU")}
                  </span>
                </p>
                {resource?.seller?.username === user?.username ? null : (
                  <Button
                    variant={isFollowingResource ? "outline" : "primary"}
                    size="sm"
                    disabled={followToggle.isPending}
                    onClick={() => {
                      if (!user) {
                        router.push("/auth/login");
                        return;
                      }
                      followToggle.mutate();
                    }}
                  >
                    {isFollowingResource ? "Не следить" : "Следить"}
                  </Button>
                )}
              </div>
              <p className="mt-2 text-xs text-content-muted">
                Уведомим о новой версии ресурса.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>
                {owned
                  ? "Уже приобретено"
                  : resource.price === 0
                    ? "Получить бесплатно"
                    : "Купить ресурс"}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="py-2">
                <Price kopecks={resource.price} size="lg" />
                {resource.price > 0 && (
                  <p className="text-sm text-content-secondary mt-1">Единоразовая покупка</p>
                )}
              </div>

              {owned ? (
                <div className="p-4 rounded-card bg-accent-soft space-y-2">
                  <p className="flex items-center gap-2 text-sm font-medium text-accent-strong">
                    <CheckCircle2 className="h-4 w-4" /> Ресурс уже в ваших покупках
                  </p>
                  <Link href="/dashboard">
                    <Button variant="outline" size="sm" className="w-full">
                      Открыть мои покупки
                    </Button>
                  </Link>
                </div>
              ) : (
                <>
                  {resource.price > 0 ? (
                    <div>
                      <label htmlFor="discount" className="text-sm text-content-secondary">
                        Промокод (если есть)
                      </label>
                      <Input
                        id="discount"
                        value={discountCode}
                        onChange={(e) => setDiscountCode(e.target.value)}
                        placeholder="Код скидки"
                        className="mt-1"
                      />
                    </div>
                  ) : null}

                  <Button
                    variant="primary"
                    size="lg"
                    className="w-full"
                    disabled={busy}
                    onClick={handleBuy}
                  >
                    {busy
                      ? "Оформление..."
                      : resource.price === 0
                        ? "Получить"
                        : "Купить сейчас"}
                  </Button>
                  {resource.price > 0 && (
                    <p className="text-xs text-content-muted text-center">
                      Безопасная оплата через ЮKassa
                    </p>
                  )}
                </>
              )}

              {checkoutError ? (
                <p className="text-sm text-bad" role="alert">
                  {checkoutError}
                </p>
              ) : null}

              {checkoutResult?.kind === "completed" ? (
                <div className="p-4 rounded-card border border-ok/30 bg-ok/10 space-y-2">
                  <StatusBadge status="COMPLETED">Покупка завершена</StatusBadge>
                  <p className="text-sm text-content-secondary">
                    Лицензия выдана. Покупки и загрузки доступны в разделе{" "}
                    <Link href="/dashboard" className="text-accent-strong underline">
                      Мои покупки
                    </Link>
                    .
                  </p>
                </div>
              ) : null}

              {checkoutResult?.kind === "pending" ? (
                <div className="p-4 rounded-card border border-warn/30 bg-warn/10 space-y-2">
                  {checkoutResult.discount ? (
                    <p className="text-sm">
                      <span className="line-through text-content-muted mr-2">
                        {formatRub(checkoutResult.originalAmount)}
                      </span>
                      <span className="font-bold text-ok">{formatRub(checkoutResult.amount)}</span>
                      <span className="ml-2 text-xs bg-ok/20 text-ok px-2 py-0.5 rounded">
                        −{checkoutResult.discount.percentage}%
                      </span>
                    </p>
                  ) : (
                    <p className="text-sm">
                      К оплате: <span className="font-bold">{formatRub(checkoutResult.amount)}</span>
                    </p>
                  )}
                  <StatusBadge status="PENDING_PAYMENT">Ожидает оплаты</StatusBadge>
                  {checkoutResult.devMessage ? (
                    <p className="text-xs text-content-secondary">{checkoutResult.devMessage}</p>
                  ) : (
                    <p className="text-xs text-content-secondary flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" /> Перенаправление на платёжную систему...
                    </p>
                  )}
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* D-005: seller block в сайдбаре */}
          {sellerUsername && sellerName ? (
            <Card>
              <CardContent className="pt-6">
                <p className="text-xs font-semibold uppercase tracking-wide text-content-muted mb-3">
                  Продавец
                </p>
                <Link
                  href={`/sellers/${sellerUsername}`}
                  className="flex items-center gap-3 rounded-card p-2 -m-2 hover:bg-surface-hover transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <Avatar
                    src={resource.seller?.avatar ?? null}
                    name={sellerName}
                    size="md"
                  />
                  <div className="min-w-0">
                    <p className="font-medium truncate">{sellerName}</p>
                    <p className="text-xs text-content-muted truncate">
                      @{resource.seller?.username}
                    </p>
                  </div>
                  <Store className="ml-auto h-4 w-4 text-content-muted flex-shrink-0" />
                </Link>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardContent className="pt-6 space-y-3 text-sm">
              <div className="flex items-start gap-3">
                <ShieldCheck className="h-5 w-5 text-accent flex-shrink-0" />
                <p className="text-content-secondary">
                  Лицензия выдаётся автоматически и привязывается к вашему серверу.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <Package className="h-5 w-5 text-accent flex-shrink-0" />
                <p className="text-content-secondary">
                  Покупки и загрузки доступны в личном кабинете.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
