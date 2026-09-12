// Заявки продавцов — перенесено из app/admin/page.tsx (PLAN-017 §36).
// Ключи ["admin-sellers", "PENDING"] и инвалидация ["admin-stats"] сохранены.
"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
// lucide "Users" алиасится локально, чтобы не путать с секцией пользователей.
import { Users as UsersIcon } from "lucide-react";
import { adminSellerAction, fetchAdminSellers, getErrorMessage } from "@/lib/api/admin";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { LoadingSpinner, EmptyState } from "@/components/ui/States";

interface SellerRow {
  id: string;
  userId: string;
  status: string;
  displayName?: string | null;
  user?: { username?: string; email?: string };
}

export function SellersSection() {
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
          <UsersIcon className="h-5 w-5 text-accent" /> Заявки продавцов
        </CardTitle>
        <CardDescription>Ожидают одобрения</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <p className="text-sm text-bad">{error}</p> : null}
        {isLoading ? (
          <LoadingSpinner label="Загрузка заявок..." />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<UsersIcon className="h-12 w-12 text-content-muted mx-auto mb-4" />}
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