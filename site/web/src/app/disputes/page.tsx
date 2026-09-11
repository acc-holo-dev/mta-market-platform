"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { fetchMyDisputes, type Dispute } from "@/lib/api-ext";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { LoadingSpinner, EmptyState, ErrorState } from "@/components/ui/States";

export default function DisputesPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["my-disputes"],
    queryFn: fetchMyDisputes,
  });

  const list: Dispute[] = data?.data ?? [];

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">Мои споры</h1>
        <p className="text-lg text-slate-600 dark:text-slate-400">
          Споры по покупкам и заказам услуг
        </p>
      </div>

      {isLoading ? (
        <LoadingSpinner label="Загрузка споров..." />
      ) : error ? (
        <ErrorState error={error} onRetry={() => refetch()} />
      ) : list.length === 0 ? (
        <EmptyState
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
              <Card className="transition-shadow group-hover:shadow-md">
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <CardTitle className="text-base">Спор #{d.id.slice(0, 8)}</CardTitle>
                      <CardDescription>
                        {d.targetType} · {new Date(d.createdAt).toLocaleDateString("ru-RU")}
                      </CardDescription>
                    </div>
                    <StatusBadge status={d.status} />
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2">
                    {d.reason}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
