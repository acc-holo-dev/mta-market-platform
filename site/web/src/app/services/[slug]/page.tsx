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
            <div className="h-8 bg-slate-200 dark:bg-slate-700 rounded w-1/2"></div>
          </CardHeader>
          <CardContent>
            <div className="h-40 bg-slate-200 dark:bg-slate-700 rounded"></div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !service) {
    return (
      <div className="container mx-auto px-4 py-12">
        <Card className="bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800">
          <CardHeader>
            <CardTitle className="text-red-600 dark:text-red-400">Услуга не найдена</CardTitle>
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
                <Wrench className="h-8 w-8 text-blue-600" /> {service.title}
              </CardTitle>
              <CardDescription className="text-base">{service.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-6 text-sm text-slate-600 dark:text-slate-400">
                <span className="flex items-center gap-2">
                  <Clock className="h-4 w-4" /> Срок: {service.deliveryDays} дн.
                </span>
                <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-400 rounded">
                  {service.type}
                </span>
              </div>
              {service.requirements ? (
                <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                  <h4 className="font-semibold text-sm flex items-center gap-2 mb-1">
                    <ListChecks className="h-4 w-4" /> Что требуется от вас
                  </h4>
                  <p className="text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap">
                    {service.requirements}
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar: order */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Заказать услугу</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-center py-4">
                <div className="text-4xl font-bold">{formatRub(service.price)}</div>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                  Выполнение до {service.deliveryDays} дн.
                </p>
              </div>
              <div>
                <label className="text-sm text-slate-600 dark:text-slate-400">
                  Заметки для продавца (необязательно)
                </label>
                <Input
                  value={buyerNotes}
                  onChange={(e) => setBuyerNotes(e.target.value)}
                  placeholder="Детали заказа"
                  className="mt-1"
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
                <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg space-y-1">
                  <StatusBadge status="PENDING">Заказ создан</StatusBadge>
                  <p className="text-sm text-slate-600 dark:text-slate-400">{orderResult}</p>
                  <Link
                    href="/services/orders"
                    className="text-sm text-blue-600 dark:text-blue-400 underline"
                  >
                    Мои заказы услуг
                  </Link>
                </div>
              ) : null}
              {orderError ? (
                <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                  {orderError}
                </p>
              ) : null}
              <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
                Информация о продавце появится в личном кабинете после заказа.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
