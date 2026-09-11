"use client";

// Reusable message thread + send box (disputes, service order messages).
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { getErrorMessage } from "@/lib/api-ext";

export interface Message {
  id: string;
  body: string;
  createdAt: string;
  authorId?: string;
}

interface Props {
  messageIdPrefix: string;
  messages?: Message[];
  isLoading?: boolean;
  sendFn: (body: string) => Promise<unknown>;
  currentUserId?: string | null;
}

export function MessageThread({ messageIdPrefix, messages, isLoading, sendFn, currentUserId }: Props) {
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => sendFn(body),
    onSuccess: () => {
      setBody("");
      setError(null);
      qc.invalidateQueries({ queryKey: [messageIdPrefix] });
    },
    onError: (e) => setError(getErrorMessage(e, "Не удалось отправить сообщение")),
  });

  return (
    <div className="space-y-3">
      <div className="space-y-2 max-h-80 overflow-y-auto">
        {isLoading ? <p className="text-sm text-slate-500">Загрузка...</p> : null}
        {!isLoading && (!messages || messages.length === 0) ? (
          <p className="text-sm text-slate-500">Сообщений пока нет.</p>
        ) : null}
        {messages?.map((m) => (
          <div
            key={m.id}
            className={
              currentUserId && m.authorId === currentUserId
                ? "bg-blue-50 dark:bg-blue-900/30 rounded-lg p-3 ml-8"
                : "bg-slate-100 dark:bg-slate-800 rounded-lg p-3 mr-8"
            }
          >
            <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
            <p className="text-xs text-slate-500 mt-1">
              {new Date(m.createdAt).toLocaleString("ru-RU")}
            </p>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <Input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Сообщение..." />
        <Button
          size="md"
          disabled={!body.trim() || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Отправить
        </Button>
      </div>
      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}
