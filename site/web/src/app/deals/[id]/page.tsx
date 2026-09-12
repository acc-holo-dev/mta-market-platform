// PLAN-018 L: Deal room detail — статусы-степпер, действия по ролям,
// переписка и доказательства (Wave-6 frontend). Роутер /deals/:id может
// отвечать 404 (аутсайдер ИЛИ модуль выключен) — оба случая честно
// показывают «Сделка не найдена».
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchDeal,
  fetchDealMessages,
  postDealMessage,
  fetchDealEvidence,
  postDealEvidence,
  transitionDeal,
  type DealRoom,
  type DealTransitionAction,
} from "@/lib/api/finance";
import { getErrorMessage, formatRub } from "@/lib/api-ext";
import { formatDate } from "@/lib/domain";
import { useAuthStore } from "@/store/auth";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { LoadingSpinner, ErrorState } from "@/components/ui/States";
import { MessageThread } from "@/components/MessageThread";
import { useFocusTrap, rememberTrigger, restoreTrigger } from "@/components/ui/focusTrap";

const DEAL_STATUS_LABELS: Record<string, string> = {
  CREATED: "Создана",
  FUNDED: "Оплачена",
  DELIVERING: "Доставка",
  DELIVERED: "Доставлена",
  ACCEPTED: "Принята",
  DISPUTED: "Оспорена",
  RESOLVED: "Решена",
  CLOSED: "Закрыта",
};

/** Линейная часть жизненного цикла; DISPUTED — ветка, RESOLVED/CLOSED — финалы. */
const DEAL_STEPS: string[] = ["CREATED", "FUNDED", "DELIVERING", "DELIVERED", "ACCEPTED"];

const PARTY_ROLE_LABELS: Record<string, string> = {
  BUYER: "Покупатель",
  SELLER: "Продавец",
  ADMIN: "Администратор",
  MODERATOR: "Модератор",
};

const EVIDENCE_KIND_LABELS: Record<string, string> = {
  MESSAGE: "Сообщение",
  FILE: "Файл",
  DELIVERY: "Доставка",
  DISPUTE_EVENT: "Событие спора",
};

