"use client";

// Reusable message thread + send box (disputes, service order messages).
// PLAN-013: bubbles on tokens — own messages bg-accent/text-white, others
// bg-surface-raised/text-content, metadata caption muted. Props/API unchanged.
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
      <div className="max-h-80 space-y-2 overflow-y-auto">
        {isLoading ? <p className="text-sm text-content-muted">Загрузка...</p> : null}
        {!isLoading && (!messages || messages.length === 0) ? (
          <p className="text-sm text-content-muted">Сообщений пока нет.</p>
        ) : null}
        {messages?.map((m) => {
          const own = Boolean(currentUserId && m.authorId === currentUserId);
          return (
            <div
              key={m.id}
              className={
                own
                  ? "ml-8 rounded-lg bg-accent p-3 text-on-accent shadow-card"
                  : "mr-8 rounded-lg border border-line bg-surface-raised p-3 text-content"
              }
            >
              <p className="break-words text-sm whitespace-pre-wrap">{m.body}</p>
              <p className={`mt-1 text-xs ${own ? "text-on-accent/70" : "text-content-muted"}`}>
                {new Date(m.createdAt).toLocaleString("ru-RU")}
              </p>
            </div>
          );
        })}
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
      {error ? <p className="text-sm text-bad">{error}</p> : null}
    </div>
  );
}