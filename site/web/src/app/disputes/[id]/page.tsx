"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { fetchDispute, postDisputeMessage } from "@/lib/api-ext";
import { useAuthStore } from "@/store/auth";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { MessageThread } from "@/components/MessageThread";

export default function DisputeDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const { user } = useAuthStore();

  const { data, isLoading, error } = useQuery({
    queryKey: ["dispute", id],
    queryFn: () => fetchDispute(id),
  });

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-12">
        <p className="text-sm text-slate-500">Загрузка...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="container mx-auto px-4 py-12">
        <Card className="bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800">
          <CardHeader>
            <CardTitle className="text-red-600 dark:text-red-400">Спор не найден</CardTitle>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <Card className="mb-6">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Спор #{data.dispute.id.slice(0, 8)}</CardTitle>
              <CardDescription>
                {data.dispute.targetType} ·{" "}
                {new Date(data.dispute.createdAt).toLocaleString("ru-RU")}
              </CardDescription>
            </div>
            <StatusBadge status={data.dispute.status} />
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm">
            <span className="font-medium">Причина:</span> {data.dispute.reason}
          </p>
          {data.dispute.resolution ? (
            <p className="text-sm">
              <span className="font-medium">Решение:</span> {data.dispute.resolution}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Переписка</CardTitle>
        </CardHeader>
        <CardContent>
          <MessageThread
            messageIdPrefix="dispute"
            messages={data.messages}
            currentUserId={user?.id ?? null}
            sendFn={(body) => postDisputeMessage(id, body)}
          />
        </CardContent>
      </Card>
    </div>
  );
}
