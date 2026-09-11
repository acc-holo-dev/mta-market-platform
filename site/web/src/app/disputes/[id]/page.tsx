"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { fetchDispute, postDisputeMessage } from "@/lib/api-ext";
import { useAuthStore } from "@/store/auth";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { LoadingSpinner } from "@/components/ui/States";
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
        <LoadingSpinner label="Загрузка спора..." />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="container mx-auto px-4 py-12">
        <Card className="border-bad/40 bg-bad-soft">
          <CardHeader>
            <CardTitle className="text-bad">Спор не найден</CardTitle>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-3xl">
      <Card className="mb-6 shadow-card">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="tabular-nums">
                Спор #{data.dispute.id.slice(0, 8)}
              </CardTitle>
              <CardDescription className="tabular-nums">
                {data.dispute.targetType} ·{" "}
                {new Date(data.dispute.createdAt).toLocaleString("ru-RU")}
              </CardDescription>
            </div>
            <StatusBadge status={data.dispute.status} />
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm">
            <span className="font-semibold">Причина:</span>{" "}
            <span className="text-content-secondary">{data.dispute.reason}</span>
          </p>
          {data.dispute.resolution ? (
            <p className="text-sm">
              <span className="font-semibold">Решение:</span>{" "}
              <span className="text-content-secondary">{data.dispute.resolution}</span>
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