export default function DealDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const { user } = useAuthStore();

  const { data: room, isLoading, error, refetch } = useQuery({
    queryKey: ["deal", id],
    queryFn: () => fetchDeal(id),
    retry: false,
  });

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-12">
        <LoadingSpinner label="Загрузка сделки..." />
      </div>
    );
  }

  const errorStatus = (error as { response?: { status?: number } } | null)?.response?.status;

  if (error || !room) {
    // 404 = аутсайдер или выключенный модуль — честный единый текст.
    if (errorStatus === 404) {
      return (
        <div className="container mx-auto px-4 py-12">
          <Card className="border-bad/40 bg-bad-soft">
            <CardHeader>
              <CardTitle className="text-bad">Сделка не найдена</CardTitle>
              <CardDescription>
                Сделка не существует или у вас нет к ней доступа.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/deals">
                <Button variant="outline" size="sm">
                  К списку сделок
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      );
    }
    return (
      <div className="container mx-auto px-4 py-12">
        <ErrorState error={error} onRetry={() => refetch()} />
      </div>
    );
  }

  const myRole = resolveMyRole(room, user?.id ?? null);
  const isAdmin = user?.role === "ADMIN" || user?.role === "MODERATOR";
  const status = room.status ?? "";

  return (
    <div className="container mx-auto max-w-3xl px-4 py-12">
      <div className="mb-4">
        <Link
          href="/deals"
          className="text-sm text-content-secondary transition-colors duration-fast hover:text-content"
        >
          ← Все сделки
        </Link>
      </div>

      {/* Шапка комнаты */}
      <Card className="mb-6 shadow-card">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <CardTitle>{room.title ?? `Сделка #${room.id.slice(0, 8)}`}</CardTitle>
              <CardDescription className="tabular-nums">
                #{room.id.slice(0, 8)} · {formatRub(room.amountMinor)}
                {room.createdAt ? ` · ${formatDate(room.createdAt)}` : ""}
              </CardDescription>
            </div>
            <StatusBadge status={status}>
              {DEAL_STATUS_LABELS[status] ?? status ?? "—"}
            </StatusBadge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <DealStepper status={status} />

          {room.parties.length > 0 ? (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wide text-content-muted">
                Участники
              </p>
              {room.parties.map((party, i) => (
                <p key={`${party.userId ?? "party"}-${i}`} className="text-sm text-content-secondary">
                  {PARTY_ROLE_LABELS[(party.role ?? "").toUpperCase()] ?? party.role ?? "Участник"}
                  : {party.displayName ?? party.username ?? `#${(party.userId ?? "").slice(0, 8)}`}
                </p>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Действия по роли */}
      {myRole || (isAdmin && !myRole) ? (
        <DealActionsCard
          dealId={room.id}
          status={status}
          myRole={myRole}
          isAdmin={isAdmin && !myRole}
        />
      ) : null}

      {/* Переписка */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Сообщения сделки</CardTitle>
          <CardDescription>Обсуждение с контрагентом — обе стороны видят переписку</CardDescription>
        </CardHeader>
        <CardContent>
          <MessagesSection dealId={room.id} currentUserId={user?.id ?? null} />
        </CardContent>
      </Card>

      {/* Доказательства */}
      <EvidenceSection dealId={room.id} canWrite={Boolean(myRole) || isAdmin} />
    </div>
  );
}

function resolveMyRole(
  room: DealRoom,
  myUserId: string | null
): "buyer" | "seller" | null {
  if (!myUserId) return null;
  if (room.buyerId === myUserId) return "buyer";
  if (room.sellerId === myUserId) return "seller";
  for (const party of room.parties) {
    if (party.userId === myUserId) {
      const role = (party.role ?? "").toLowerCase();
      if (role.includes("buy")) return "buyer";
      if (role.includes("sell")) return "seller";
    }
  }
  return null;
}

// ---------- Статусный степпер (CREATED→...→ACCEPTED, DISPUTED-ветка) ----------

function DealStepper({ status }: { status: string }) {
  const stepIdx = DEAL_STEPS.indexOf(status);
  const reachedAll = status === "RESOLVED" || status === "CLOSED" || status === "DISPUTED";
  return (
    <div className="flex items-center gap-1 text-xs flex-wrap">
      {DEAL_STEPS.map((step, i) => {
        const reached = reachedAll || (stepIdx >= 0 && i <= stepIdx);
        return (
          <span
            key={step}
            className={`rounded-pill px-2.5 py-1 text-xs font-medium ${
              reached ? "bg-accent-soft text-accent-strong" : "bg-surface-inset text-content-muted"
            }`}
          >
            {DEAL_STATUS_LABELS[step] ?? step}
          </span>
        );
      })}
      {status === "DISPUTED" ? (
        <span className="rounded-pill border border-bad/30 bg-bad/10 px-2.5 py-1 text-xs font-medium text-bad">
          Оспорена
        </span>
      ) : null}
      {status === "RESOLVED" || status === "CLOSED" ? (
        <StatusBadge status={status}>{DEAL_STATUS_LABELS[status]}</StatusBadge>
      ) : null}
    </div>
  );
}

// ---------- Действия по роли ----------

type ActionSpec = {
  label: string;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  /** Открытие спора требует причину (UI-гейт, сервер тоже проверяет). */
  reasonLabel?: string;
  reasonRequired?: boolean;
  /** mark_funded: необязательная привязка к заказу. */
  orderIdLabel?: string;
  /** resolve/close: примечание администратора. */
  noteLabel?: string;
};

const ACTION_SPECS: Record<DealTransitionAction, ActionSpec> = {
  mark_funded: {
    label: "Подтвердить оплату",
    title: "Подтвердить оплату",
    description:
      "Подтвердите, что средства отправлены контрагенту. Укажите ID заказа при наличии.",
    confirmLabel: "Средства отправлены",
    orderIdLabel: "ID заказа (необязательно)",
  },
  start_delivery: {
    label: "Начать доставку",
    title: "Начать доставку",
    description: "Статус сделки изменится на «Доставка».",
    confirmLabel: "Начать доставку",
  },
  mark_delivered: {
    label: "Отметить доставленным",
    title: "Отметить доставленным",
    description: "Покупатель получит возможность принять сделку.",
    confirmLabel: "Доставлено",
  },
  accept: {
    label: "Принять сделку",
    title: "Принять сделку",
    description: "Подтвердите приёмку — сделка перейдёт в статус «Принята».",
    confirmLabel: "Принять",
  },
  open_dispute: {
    label: "Открыть спор",
    title: "Открыть спор",
    description: "Опишите причину спора — её увидит контрагент и модерация.",
    confirmLabel: "Открыть спор",
    danger: true,
    reasonLabel: "Причина спора",
    reasonRequired: true,
  },
  resolve: {
    label: "Решить спор",
    title: "Решить спор",
    description: "Административное решение по спору (доступно только модерации).",
    confirmLabel: "Решить",
    reasonLabel: "Примечание к решению",
  },
  close: {
    label: "Закрыть сделку",
    title: "Закрыть сделку",
    description: "Сделка будет закрыта окончательно.",
    confirmLabel: "Закрыть",
    noteLabel: "Примечание (необязательно)",
  },
};

/** Роль-гейты дублируют серверные правила: buyer — mark_funded/accept/open_dispute;
 *  seller — start_delivery/mark_delivered/open_dispute; admin (не участник) — resolve/close. */
function availableActions(
  status: string,
  myRole: "buyer" | "seller" | null,
  isAdmin: boolean
): DealTransitionAction[] {
  const actions: DealTransitionAction[] = [];
  if (myRole === "buyer") {
    if (status === "CREATED") actions.push("mark_funded");
    if (status === "DELIVERED") actions.push("accept");
  }
  if (myRole === "seller") {
    if (status === "FUNDED") actions.push("start_delivery");
    if (status === "DELIVERING") actions.push("mark_delivered");
  }
  if (
    (myRole === "buyer" || myRole === "seller") &&
    ["CREATED", "FUNDED", "DELIVERING", "DELIVERED"].includes(status)
  ) {
    actions.push("open_dispute");
  }
  if (isAdmin && !myRole) {
    if (status === "DISPUTED") actions.push("resolve");
    if (status === "ACCEPTED" || status === "RESOLVED") actions.push("close");
  }
  return actions;
}

function DealActionsCard({
  dealId,
  status,
  myRole,
  isAdmin,
}: {
  dealId: string;
  status: string;
  myRole: "buyer" | "seller" | null;
  isAdmin: boolean;
}) {
  const qc = useQueryClient();
  const [pendingAction, setPendingAction] = useState<DealTransitionAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const transition = useMutation({
    mutationFn: (input: { action: DealTransitionAction; reason?: string; note?: string; orderId?: string }) =>
      transitionDeal(dealId, input),
    onSuccess: () => {
      setError(null);
      setPendingAction(null);
      qc.invalidateQueries({ queryKey: ["deal", dealId] });
      qc.invalidateQueries({ queryKey: ["deals", "list"] });
      qc.invalidateQueries({ queryKey: ["deal-evidence", dealId] });
    },
    onError: (e) => {
      setError(getErrorMessage(e, "Действие не выполнено"));
    },
  });

  const actions = useMemo(() => availableActions(status, myRole, isAdmin), [status, myRole, isAdmin]);

  if (actions.length === 0 && !transition.isPending) return null;

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="text-lg">Действия</CardTitle>
        <CardDescription>
          {myRole === "buyer"
            ? "Ваша роль: покупатель"
            : myRole === "seller"
              ? "Ваша роль: продавец"
              : "Ваша роль: модерация"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? <p className="text-sm text-bad">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => {
            const spec = ACTION_SPECS[action];
            return (
              <Button
                key={action}
                variant={spec.danger ? "outline" : "primary"}
                size="sm"
                disabled={transition.isPending}
                onClick={() => setPendingAction(action)}
              >
                {spec.label}
              </Button>
            );
          })}
        </div>
      </CardContent>

      {pendingAction ? (
        <DealActionDialog
          key={pendingAction}
          spec={ACTION_SPECS[pendingAction]}
          busy={transition.isPending}
          error={error}
          onConfirm={(payload) => transition.mutate({ action: pendingAction, ...payload })}
          onCancel={() => {
            setPendingAction(null);
            setError(null);
          }}
        />
      ) : null}
    </Card>
  );
}

function DealActionDialog({
  spec,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  spec: ActionSpec;
  busy: boolean;
  /** Ошибка последней попытки — диалог остаётся открытым с введённым текстом. */
  error?: string | null;
  onConfirm: (payload: { reason?: string; note?: string; orderId?: string }) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [orderId, setOrderId] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    rememberTrigger(document.activeElement as HTMLElement | null);
  }, []);
  useFocusTrap(true, dialogRef, { onEscape: onCancel, autofocus: true });
  useEffect(() => () => restoreTrigger(), []);

  const confirmDisabled = Boolean(spec.reasonRequired) && reason.trim().length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 p-4"
      onClick={() => {
        if (!busy) onCancel();
      }}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={spec.title}
        className="w-full max-w-md rounded-card border border-line bg-surface p-6 space-y-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-content">{spec.title}</h2>
        <p className="text-sm text-content-secondary">{spec.description}</p>
        {spec.reasonLabel ? (
          <div className="space-y-1.5">
            <label
              htmlFor="deal-action-reason"
              className="block text-xs font-semibold uppercase tracking-wide text-content-secondary"
            >
              {spec.reasonLabel}
              {spec.reasonRequired ? " *" : ""}
            </label>
            <Textarea
              id="deal-action-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={spec.reasonRequired ? "Опишите причину" : "Необязательно"}
              rows={3}
            />
          </div>
        ) : null}
        {spec.orderIdLabel ? (
          <div className="space-y-1.5">
            <label
              htmlFor="deal-action-order"
              className="block text-xs font-semibold uppercase tracking-wide text-content-secondary"
            >
              {spec.orderIdLabel}
            </label>
            <Input
              id="deal-action-order"
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              placeholder="ID заказа"
            />
          </div>
        ) : null}
        {spec.noteLabel ? (
          <div className="space-y-1.5">
            <label
              htmlFor="deal-action-note"
              className="block text-xs font-semibold uppercase tracking-wide text-content-secondary"
            >
              {spec.noteLabel}
            </label>
            <Input
              id="deal-action-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        ) : null}
        {error ? <p className="text-sm text-bad">{error}</p> : null}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            Отмена
          </Button>
          <Button
            variant={spec.danger ? "danger" : "primary"}
            size="sm"
            disabled={busy || confirmDisabled}
            onClick={() =>
              onConfirm({
                ...(reason.trim() ? { reason: reason.trim() } : {}),
                ...(note.trim() ? { note: note.trim() } : {}),
                ...(orderId.trim() ? { orderId: orderId.trim() } : {}),
              })
            }
          >
            {busy ? "..." : spec.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------- Сообщения сделки ----------

function MessagesSection({
  dealId,
  currentUserId,
}: {
  dealId: string;
  currentUserId: string | null;
}) {
  const { data: messages, isLoading } = useQuery({
    queryKey: ["deal-messages", dealId],
    queryFn: () => fetchDealMessages(dealId),
  });

  // MessageThread's Message requires createdAt: string / authorId?: string —
  // сузить defensively-normalized поля до его ожиданий.
  const threadMessages = useMemo(
    () =>
      messages?.map((m) => ({
        id: m.id,
        body: m.body,
        createdAt: m.createdAt ?? "",
        ...(m.authorId != null ? { authorId: m.authorId } : {}),
      })),
    [messages]
  );

  return (
    <MessageThread
      messageIdPrefix="deal-messages"
      messages={threadMessages}
      isLoading={isLoading}
      currentUserId={currentUserId}
      sendFn={(body) => postDealMessage(dealId, body)}
    />
  );
}

// ---------- Доказательства ----------

const EVIDENCE_KINDS: [string, string][] = [
  ["MESSAGE", "Сообщение"],
  ["FILE", "Файл"],
  ["DELIVERY", "Доставка"],
  ["DISPUTE_EVENT", "Событие спора"],
];

function EvidenceSection({ dealId, canWrite }: { dealId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState("MESSAGE");
  const [url, setUrl] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  const { data: evidence, isLoading, error: loadError, refetch } = useQuery({
    queryKey: ["deal-evidence", dealId],
    queryFn: () => fetchDealEvidence(dealId),
  });

  const mutation = useMutation({
    mutationFn: () =>
      postDealEvidence(dealId, {
        kind,
        ...(url.trim() ? { url: url.trim() } : {}),
        ...(body.trim() ? { body: body.trim() } : {}),
      }),
    onSuccess: () => {
      setError(null);
      setUrl("");
      setBody("");
      qc.invalidateQueries({ queryKey: ["deal-evidence", dealId] });
    },
    onError: (e) => setError(getErrorMessage(e, "Не удалось добавить доказательство")),
  });

  const valid = url.trim().length > 0 || body.trim().length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Доказательства</CardTitle>
        <CardDescription>
          Материалы по сделке: файлы, delivery-события и переписка для модерации
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadError ? <ErrorState error={loadError} onRetry={() => refetch()} /> : null}

        {canWrite ? (
          <div className="space-y-3 rounded-card border border-line bg-surface-raised p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <label
                  htmlFor="evidence-kind"
                  className="block text-xs font-semibold uppercase tracking-wide text-content-secondary"
                >
                  Тип
                </label>
                <Select id="evidence-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
                  {EVIDENCE_KINDS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <label
                  htmlFor="evidence-url"
                  className="block text-xs font-semibold uppercase tracking-wide text-content-secondary"
                >
                  Ссылка на файл (необязательно)
                </label>
                <Input
                  id="evidence-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://..."
                  type="url"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="evidence-body"
                className="block text-xs font-semibold uppercase tracking-wide text-content-secondary"
              >
                Пояснение (необязательно)
              </label>
              <Textarea
                id="evidence-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Что подтверждает этот материал?"
                rows={2}
              />
            </div>
            {error ? <p className="text-sm text-bad">{error}</p> : null}
            <Button
              size="sm"
              disabled={!valid || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? "Добавление..." : "Добавить"}
            </Button>
          </div>
        ) : null}

        {isLoading ? (
          <LoadingSpinner label="Загрузка доказательств..." />
        ) : (evidence ?? []).length === 0 ? (
          <p className="text-sm text-content-muted">Материалов пока нет.</p>
        ) : (
          <ul className="space-y-2">
            {(evidence ?? []).map((item) => (
              <li
                key={item.id}
                className="rounded-card border border-line bg-surface-raised p-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="rounded-pill border border-line bg-surface-hover px-2.5 py-0.5 text-xs font-medium text-content-secondary">
                    {EVIDENCE_KIND_LABELS[item.kind ?? ""] ?? item.kind ?? "—"}
                  </span>
                  <span className="text-xs text-content-muted">
                    {item.createdAt ? formatDate(item.createdAt) : ""}
                  </span>
                </div>
                {item.url ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block truncate text-accent-strong hover:underline"
                  >
                    {item.url}
                  </a>
                ) : null}
                {item.body ? (
                  <p className="mt-1 whitespace-pre-wrap text-content-secondary">{item.body}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}