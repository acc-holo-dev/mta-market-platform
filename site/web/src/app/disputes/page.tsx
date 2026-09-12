"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { fetchMyDisputes, type Dispute } from "@/lib/api-ext";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { LoadingSpinner, EmptyState, ErrorState } from "@/components/ui/States";
import { disputeTargetLabel } from "@/lib/disputeLabels";
import { Gavel } from "lucide-react";


export default function DisputesPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["my-disputes"],
    queryFn: fetchMyDisputes,
  });

  const list: Dispute[] = data?.data ?? [];

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Мои споры</h1>
        <p className="text-sm text-content-secondary">
          Споры по покупкам и заказам услуг
        </p>
      </div>

      {isLoading ? (
        <LoadingSpinner label="Загрузка споров..." />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Gavel className="h-12 w-12 text-content-muted mx-auto mb-4" />}
          title="У вас нет открытых споров"
          action={
            <Link href="/account">
              <Button variant="outline" size="sm">
                К покупкам
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {list.map((d) => (
            <Link key={d.id} href={`/disputes/${d.id}`} className="block group">
              <Card className="transition-colors duration-fast group-hover:border-line-strong group-hover:shadow-raised">
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <CardTitle className="text-base">Спор #{d.id.slice(0, 8)}</CardTitle>
                      <CardDescription className="tabular-nums">
                        {disputeTargetLabel(d.targetType)} ·{" "}
                        {new Date(d.createdAt).toLocaleDateString("ru-RU")}
                      </CardDescription>
                    </div>
                    <StatusBadge status={d.status} />
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-content-secondary line-clamp-2">{d.reason}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
