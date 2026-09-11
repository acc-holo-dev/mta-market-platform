"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  fetchService,
  orderService,
  formatRub,
  getErrorMessage,
} from "@/lib/api-ext";
import { useAuthStore } from "@/store/auth";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Wrench, Clock, ListChecks } from "lucide-react";

export default function ServiceDetailPage() {
  const params = useParams();
  const slug = params.slug as string;
  const { accessToken } = useAuthStore();

  const { data: service, isLoading, error } = useQuery({
    queryKey: ["service", slug],
    queryFn: () => fetchService(slug),
  });

  const [buyerNotes, setBuyerNotes] = useState("");
  const [orderResult, setOrderResult] = useState<string | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);

  const orderMutation = useMutation({
    mutationFn: () => orderService(slug, buyerNotes.trim() || undefined),
    onSuccess: (data) => {
      setOrderResult(
        `Заказ создан (статус ${data.status}, ${formatRub(data.finalPrice)}). Заказ #${data.servicePurchaseId.slice(0, 8)} — см. «Мои заказы услуг».`
      );
      setOrderError(null);
    },
    onError: (e) => {
      setOrderResult(null);
      setOrderError(getErrorMessage(e, "Не удалось оформить заказ"));
    },
  });

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-12">
        <Card className="animate-pulse">
          <CardHeader>
            <div className="h-8 rounded bg-surface-hover w-1/2"></div>
          </CardHeader>
          <CardContent>
            <div className="h-40 rounded bg-surface-hover"></div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !service) {
    return (
      <div className="container mx-auto px-4 py-12">
        <Card className="border-bad/40 bg-bad-soft">
          <CardHeader>
            <CardTitle className="text-bad">Услуга не найдена</CardTitle>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-3xl flex items-center gap-3">
                <Wrench className="h-8 w-8 text-accent" /> {service.title}
              </CardTitle>
              <CardDescription className="text-base">{service.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-6 text-sm text-content-secondary">
                <span className="flex items-center gap-2">
                  <Clock className="h-4 w-4" /> Срок: {service.deliveryDays} дн.
                </span>
                <span className="rounded-pill bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent-strong">
                  {service.type}
                </span>
              </div>
              {service.requirements ? (
                <div className="rounded-card border border-line bg-surface-inset p-4">
                  <h4 className="font-semibold text-sm flex items-center gap-2 mb-1">
                    <ListChecks className="h-4 w-4" /> Что требуется от вас
                  </h4>
                  <p className="text-sm text-content-secondary whitespace-pre-wrap">
                    {service.requirements}
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar: order */}
        <div className="space-y-6">
          <Card className="shadow-raised">
            <CardHeader>
              <CardTitle>Заказать услугу</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-center py-4">
                <div className="text-4xl font-bold tabular-nums">{formatRub(service.price)}</div>
                <p className="text-sm text-content-secondary mt-1">
                  Выполнение до {service.deliveryDays} дн.
                </p>
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="buyer-notes"
                  className="block text-xs font-semibold uppercase tracking-wide text-content-secondary"
                >
                  Заметки для продавца (необязательно)
                </label>
                <Input
                  id="buyer-notes"
                  value={buyerNotes}
                  onChange={(e) => setBuyerNotes(e.target.value)}
                  placeholder="Детали заказа"
                />
              </div>
              <Button
                size="lg"
                className="w-full"
                disabled={orderMutation.isPending}
                onClick={() => {
                  if (!accessToken) {
                    window.location.href = "/auth/login";
                    return;
                  }
                  orderMutation.mutate();
                }}
              >
                {orderMutation.isPending ? "Оформление..." : "Заказать"}
              </Button>
              {orderResult ? (
                <div className="rounded-card border border-ok/30 bg-ok-soft p-3 space-y-1">
                  <StatusBadge status="PENDING">Заказ создан</StatusBadge>
                  <p className="text-sm text-content-secondary">{orderResult}</p>
                  <Link
                    href="/services/orders"
                    className="text-sm text-accent-strong underline transition-colors duration-fast hover:text-content"
                  >
                    Мои заказы услуг
                  </Link>
                </div>
              ) : null}
              {orderError ? (
                <p className="text-sm text-bad" role="alert">
                  {orderError}
                </p>
              ) : null}
              <p className="text-xs text-content-muted text-center">
                Информация о продавце появится в личном кабинете после заказа.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
