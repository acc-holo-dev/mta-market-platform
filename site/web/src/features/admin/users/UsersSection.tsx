// PLAN-017 §36: пользователи — поиск/фильтры/пагинация + карточка пользователя
// (drawer) с вкладками Профиль/Активность/Идентичности/Ресурсы/Покупки/Модерация
// и действиями: приостановка/восстановление (диалог причины) и смена роли
// (select + подтверждение повышения + причина, 403/409 поверх getErrorMessage).
"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, X } from "lucide-react";
import {
  adminChangeUserRole,
  adminRestoreUser,
  adminSuspendUser,
  fetchAdminUser,
  fetchAdminUserActivity,
  fetchAdminUsers,
  formatRub,
  getErrorMessage,
  type AdminActivityEntry,
  type AdminUserRow,
} from "@/lib/api/admin";
import { useAuthStore } from "@/store/auth";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { Tabs } from "@/components/ui/Tabs";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { LoadingSpinner, EmptyState, ErrorState } from "@/components/ui/States";
import { AdminChip, UserStatusChip } from "@/components/admin/chips";
import {
  ROLE_RANK,
  USER_ROLE_FILTERS,
  USER_STATUS_FILTERS,
  formatDateTime,
  roleLabel,
  userStatusLabel,
} from "@/components/admin/labels";
import { AdminReasonDialog } from "@/components/admin/AdminReasonDialog";
import { TablePager } from "@/features/admin/shared/TablePager";
import { useDebouncedValue } from "@/features/admin/shared/useDebouncedValue";
import { pickNumber, pickString, type UnknownRow } from "@/features/admin/shared/fields";

const PAGE_LIMIT = 20;

// ---------- Ошибки смены роли (коды из контракта) ----------
const ROLE_CHANGE_ERROR_LABELS: Record<string, string> = {
  self_change_forbidden: "Нельзя изменить собственную роль.",
  last_superadmin: "Нельзя изменить роль последнего суперпользователя.",
  confirmation_required: "Требуется подтверждение операции.",
};

function humanizeAdminActionError(e: unknown, fallback: string): string {
  const raw = getErrorMessage(e, fallback);
  return ROLE_CHANGE_ERROR_LABELS[raw] ?? raw;
}

// ---------- Список ----------
export function UsersSection() {
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput.trim(), 350);
  const [status, setStatus] = useState("all");
  const [role, setRole] = useState("all");
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);

  // Фильтры сбрасывают страницу.
  useEffect(() => {
    setPage(1);
  }, [search, status, role]);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["admin", "users", { search, status, role, page }],
    queryFn: () =>
      fetchAdminUsers({
        search: search || undefined,
        status: status === "all" ? undefined : status,
        role: role === "all" ? undefined : role,
        page,
        limit: PAGE_LIMIT,
      }),
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });

  const rows: AdminUserRow[] = data?.users ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Пользователи</CardTitle>
        <CardDescription>Поиск, фильтры и карточка пользователя с действиями</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Email, username или имя..."
              aria-label="Поиск пользователей"
              className="pr-9"
            />
            <Search
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-muted"
              aria-hidden
            />
          </div>
          <div className="w-44">
            <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Фильтр статуса">
              {USER_STATUS_FILTERS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
          <div className="w-44">
            <Select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Фильтр роли">
              {USER_ROLE_FILTERS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {error ? <ErrorState error={error} onRetry={() => refetch()} /> : null}

        {isLoading ? (
          <LoadingSpinner label="Загрузка пользователей..." />
        ) : rows.length === 0 && !error ? (
          <EmptyState title="Пользователи не найдены" description="Измените поиск или фильтры" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-content-muted">
                  <th className="py-2 pr-3 font-semibold">Пользователь</th>
                  <th className="py-2 pr-3 font-semibold">Роль</th>
                  <th className="py-2 pr-3 font-semibold">Статус</th>
                  <th className="py-2 pr-3 font-semibold">Создан</th>
                  <th className="py-2 pr-3 font-semibold">Последний вход</th>
                  <th className="py-2 pr-3 font-semibold">Ресурсы</th>
                  <th className="py-2 pr-3 font-semibold">Покупки</th>
                  <th className="py-2 pr-3 font-semibold">
                    <span className="sr-only">Действия</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} className="border-b border-line/60 align-top">
                    <td className="py-2.5 pr-3">
                      <p className="font-medium">{u.displayName || u.username}</p>
                      <p className="text-xs text-content-muted">
                        @{u.username} · {u.email}
                      </p>
                      <p className="font-mono text-[11px] text-content-muted/70">{u.id}</p>
                    </td>
                    <td className="py-2.5 pr-3">{roleLabel(u.role)}</td>
                    <td className="py-2.5 pr-3">
                      <UserStatusChip status={u.status} />
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-content-secondary">{formatDateTime(u.createdAt)}</td>
                    <td className="py-2.5 pr-3 text-xs text-content-secondary">{formatDateTime(u.lastLoginAt)}</td>
                    <td className="py-2.5 pr-3 tabular-nums">{u.counts?.resources ?? "—"}</td>
                    <td className="py-2.5 pr-3 tabular-nums">{u.counts?.purchases ?? "—"}</td>
                    <td className="py-2.5 pr-3">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDetailId(detailId === u.id ? null : u.id)}
                      >
                        {detailId === u.id ? (
                          <>
                            <X className="h-4 w-4" aria-hidden /> Закрыть
                          </>
                        ) : (
                          "Открыть"
                        )}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <TablePager
          page={data?.page ?? page}
          limit={data?.limit ?? PAGE_LIMIT}
          total={data?.total ?? 0}
          onPage={setPage}
          disabled={isFetching}
        />
      </CardContent>

      {detailId ? <UserDetailPanel userId={detailId} onClose={() => setDetailId(null)} /> : null}
    </Card>
  );
}

