"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchMyServiceOrders,
  serviceOrderAction,
  postServiceOrderMessage,
  formatRub,
  getErrorMessage,
  type ServiceOrder,
} from "@/lib/api-ext";
import { useAuthStore } from "@/store/auth";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { LoadingSpinner, EmptyState, ErrorState } from "@/components/ui/States";
import { DisputeDialog } from "@/components/disputes/DisputeDialog";
import { MessageThread } from "@/components/MessageThread";
import { ChevronDown, ChevronUp } from "lucide-react";

const STEPS = ["PENDING", "IN_PROGRESS", "DELIVERED", "ACCEPTED", "CLOSED"];

export default function ServiceOrdersPage() {
  const { accessToken } = useAuthStore();
  const {
    data,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["my-service-orders"],
    queryFn: fetchMyServiceOrders,
    enabled: accessToken !== null,
  });

  const orders: ServiceOrder[] = data?.data ?? [];

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">Мои заказы услуг</h1>
        <p className="text-lg text-slate-600 dark:text-slate-400">
          Статусы, приёмка и споры по заказам услуг
        </p>
      </div>

      {isLoading ? (
        <LoadingSpinner label="Загрузка заказов..." />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : orders.length === 0 ? (
        <EmptyState title="Заказов пока нет" description="Закажите услугу на Маркетплейсе" />
      ) : (
        <div className="space-y-4">
          {orders.map((o) => (
            <ServiceOrderCard key={o.id} order={o} />
          ))}
        </div>
      )}
    </div>
  );
}

function ServiceOrderCard({ order: o }: { order: ServiceOrder }) {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const [expanded, setExpanded] = useState(false);
  const [revisionReason, setRevisionReason] = useState("");
  const [showRevision, setShowRevision] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const action = useMutation({
    mutationFn: ({ act, body }: { act: string; body?: Record<string, unknown> }) =>
      serviceOrderAction(o.id, act, body),
    onSuccess: () => {
      setError(null);
      setShowRevision(false);
      setRevisionReason("");
      qc.invalidateQueries({ queryKey: ["my-service-orders"] });
    },
    onError: (e) => setError(getErrorMessage(e, "Действие не выполнено")),
  });

  const idx = STEPS.indexOf(o.status);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-base">{o.service.title}</CardTitle>
            <CardDescription>
              {formatRub(o.finalPrice)} · {new Date(o.createdAt).toLocaleDateString("ru-RU")} · #
              {o.id.slice(0, 8)}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={o.status} />
            <button onClick={() => setExpanded((v) => !v)} aria-label="Подробнее">
              {expanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status timeline */}
        <div className="flex items-center gap-1 text-xs flex-wrap">
          {STEPS.map((step, i) => (
            <span
              key={step}
              className={`px-2 py-0.5 rounded ${
                idx >= 0 && i <= idx
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300"
                  : "bg-slate-100 text-slate-400 dark:bg-slate-800"
              }`}
            >
              {step}
            </span>
          ))}
          {o.status === "CANCELLED" || o.status === "DISPUTED" ? (
            <StatusBadge status={o.status} />
          ) : null}
        </div>

        <div className="flex gap-2 flex-wrap">
          {o.status === "DELIVERED" ? (
            <Button size="sm" disabled={action.isPending} onClick={() => action.mutate({ act: "accept" })}>
              Принять
            </Button>
          ) : null}
          {o.status === "DELIVERED" || o.status === "ACCEPTED" || o.status === "IN_PROGRESS" ? (
            <Button variant="outline" size="sm" onClick={() => setShowRevision((v) => !v)}>
              Запросить правку
            </Button>
          ) : null}
          {o.status !== "CLOSED" && o.status !== "CANCELLED" && o.status !== "DISPUTED" ? (
            <DisputeDialog targetType="SERVICE_PURCHASE" servicePurchaseId={o.id} />
          ) : null}
          {o.status === "PENDING" ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={action.isPending}
              onClick={() => action.mutate({ act: "cancel" })}
            >
              Отменить
            </Button>
          ) : null}
        </div>

        {showRevision ? (
          <div className="space-y-2">
            <Input
              value={revisionReason}
              onChange={(e) => setRevisionReason(e.target.value)}
              placeholder="Что нужно исправить?"
            />
            <Button
              size="sm"
              disabled={!revisionReason.trim() || action.isPending}
              onClick={() => action.mutate({ act: "revision", body: { reason: revisionReason } })}
            >
              Отправить правку
            </Button>
          </div>
        ) : null}

        {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

        {expanded ? (
          <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
            <p className="text-sm font-medium mb-2">Сообщения по заказу</p>
            {o.status !== "DISPUTED" ? (
              <MessageThread
                messageIdPrefix={`service-order-${o.id}`}
                sendFn={(body) => postServiceOrderMessage(o.id, body)}
                currentUserId={user?.id ?? null}
              />
            ) : (
              <p className="text-sm text-slate-500">
                Заказ оспорен — переписка ведётся в разделе споров.
              </p>
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
