// Контент сообщества — перенесено из app/admin/page.tsx (PLAN-017 §36).
// Три raw-ID инпута (reviewId/threadId/newsId) заменены на EntityPicker
// (GET /admin/search-entities); ручной ввод UUID остаётся за переключателем.
"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import {
  adminModerateNews,
  adminModerateServerReview,
  adminModerateThread,
  getErrorMessage,
} from "@/lib/api/admin";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Input";
import { EntityPicker } from "@/components/admin/EntityPicker";
import { UUID_V4_REGEX } from "@/components/admin/labels";

export function CommunityModerationSection() {
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const [reviewId, setReviewId] = useState("");
  const [reviewReason, setReviewReason] = useState("");
  const [threadId, setThreadId] = useState("");
  const [threadState, setThreadState] = useState("LOCKED");
  const [threadPinned, setThreadPinned] = useState(false);
  const [newsId, setNewsId] = useState("");
  const [newsReason, setNewsReason] = useState("");

  const reviewValid = UUID_V4_REGEX.test(reviewId.trim());
  const threadValid = UUID_V4_REGEX.test(threadId.trim());
  const newsValid = UUID_V4_REGEX.test(newsId.trim());

  const reviewModeration = useMutation({
    mutationFn: ({ status }: { status: "VISIBLE" | "HIDDEN" }) =>
      adminModerateServerReview(reviewId.trim(), status, reviewReason.trim() || undefined),
    onSuccess: () => {
      setError(null);
      setResult(`Отзыв ${reviewId.trim()} обновлён`);
    },
    onError: (e) => {
      setResult(null);
      setError(getErrorMessage(e, "Не удалось изменить отзыв"));
    },
  });

  const threadModeration = useMutation({
    mutationFn: () =>
      adminModerateThread(threadId.trim(), threadState, threadPinned ? true : undefined),
    onSuccess: () => {
      setError(null);
      setResult(`Тема ${threadId.trim()} обновлена`);
    },
    onError: (e) => {
      setResult(null);
      setError(getErrorMessage(e, "Не удалось изменить тему"));
    },
  });

  const newsModeration = useMutation({
    mutationFn: ({ status }: { status: "DRAFT" | "PUBLISHED" }) =>
      adminModerateNews(newsId.trim(), status, newsReason.trim() || undefined),
    onSuccess: () => {
      setError(null);
      setResult(`Новость ${newsId.trim()} обновлена`);
    },
    onError: (e) => {
      setResult(null);
      setError(getErrorMessage(e, "Не удалось изменить новость"));
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5 text-accent" /> Контент сообщества
        </CardTitle>
        <CardDescription>Модерация отзывов, тем форума и новостей серверов</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {error ? <p className="text-sm text-bad">{error}</p> : null}
        {result ? <p className="text-sm text-ok">{result}</p> : null}

        {/* Скрытие отзывов о серверах */}
        <div className="p-4 rounded-card border border-line bg-surface-raised space-y-3">
          <p className="text-sm font-semibold">Отзыв: скрыть / вернуть</p>
          <EntityPicker
            entityType="review"
            value={reviewId}
            onChange={setReviewId}
            placeholder="Найдите отзыв о сервере..."
            ariaLabel="ID отзыва"
            manualPlaceholder="ID отзыва (UUID из админ-списка отзывов)"
          />
          <Input
            value={reviewReason}
            onChange={(e) => setReviewReason(e.target.value)}
            placeholder="Причина (для скрытия)"
            aria-label="Причина скрытия отзыва"
          />
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="danger"
              size="sm"
              disabled={!reviewValid || reviewModeration.isPending}
              onClick={() => reviewModeration.mutate({ status: "HIDDEN" })}
            >
              Скрыть отзыв
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!reviewValid || reviewModeration.isPending}
              onClick={() => reviewModeration.mutate({ status: "VISIBLE" })}
            >
              Вернуть отзыв
            </Button>
          </div>
        </div>

        {/* Состояние и закрепление темы */}
        <div className="p-4 rounded-card border border-line bg-surface-raised space-y-3">
          <p className="text-sm font-semibold">Тема форума: состояние / закрепление</p>
          <EntityPicker
            entityType="thread"
            value={threadId}
            onChange={setThreadId}
            placeholder="Найдите тему форума..."
            ariaLabel="ID темы"
            manualPlaceholder="ID темы (UUID из списка тем)"
          />
          <div className="max-w-xs">
            <Select
              value={threadState}
              onChange={(e) => setThreadState(e.target.value)}
              aria-label="Состояние темы"
            >
              <option value="OPEN">Открыта</option>
              <option value="LOCKED">Закрыта</option>
              <option value="ARCHIVED">В архиве</option>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm text-content-secondary">
            <input
              type="checkbox"
              checked={threadPinned}
              onChange={(e) => setThreadPinned(e.target.checked)}
              className="h-4 w-4"
            />
            Закрепить тему
          </label>
          <Button
            size="sm"
            disabled={!threadValid || threadModeration.isPending}
            onClick={() => threadModeration.mutate()}
          >
            Применить к теме
          </Button>
        </div>

        {/* Снятие / публикация новости сервера */}
        <div className="p-4 rounded-card border border-line bg-surface-raised space-y-3">
          <p className="text-sm font-semibold">Новость сервера: снять / опубликовать</p>
          <EntityPicker
            entityType="news"
            value={newsId}
            onChange={setNewsId}
            placeholder="Найдите новость сервера..."
            ariaLabel="ID новости"
            manualPlaceholder="ID новости (UUID из вкладки «Серверы»)"
          />
          <Input
            value={newsReason}
            onChange={(e) => setNewsReason(e.target.value)}
            placeholder="Причина (для снятия)"
            aria-label="Причина снятия новости"
          />
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="danger"
              size="sm"
              disabled={!newsValid || newsModeration.isPending}
              onClick={() => newsModeration.mutate({ status: "DRAFT" })}
            >
              Снять с публикации
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!newsValid || newsModeration.isPending}
              onClick={() => newsModeration.mutate({ status: "PUBLISHED" })}
            >
              Опубликовать
            </Button>
          </div>
        </div>

        <p className="text-xs text-content-muted">действие фиксируется в журнале аудита</p>
      </CardContent>
    </Card>
  );
}