// ---------- Esc-закрытие drawer (пока открыт без модального диалога) ----------
function DrawerEscClose({ onClose, enabled }: { onClose: () => void; enabled: boolean }) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled, onClose]);
  return null;
}

type UserDetail = Awaited<ReturnType<typeof fetchAdminUser>>;

// ---------- Drawer с деталями ----------
type DetailTab = "profile" | "activity" | "identities" | "resources" | "purchases" | "moderation";

const DETAIL_TABS: [DetailTab, string][] = [
  ["profile", "Профиль"],
  ["activity", "Активность"],
  ["identities", "Идентичности"],
  ["resources", "Ресурсы"],
  ["purchases", "Покупки"],
  ["moderation", "Модерация"],
];

function UserDetailPanel({ userId, onClose }: { userId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<DetailTab>("profile");

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "users", "detail", userId],
    queryFn: () => fetchAdminUser(userId),
    staleTime: 30_000,
  });

  const user = data?.user;

  // Диалог причины (suspend/restore).
  const [dialog, setDialog] = useState<"suspend" | "restore" | null>(null);
  const [reason, setReason] = useState("");
  const [confirmPrivileged, setConfirmPrivileged] = useState(false);

  useEffect(() => setConfirmPrivileged(false), [dialog]);

  const invalidateUser = () => {
    // Префикс ["admin", "users"] покрывает список, detail и активность.
    qc.invalidateQueries({ queryKey: ["admin", "users"] });
    qc.invalidateQueries({ queryKey: ["admin", "overview"] });
    qc.invalidateQueries({ queryKey: ["admin-stats"] });
  };

  const suspend = useMutation({
    mutationFn: (p: { reason: string; confirm?: boolean }) => adminSuspendUser(userId, p.reason, p.confirm),
    onSuccess: () => {
      setDialog(null);
      setReason("");
      invalidateUser();
    },
  });

  const restore = useMutation({
    mutationFn: (p: { reason: string }) => adminRestoreUser(userId, p.reason),
    onSuccess: () => {
      setDialog(null);
      setReason("");
      invalidateUser();
    },
  });

  const dialogBusy = suspend.isPending || restore.isPending;
  const dialogError =
    dialog === "suspend"
      ? suspend.error
        ? humanizeAdminActionError(suspend.error, "Не удалось приостановить пользователя")
        : null
      : dialog === "restore"
        ? restore.error
          ? humanizeAdminActionError(restore.error, "Не удалось восстановить пользователя")
          : null
        : null;

  const isPrivilegedTarget = user?.role === "ADMIN" || user?.role === "MODERATOR";
  const canSuspend = Boolean(user) && user?.status !== "SUSPENDED" && user?.status !== "BANNED";
  const canRestore = user?.status === "SUSPENDED" || user?.status === "BANNED";

  function openDialog(kind: "suspend" | "restore") {
    suspend.reset();
    restore.reset();
    setReason("");
    setDialog(kind);
  }

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      {/* Фон */}
      <div className="absolute inset-0 bg-background/80" onClick={onClose} aria-hidden />
      {/* Панель */}
      <aside
        className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col overflow-y-auto border-l border-line bg-surface shadow-raised"
        role="dialog"
        aria-modal="true"
        aria-label="Карточка пользователя"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-line bg-surface p-4">
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold">
              {user?.displayName || user?.username || "Пользователь"}
            </p>
            <p className="truncate text-xs text-content-muted">
              {user ? `@${user.username} · ${user.email}` : "—"}
            </p>
            <p className="font-mono text-[11px] text-content-muted/70">{userId}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Закрыть карточку">
            <X className="h-5 w-5" aria-hidden />
          </Button>
        </div>

        <div className="space-y-4 p-4">
          {isLoading ? <LoadingSpinner label="Загрузка карточки..." /> : null}
          {error ? <ErrorState error={error} onRetry={() => refetch()} /> : null}

          {user ? (
            <>
              {/* Действия */}
              <div className="space-y-3 rounded-card border border-line bg-surface-raised p-4">
                <div className="flex flex-wrap items-center gap-2">
                  {canSuspend ? (
                    <Button variant="danger" size="sm" onClick={() => openDialog("suspend")}>
                      Приостановить
                    </Button>
                  ) : null}
                  {canRestore ? (
                    <Button size="sm" onClick={() => openDialog("restore")}>
                      Восстановить
                    </Button>
                  ) : null}
                  <UserStatusChip status={user.status} />
                  <AdminChip tone="muted">{roleLabel(user.role)}</AdminChip>
                </div>
                <UserRoleChange userId={userId} user={user} onDone={invalidateUser} />
              </div>

              <Tabs value={tab} onChange={setTab} tabs={DETAIL_TABS} />

              {tab === "profile" ? <ProfileTab user={user} detail={data} /> : null}
              {tab === "activity" ? <ActivityTab userId={userId} /> : null}
              {tab === "identities" ? <IdentitiesTab detail={data} /> : null}
              {tab === "resources" ? <ResourcesTab detail={data} /> : null}
              {tab === "purchases" ? <PurchasesTab detail={data} /> : null}
              {tab === "moderation" ? <ModerationTab detail={data} /> : null}
            </>
          ) : null}
        </div>
      </aside>

      <DrawerEscClose onClose={onClose} enabled={dialog === null} />

      {/* Диалог причины */}
      <AdminReasonDialog
        open={dialog !== null}
        title={dialog === "suspend" ? "Приостановить пользователя" : "Восстановить пользователя"}
        description={
          dialog === "suspend"
            ? "Пользователь потеряет доступ к аккаунту. Причина фиксируется в журнале аудита."
            : "Доступ к аккаунту будет возвращён. Причина фиксируется в журнале аудита."
        }
        confirmLabel={dialog === "suspend" ? "Приостановить" : "Восстановить"}
        danger={dialog === "suspend"}
        busy={dialogBusy}
        reason={reason}
        onReasonChange={setReason}
        reasonPlaceholder="Причина (фиксируется в аудите)"
        extra={
          <>
            {dialog === "suspend" && isPrivilegedTarget ? (
              <label className="flex items-start gap-2 text-sm text-content-secondary">
                <input
                  type="checkbox"
                  checked={confirmPrivileged}
                  onChange={(e) => setConfirmPrivileged(e.target.checked)}
                  className="mt-0.5 h-4 w-4"
                />
                Это {user?.role === "ADMIN" ? "администратор" : "модератор"} — подтверждаю приостановку
              </label>
            ) : null}
            {dialogError ? (
              <p className="text-sm text-bad" role="alert">
                {dialogError}
              </p>
            ) : null}
          </>
        }
        confirmDisabled={dialog === "suspend" && isPrivilegedTarget && !confirmPrivileged}
        onConfirm={() => {
          if (dialog === "suspend") {
            suspend.mutate({
              reason: reason.trim() || "Приостановлено администратором",
              confirm: isPrivilegedTarget ? confirmPrivileged || undefined : undefined,
            });
          } else if (dialog === "restore") {
            restore.mutate({ reason: reason.trim() || "Восстановлено администратором" });
          }
        }}
        onCancel={() => setDialog(null)}
      />
    </div>
  );
}

