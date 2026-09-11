// Account (PLAN-002 G-001..G-005): одна account area с логическими вкладками:
// Обзор · Профиль · Подключения · Баланс · Покупки.
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/store/auth";
import { bootstrapSession } from "@/lib/api";
import {
  fetchMyPurchases,
  fetchMe,
  fetchIdentities,
  patchProfile,
  formatRub,
  getErrorMessage,
  type Purchase,
} from "@/lib/api-ext";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Avatar } from "@/components/ui/Avatar";
import { Tabs } from "@/components/ui/Tabs";
import { StatusBadge, ErrorText } from "@/components/ui/StatusBadge";
import { EmptyState, ErrorState, LoadingSpinner } from "@/components/ui/States";
import { DisputeDialog } from "@/components/disputes/DisputeDialog";
import { typeLabel, formatDate } from "@/lib/domain";
import { Scale, Wallet, Pencil, Check, X, Link2, ShoppingBag, User } from "lucide-react";

const ROLE_LABELS: Record<string, string> = {
  USER: "Покупатель",
  SELLER: "Продавец",
  MODERATOR: "Модератор",
  ADMIN: "Администратор",
};

type AccountTab = "overview" | "profile" | "connections" | "balance" | "purchases";

export default function AccountPage() {
  const router = useRouter();
  const { accessToken, isAuthenticated, user } = useAuthStore();
  const [tab, setTab] = useState<AccountTab>("profile");

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

  const { data: me, isLoading: meLoading, error: meError, refetch: refetchMe } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    enabled: accessToken !== null,
    staleTime: 10_000,
  });

  const {
    data: purchases,
    isLoading: purchasesLoading,
    error: purchasesError,
    refetch: refetchPurchases,
  } = useQuery({
    queryKey: ["purchases", "my", "account"],
    queryFn: fetchMyPurchases,
    enabled: accessToken !== null,
  });

  const { data: identities } = useQuery({
    queryKey: ["identities"],
    queryFn: fetchIdentities,
    enabled: accessToken !== null,
    retry: false,
  });

  if (!isAuthenticated()) return null;

  const list = (purchases as Purchase[] | undefined) ?? [];
  const completed = list.filter((p) => p.status === "COMPLETED").length;
  const activeLicenses = list.filter((p) => p.license?.status === "ACTIVE").length;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <Avatar src={me?.avatar ?? null} name={me?.displayName || me?.username || "?"} size="lg" />
          <div>
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Профиль</h1>
            <p className="text-sm text-content-secondary">
              {me ? ROLE_LABELS[me.role] ?? me.role : "Аккаунт"}
            </p>
          </div>
        </div>
        <Link href="/disputes">
          <Button variant="outline" size="sm">
            <Scale className="mr-2 h-4 w-4" />
            Мои споры
          </Button>
        </Link>
      </div>

      <Tabs
        className="mb-8"
        value={tab}
        onChange={setTab}
        tabs={[
          ["profile", "Профиль"],
          ["overview", "Обзор"],
          ["connections", "Подключения"],
          ["balance", "Баланс"],
          ["purchases", "Покупки"],
        ]}
      />

      {tab === "overview" ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard label="Покупок" value={list.length} />
            <StatCard label="Завершённых покупок" value={completed} />
            <StatCard label="Активных лицензий" value={activeLicenses} />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Баланс</CardTitle>
            </CardHeader>
            <CardContent>
              {meLoading ? (
                <LoadingSpinner />
              ) : me ? (
                <div className="flex items-center gap-3">
                  <Wallet className="h-5 w-5 text-ok" />
                  <span className="text-2xl font-bold">{formatRub(me.balance.available)}</span>
                  <Link href="/account" onClick={() => setTab("balance")} className="text-sm text-accent-strong hover:underline">
                    Подробнее
                  </Link>
                </div>
              ) : null}
            </CardContent>
          </Card>

        </div>
      ) : null}

      {tab === "profile" ? (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Профиль</CardTitle>
            <CardDescription>Данные вашего аккаунта</CardDescription>
            {user?.username ? (
              <Link href={`/profile/${user.username}`} className="mt-1 inline-flex items-center gap-1.5 text-sm text-accent-strong hover:underline">
                <User className="h-4 w-4" />
                Публичный профиль
              </Link>
            ) : null}
          </CardHeader>
          <CardContent>
            {meLoading ? (
              <LoadingSpinner />
            ) : meError ? (
              <ErrorState error={meError} onRetry={() => refetchMe()} />
            ) : me ? (
              <div className="space-y-4">
                <dl className="space-y-3 text-sm">
                  <Row label="Имя пользователя" value={me.username} />
                  <Row label="Email" value={me.email} />
                  <Row label="Отображаемое имя" value={me.displayName || "—"} />
                  <Row label="Роль" value={ROLE_LABELS[me.role] ?? me.role} />
                  <Row
                    label="Дата регистрации"
                    value={me.createdAt ? formatDate(me.createdAt) : "—"}
                  />
                  <Row label="Баланс" value={formatRub(me.balance.available)} />
                </dl>
                <p className="text-xs text-content-muted">
                  Имя пользователя, email и роль изменить нельзя.
                </p>
                <ProfileEditForm displayName={me.displayName ?? ""} avatar={me.avatar ?? ""} />
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {tab === "connections" ? (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Link2 className="h-5 w-5 text-accent" /> Связанные аккаунты
            </CardTitle>
            <CardDescription>Внешние провайдеры, привязанные к аккаунту</CardDescription>
          </CardHeader>
          <CardContent>
            {identities && identities.length > 0 ? (
              <ul className="space-y-2 text-sm">
                {identities.map((i) => (
                  <li
                    key={i.id}
                    className="flex items-center justify-between p-3 border border-line rounded-md"
                  >
                    <span className="font-medium capitalize">{i.provider}</span>
                    <span className="text-content-muted font-mono text-xs">
                      {i.providerAccountId.slice(0, 12)}…
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-content-secondary">
                Внешние аккаунты не привязаны. Можно войти через Discord — он привяжется
                автоматически.
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}

      {tab === "balance" ? (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-ok" /> Баланс
            </CardTitle>
            <CardDescription>Средства для покупок на Маркетплейсе</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {meLoading ? (
              <LoadingSpinner />
            ) : me ? (
              <>
                <div className="text-3xl font-bold">{formatRub(me.balance.available)}</div>
                <p className="text-sm text-content-secondary">
                  Пополнение баланса пока недоступно. Баланс увеличивается автоматически при
                  возвратах и бонусных начислениях.
                </p>
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {/* Покупки: постоянный блок (E2E и пользователи ждут его на /account) */}
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>Мои покупки</CardTitle>
          <CardDescription>Лицензии выдаются после подтверждения оплаты</CardDescription>
        </CardHeader>
        <CardContent>
          <PurchasesList
            list={tab === "purchases" || tab === "profile" ? list : list.slice(0, 3)}
            loading={purchasesLoading}
            error={purchasesError}
            onRetry={() => refetchPurchases()}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-content-secondary">{label}</p>
        <p className="text-2xl font-bold mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line pb-2 last:border-0">
      <dt className="text-content-secondary">{label}</dt>
      <dd className="font-medium text-right break-all">{value}</dd>
    </div>
  );
}

// ---------- Purchases history (G-004) ----------
function PurchasesList({
  list,
  loading,
  error,
  onRetry,
  onOpenAll,
}: {
  list: Purchase[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onOpenAll?: () => void;
}) {
  if (loading) return <LoadingSpinner label="Загрузка покупок..." />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (list.length === 0) {
    return (
      <EmptyState
        icon={<ShoppingBag className="h-12 w-12 text-content-muted mx-auto mb-4" />}
        title="У вас пока нет покупок"
        description="Выберите ресурс на Маркетплейсе — лицензия выдаётся сразу после оплаты"
        action={
          <div className="flex items-center justify-center gap-3">
            <Link href="/resources">
              <Button variant="primary" size="sm">
                На Маркетплейс
              </Button>
            </Link>
            {onOpenAll ? (
              <Button variant="ghost" size="sm" onClick={onOpenAll}>
                Открыть все покупки
              </Button>
            ) : null}
          </div>
        }
      />
    );
  }
  return (
    <div className="space-y-3">
      {list.map((p) => (
        <div
          key={p.id}
          className="p-4 rounded-lg border border-line bg-surface-raised space-y-3"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <Link
                href={`/resources/${p.resource.slug}`}
                className="font-semibold hover:text-accent-strong"
              >
                {p.resource.title}
              </Link>
              <p className="text-sm text-content-secondary">
                {typeLabel(p.resource.type)} · {formatDate(p.createdAt)}
                {p.version ? ` · v${p.version.version}` : ""}
              </p>
            </div>
            <div className="text-right space-y-1">
              <div className="font-semibold">{formatRub(p.priceSnapshot)}</div>
              <StatusBadge status={p.status} />
            </div>
          </div>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-sm text-content-secondary">
              {p.license ? (
                <>
                  Лицензия: <StatusBadge status={p.license.status} />
                </>
              ) : (
                <span className="text-content-muted">Лицензия не выдана</span>
              )}
            </div>
            {p.status === "COMPLETED" ? (
              <DisputeDialog targetType="PURCHASE" purchaseId={p.id} />
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- B-002: profile editing (displayName + avatar only) ----------
function ProfileEditForm({ displayName, avatar }: { displayName: string; avatar: string }) {
  const qc = useQueryClient();
  const setUser = useAuthStore((s) => s.setUser);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(displayName);
  const [avatarUrl, setAvatarUrl] = useState(avatar);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      patchProfile({
        ...(name !== displayName ? { displayName: name.trim() } : {}),
        ...(avatarUrl !== avatar ? { avatar: avatarUrl.trim() } : {}),
      }),
    onSuccess: async () => {
      setError(null);
      // Reload the profile so both the store and the balance stay in sync.
      const me = await fetchMe();
      setUser(me);
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["me"] });
    },
    onError: (e) => setError(getErrorMessage(e, "Не удалось сохранить профиль")),
  });

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="mr-2 h-4 w-4" />
        Редактировать профиль
      </Button>
    );
  }

  return (
    <div className="p-4 rounded-lg border border-line bg-surface-raised space-y-3">
      <p className="text-sm font-medium">Редактирование профиля</p>
      <div>
        <label htmlFor="displayName" className="text-sm text-content-secondary">
          Отображаемое имя
        </label>
        <Input
          id="displayName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Как вас видят другие"
          className="mt-1"
          disabled={mutation.isPending}
        />
      </div>
      <div>
        <label htmlFor="avatarUrl" className="text-sm text-content-secondary">
          Ссылка на аватар
        </label>
        <Input
          id="avatarUrl"
          value={avatarUrl}
          onChange={(e) => setAvatarUrl(e.target.value)}
          placeholder="https://cdn.example.com/avatar.png"
          className="mt-1"
          disabled={mutation.isPending}
        />
      </div>
      {error ? <ErrorText message={error} /> : null}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={mutation.isPending || (name === displayName && avatarUrl === avatar)}
          onClick={() => mutation.mutate()}
        >
          <Check className="mr-1 h-4 w-4" />
          {mutation.isPending ? "Сохранение..." : "Сохранить"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={mutation.isPending}
          onClick={() => {
            setOpen(false);
            setName(displayName);
            setAvatarUrl(avatar);
            setError(null);
          }}
        >
          <X className="mr-1 h-4 w-4" />
          Отмена
        </Button>
      </div>
    </div>
  );
}
