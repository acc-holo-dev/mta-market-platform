// Переписка по спору — перенесено из app/admin/page.tsx (PLAN-017 §36).
// Ключ ["dispute", disputeId] сохранён (MessageThread инвалидирует [messageIdPrefix]).
"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchDispute, postDisputeMessage } from "@/lib/api/admin";
import { LoadingSpinner } from "@/components/ui/States";
import { MessageThread } from "@/components/MessageThread";

export function AdminDisputeMessages({ disputeId }: { disputeId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["dispute", disputeId],
    queryFn: () => fetchDispute(disputeId),
  });

  if (isLoading) return <LoadingSpinner label="Загрузка переписки..." className="py-6" />;
  if (!data) return <p className="text-sm text-bad">Не удалось загрузить переписку.</p>;

  return (
    <div className="p-3 rounded-md bg-surface">
      <MessageThread
        messageIdPrefix="dispute"
        messages={data.messages}
        sendFn={(body) => postDisputeMessage(disputeId, body)}
      />
    </div>
  );
}