// ---------- Вкладки ----------
function ProfileTab({ user, detail }: { user: AdminUserRow; detail: UserDetail | undefined }) {
  const rows: [string, React.ReactNode][] = [
    ["ID", <span key="id" className="font-mono text-xs">{user.id}</span>],
    ["Email", user.email],
    ["Username", `@${user.username}`],
    ["Отображаемое имя", user.displayName ?? "—"],
    ["Роль", roleLabel(user.role)],
    ["Статус", userStatusLabel(user.status)],
    ["Создан", formatDateTime(user.createdAt)],
    ["Последний вход", formatDateTime(user.lastLoginAt ?? detail?.lastLoginAt ?? null)],
    ["Активных сессий", detail?.sessionsCount ?? "—"],
    [
      "Счётчики",
      `ресурсов: ${user.counts?.resources ?? "—"} · покупок: ${user.counts?.purchases ?? "—"} · идентичностей: ${user.counts?.identities ?? "—"}`,
    ],
  ];
  return (
    <dl className="space-y-2 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[160px,1fr] gap-3 rounded-md border border-line p-2.5">
          <dt className="text-content-muted">{label}</dt>
          <dd className="text-content-secondary">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function formatDayLabel(day: string): string {
  if (day === "без-даты") return "Без даты";
  const d = new Date(`${day}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? day
    : d.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

function ActivityTab({ userId }: { userId: string }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin", "users", "activity", userId, 100],
    queryFn: () => fetchAdminUserActivity(userId, 100),
    staleTime: 30_000,
  });

  if (isLoading) return <LoadingSpinner label="Загрузка активности..." className="py-6" />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;

  const entries: AdminActivityEntry[] = data?.entries ?? [];

  const groups: [string, AdminActivityEntry[]][] = [];
  const byDay = new Map<string, AdminActivityEntry[]>();
  for (const entry of entries) {
    const day = (entry.at ?? "").slice(0, 10) || "без-даты";
    const list = byDay.get(day) ?? [];
    list.push(entry);
    byDay.set(day, list);
  }
  for (const [day, list] of byDay) groups.push([day, list]);

  if (entries.length === 0) {
    return <EmptyState title="Активности нет" description="События пользователя появятся здесь" />;
  }

  return (
    <div className="space-y-4">
      {groups.map(([day, dayEntries]) => (
        <div key={day}>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-content-muted">
            {formatDayLabel(day)}
          </p>
          <ul className="space-y-1.5">
            {dayEntries.map((entry, i) => (
              <li
                key={`${entry.at}-${i}`}
                className="flex flex-wrap items-baseline gap-x-2 rounded-md border border-line p-2.5 text-sm"
              >
                <span className="tabular-nums text-xs text-content-muted">
                  {(entry.at ?? "").slice(11, 16) || "—"}
                </span>
                <span className="min-w-0 flex-1 text-content-secondary">{entry.summary}</span>
                {entry.amountMinor != null ? (
                  <span className="tabular-nums text-xs text-content">{formatRub(entry.amountMinor)}</span>
                ) : null}
                {entry.refType ? <AdminChip tone="muted">{entry.refType}</AdminChip> : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function IdentitiesTab({ detail }: { detail: UserDetail | undefined }) {
  const identities = detail?.identities ?? [];
  if (identities.length === 0) return <EmptyState title="Внешних идентичностей нет" />;
  return (
    <ul className="space-y-1.5 text-sm">
      {identities.map((identity, i) => (
        <li
          key={`${identity.provider}-${identity.providerAccountId}-${i}`}
          className="rounded-md border border-line p-2.5"
        >
          <p className="font-medium">{identity.provider}</p>
          <p className="font-mono text-xs text-content-muted">{identity.providerAccountId}</p>
          <p className="text-xs text-content-secondary">связана: {formatDateTime(identity.createdAt)}</p>
        </li>
      ))}
    </ul>
  );
}

function ResourcesTab({ detail }: { detail: UserDetail | undefined }) {
  const resources = detail?.resources ?? [];
  if (resources.length === 0) return <EmptyState title="Ресурсов нет" />;
  return (
    <ul className="space-y-1.5 text-sm">
      {resources.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-md border border-line p-2.5">
          <span className="font-medium">{r.title}</span>
          <span className="text-xs text-content-muted">/{r.slug}</span>
          <StatusBadge status={r.status} />
        </li>
      ))}
    </ul>
  );
}

function PurchasesTab({ detail }: { detail: UserDetail | undefined }) {
  const purchases: UnknownRow[] = (detail?.purchases ?? []) as UnknownRow[];
  if (purchases.length === 0) return <EmptyState title="Покупок нет" />;
  return (
    <ul className="space-y-1.5 text-sm">
      {purchases.map((p, i) => {
        const id = pickString(p, ["id", "purchaseId"]);
        const title = pickString(p, ["resourceTitle", "title", "serviceTitle"]);
        const status = pickString(p, ["status"]);
        const createdAt = pickString(p, ["createdAt", "at"]);
        const amountMinor = pickNumber(p, ["amountMinor", "amount", "priceMinor", "price"]);
        return (
          <li key={id ?? `purchase-${i}`} className="rounded-md border border-line p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-content-muted">{id ? id.slice(0, 8) : "—"}</span>
              {status ? <StatusBadge status={status} /> : null}
              {title ? <span className="font-medium">{title}</span> : null}
              {amountMinor != null ? (
                <span className="tabular-nums text-xs text-content">{formatRub(amountMinor)}</span>
              ) : null}
            </div>
            <p className="mt-0.5 text-xs text-content-secondary">{formatDateTime(createdAt)}</p>
          </li>
        );
      })}
    </ul>
  );
}

function ModerationTab({ detail }: { detail: UserDetail | undefined }) {
  const history: UnknownRow[] = (detail?.moderationHistory ?? []) as UnknownRow[];
  if (history.length === 0) return <EmptyState title="Истории модерации нет" />;
  return (
    <ul className="space-y-1.5 text-sm">
      {history.map((entry, i) => {
        const kind = pickString(entry, ["type", "action"]) ?? "событие";
        const at = pickString(entry, ["at", "createdAt"]);
        const summary = pickString(entry, ["summary", "reason"]);
        return (
          <li key={`mod-${i}`} className="rounded-md border border-line p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <AdminChip tone="muted">{kind}</AdminChip>
              <span className="text-xs text-content-secondary">{formatDateTime(at)}</span>
            </div>
            {summary ? <p className="mt-1 text-content-secondary">{summary}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

// ---------- Смена роли ----------
function UserRoleChange({
  userId,
  user,
  onDone,
}: {
  userId: string;
  user: AdminUserRow;
  onDone: () => void;
}) {
  const me = useAuthStore((s) => s.user);
  const isSelf = me?.id === userId;

  const [role, setRole] = useState(user.role);
  const [confirm, setConfirm] = useState(false);
  const [reason, setReason] = useState("");

  // При смене пользователя — сброс локального выбора.
  useEffect(() => {
    setRole(user.role);
    setConfirm(false);
    setReason("");
  }, [user.id, user.role]);

  const escalated = (ROLE_RANK[role] ?? 0) > (ROLE_RANK[user.role] ?? 0);
  const needConfirm = escalated || role === "ADMIN";
  const changed = role !== user.role;

  const roleChange = useMutation({
    mutationFn: () =>
      adminChangeUserRole(userId, role, {
        confirm: confirm || undefined,
        reason: reason.trim() || undefined,
      }),
    onSuccess: () => {
      setConfirm(false);
      setReason("");
      onDone();
    },
  });

  return (
    <div className="space-y-2 border-t border-line pt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-content-muted">Смена роли</p>
      {isSelf ? (
        <p className="text-xs text-content-muted">Собственную роль изменить нельзя (self_change_forbidden).</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-48">
              <Select value={role} onChange={(e) => setRole(e.target.value)} aria-label="Новая роль">
                {USER_ROLE_FILTERS.filter(([value]) => value !== "all").map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <p className="text-sm text-content-secondary">
              Роль: <span className="font-medium text-content">{roleLabel(user.role)}</span>
              {changed ? (
                <>
                  {" → "}
                  <span className="font-medium text-accent">{roleLabel(role)}</span>
                </>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Причина (необязательно)"
              aria-label="Причина смены роли"
              className="min-w-[220px] flex-1"
            />
            <label className="flex items-center gap-2 text-sm text-content-secondary">
              <input
                type="checkbox"
                checked={confirm}
                onChange={(e) => setConfirm(e.target.checked)}
                className="h-4 w-4"
              />
              Подтверждаю изменение роли{needConfirm ? " (обязательно при повышении)" : ""}
            </label>
          </div>
          {roleChange.error ? (
            <p className="text-sm text-bad" role="alert">
              {humanizeAdminActionError(roleChange.error, "Не удалось изменить роль")}
            </p>
          ) : null}
          <Button
            size="sm"
            disabled={!changed || (needConfirm && !confirm) || roleChange.isPending}
            onClick={() => roleChange.mutate()}
          >
            {roleChange.isPending ? "Применяю..." : "Применить смену роли"}
          </Button>
        </>
      )}
    </div>
  );
}