// Отзыв версии (yank) — перенесено из app/admin/page.tsx (PLAN-017 §36).
// Raw-UUID paste-инпут заменён на EntityPicker (GET /admin/search-entities,
// тип "version"); ручной ввод UUID доступен за переключателем «ввести вручную».
// MODERATION_ID_REGEX-валидация сохранена (UUID_V4_REGEX) — поведение кнопок то же.
"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Ban } from "lucide-react";
import { adminVersionCompatibility, adminYankVersion, getErrorMessage } from "@/lib/api/admin";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { EntityPicker } from "@/components/admin/EntityPicker";
import { UUID_V4_REGEX } from "@/components/admin/labels";

export function VersionsSection() {
  const [versionId, setVersionId] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const validId = UUID_V4_REGEX.test(versionId.trim());

  const yank = useMutation({
    mutationFn: () => adminYankVersion(versionId.trim(), reason.trim() || "Отозвано админом"),
    onSuccess: () => {
      setResult("Версия отозвана (yank)");
      setError(null);
    },
    onError: (e) => {
      setResult(null);
      setError(getErrorMessage(e, "Не удалось отозвать версию"));
    },
  });

  const compat = useMutation({
    mutationFn: () => adminVersionCompatibility(versionId.trim()),
    onSuccess: (data) => {
      setResult(JSON.stringify(data, null, 2));
      setError(null);
    },
    onError: (e) => {
      setResult(null);
      setError(getErrorMessage(e, "Не удалось получить совместимость"));
    },
  });

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Ban className="h-5 w-5 text-bad" /> Отзыв версии (yank)
        </CardTitle>
        <CardDescription>Найдите версию и укажите причину</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <EntityPicker
          entityType="version"
          value={versionId}
          onChange={setVersionId}
          placeholder="Найдите версию ресурса..."
          ariaLabel="ID версии"
          manualPlaceholder="ID версии (UUID versionId из деталей ресурса)"
        />
        <p className="text-xs text-content-muted">
          ID версии доступен на вкладке «Модерация ресурсов» — карточка товара, блок версий.
        </p>
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Причина отзыва"
          aria-label="Причина отзыва"
        />
        <div className="flex gap-2">
          <Button
            variant="danger"
            size="sm"
            disabled={!validId || yank.isPending}
            onClick={() => yank.mutate()}
          >
            Отозвать версию
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!validId || compat.isPending}
            onClick={() => compat.mutate()}
          >
            Проверить совместимость
          </Button>
        </div>
        {result ? (
          <pre className="text-xs bg-surface-raised border border-line p-3 rounded-md overflow-x-auto text-content-secondary">
            {result}
          </pre>
        ) : null}
        {error ? <p className="text-sm text-bad">{error}</p> : null}
      </CardContent>
    </Card>
  );
}