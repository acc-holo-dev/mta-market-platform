// MediaManager (PLAN-003 B-001..B-005): управление оформлением ресурса —
// обложка и скриншоты с понятными состояниями (uploading/uploaded/failed/
// removing), порядком скриншотов (простые move-контроли, B-004) и
// человекочитаемыми ошибками (B-003 — без raw backend exceptions).
// Используется в wizard (Presentation step) и в кабинете продавца (B-006).
"use client";

import { useRef, useState } from "react";
import {
  uploadMedia,
  setResourceCover,
  addResourceScreenshot,
  removeResourceScreenshot,
  reorderResourceScreenshots,
  mediaUrl,
  getErrorMessage,
} from "@/lib/api-ext";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { ArrowLeft, ArrowRight, ImagePlus, Loader2, Trash2, UploadCloud } from "lucide-react";

// Клиентские ограничения — сервер проверяет то же самое ещё раз (A-005).
export const MEDIA_MAX_MB = 5;
const MAX_SCREENSHOTS = 8;
const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/gif"];

type ItemState = "uploading" | "uploaded" | "failed" | "removing";

export interface ScreenshotItem {
  // Для сохранённых скриншотов — DB id; для новых — локальный temp key.
  key: string;
  id: string | null;
  url: string;
  state: ItemState;
  error?: string | null;
}

/** B-003: валидация выбора до загрузки. */
export function validateMediaFile(file: File): string | null {
  if (!ALLOWED.includes(file.type)) {
    return "Неподдерживаемый формат. Разрешены PNG, JPEG, WebP и GIF.";
  }
  if (file.size > MEDIA_MAX_MB * 1024 * 1024) {
    return `Файл слишком большой. Максимум — ${MEDIA_MAX_MB} МБ.`;
  }
  return null;
}

/** B-003: понятные ошибки загрузки без raw backend exceptions. */
function friendlyUploadError(e: unknown): string {
  const message = getErrorMessage(e, "");
  if (message.includes("too large") || message.includes("большой")) {
    return `Файл слишком большой. Максимум — ${MEDIA_MAX_MB} МБ.`;
  }
  if (message.includes("not a supported image") || message.includes("Неподдерживаем")) {
    return "Файл не является поддерживаемым изображением (PNG, JPEG, WebP, GIF).";
  }
  if (message.includes("does not match")) {
    return "Расширение файла не совпадает с его форматом.";
  }
  return "Не удалось загрузить изображение. Проверьте файл и попробуйте ещё раз.";
}

export function MediaManager({
  slug,
  initialCover,
  initialScreenshots,
  onChange,
}: {
  slug: string;
  initialCover: string | null;
  initialScreenshots: { id: string; url: string; position: number }[];
  /** Сообщает родителю актуальное состояние (для preview). */
  onChange?: (state: {
    cover: string | null;
    screenshots: { id: string; url: string; position: number }[];
  }) => void;
}) {
  const [cover, setCover] = useState<string | null>(initialCover);
  const [coverState, setCoverState] = useState<ItemState>(initialCover ? "uploaded" : "failed");
  const [coverError, setCoverError] = useState<string | null>(null);
  const [screenshots, setScreenshots] = useState<ScreenshotItem[]>(
    [...initialScreenshots]
      .sort((a, b) => a.position - b.position)
      .map((s) => ({ key: s.id, id: s.id, url: s.url, state: "uploaded" as ItemState }))
  );
  const coverInputRef = useRef<HTMLInputElement>(null);
  const shotsInputRef = useRef<HTMLInputElement>(null);

  const notify = (
    nextCover: string | null,
    nextShots: ScreenshotItem[]
  ) => {
    onChange?.({
      cover: nextCover,
      screenshots: nextShots
        .filter((s) => s.state === "uploaded" && s.id)
        .map((s, i) => ({ id: s.id as string, url: s.url, position: i })),
    });
  };

  // ---------- Cover ----------
  const handleCoverSelected = async (file: File) => {
    const invalid = validateMediaFile(file);
    if (invalid) {
      setCoverError(invalid);
      setCoverState(cover ? "uploaded" : "failed");
      return;
    }
    setCoverError(null);
    setCoverState("uploading");
    try {
      const result = await uploadMedia(file);
      await setResourceCover(slug, result.url);
      setCover(result.url);
      setCoverState("uploaded");
      notify(result.url, screenshots);
    } catch (e) {
      setCoverState(cover ? "uploaded" : "failed");
      setCoverError(friendlyUploadError(e));
    }
  };

  const handleCoverRemove = async () => {
    if (!cover) return;
    setCoverState("removing");
    try {
      await setResourceCover(slug, null);
      setCover(null);
      setCoverState("failed");
      setCoverError(null);
      notify(null, screenshots);
    } catch (e) {
      setCoverState("uploaded");
      setCoverError(getErrorMessage(e, "Не удалось удалить обложку"));
    }
  };

  // ---------- Screenshots ----------
  const handleScreenshotsSelected = async (files: FileList) => {
    const activeCount = screenshots.filter((s) => s.state !== "failed").length;
    const slots = MAX_SCREENSHOTS - activeCount;
    const chosen = Array.from(files).slice(0, Math.max(0, slots));

    const staged: ScreenshotItem[] = chosen.map((f, i) => ({
      key: `tmp-${Date.now()}-${i}-${f.name}`,
      id: null,
      url: URL.createObjectURL(f),
      state: "uploading",
    }));
    if (staged.length === 0) return;
    setScreenshots((prev) => [...prev.filter((s) => s.state !== "failed"), ...staged]);

    for (let i = 0; i < chosen.length; i++) {
      const file = chosen[i];
      const item = staged[i];
      const invalid = validateMediaFile(file);
      if (invalid) {
        setScreenshots((prev) =>
          prev.map((s) => (s.key === item.key ? { ...s, state: "failed", error: invalid } : s))
        );
        continue;
      }
      try {
        const result = await uploadMedia(file);
        const created = await addResourceScreenshot(slug, result.url);
        setScreenshots((prev) => {
          const next = prev.map((s) =>
            s.key === item.key
              ? { ...s, id: created.id, url: created.url, state: "uploaded" as ItemState, error: null }
              : s
          );
          notify(cover, next);
          return next;
        });
      } catch (e) {
        setScreenshots((prev) =>
          prev.map((s) =>
            s.key === item.key ? { ...s, state: "failed", error: friendlyUploadError(e) } : s
          )
        );
      }
    }
  };

  const removeScreenshot = async (item: ScreenshotItem) => {
    if (item.state === "uploading" || item.state === "removing") return;
    if (item.state === "failed" || !item.id) {
      setScreenshots((prev) => prev.filter((s) => s.key !== item.key));
      return;
    }
    setScreenshots((prev) => prev.map((s) => (s.key === item.key ? { ...s, state: "removing" } : s)));
    try {
      await removeResourceScreenshot(slug, item.id);
      setScreenshots((prev) => {
        const next = prev.filter((s) => s.key !== item.key);
        notify(cover, next);
        return next;
      });
    } catch (e) {
      setScreenshots((prev) =>
        prev.map((s) =>
          s.key === item.key
            ? { ...s, state: "uploaded", error: getErrorMessage(e, "Не удалось удалить скриншот") }
            : s
        )
      );
    }
  };

  // B-004: порядок через простые move-контроли.
  const move = async (index: number, delta: -1 | 1) => {
    const next = [...screenshots];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setScreenshots(next);
    const ids = next.map((s) => s.id).filter((id): id is string => Boolean(id));
    notify(cover, next);
    if (ids.length === next.length) {
      try {
        await reorderResourceScreenshots(slug, ids);
      } catch {
        // Локальный порядок сохранён; актуальный порядок придёт с сервера
        // при следующей загрузке страницы.
      }
    }
  };

  const uploading = screenshots.some((s) => s.state === "uploading" || s.state === "removing");

  return (
    <div className="space-y-6" data-testid="media-manager">
      {/* Cover (B-001) */}
      <div>
        <p className="text-sm font-medium mb-2">
          Обложка <span className="text-content-muted font-normal">(необязательно)</span>
        </p>
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="w-full sm:w-64 aspect-video overflow-hidden rounded-card border border-line bg-surface-raised flex items-center justify-center">
            {cover && coverState === "uploaded" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={mediaUrl(cover) ?? ""}
                alt="Обложка ресурса"
                className="h-full w-full object-cover"
              />
            ) : coverState === "uploading" || coverState === "removing" ? (
              <div className="flex flex-col items-center gap-2 text-content-muted" aria-live="polite">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-xs">
                  {coverState === "uploading" ? "Загрузка..." : "Удаление..."}
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1 text-content-muted">
                <ImagePlus className="h-6 w-6" />
                <span className="text-xs">Нет обложки</span>
              </div>
            )}
          </div>
          <div className="flex flex-col items-start gap-2">
            <input
              ref={coverInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="sr-only"
              aria-label="Выбрать файл обложки"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleCoverSelected(f);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={coverState === "uploading" || coverState === "removing"}
              onClick={() => coverInputRef.current?.click()}
            >
              <UploadCloud className="mr-2 h-4 w-4" />
              {cover ? "Заменить обложку" : "Загрузить обложку"}
            </Button>
            {cover && coverState === "uploaded" ? (
              <Button variant="ghost" size="sm" onClick={() => void handleCoverRemove()}>
                Удалить обложку
              </Button>
            ) : null}
            {coverError ? (
              <p className="text-sm text-bad" role="alert">
                {coverError}
              </p>
            ) : null}
            <p className="text-xs text-content-muted">
              PNG, JPEG, WebP или GIF · до {MEDIA_MAX_MB} МБ · рекомендуется формат 16:9
            </p>
          </div>
        </div>
      </div>

      {/* Screenshots (A-003) */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium">Скриншоты</p>
          <span className="text-xs text-content-muted">
            {screenshots.filter((s) => s.state === "uploaded").length}/{MAX_SCREENSHOTS}
          </span>
        </div>

        {screenshots.length > 0 ? (
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3" aria-label="Скриншоты ресурса">
            {screenshots.map((s, i) => (
              <li
                key={s.key}
                className={cn(
                  "relative overflow-hidden rounded-card border bg-surface-raised",
                  s.state === "failed" ? "border-bad" : "border-line"
                )}
              >
                <div className="aspect-video">
                  {s.state === "uploading" ? (
                    <div
                      className="flex h-full flex-col items-center justify-center gap-2 text-content-muted"
                      aria-live="polite"
                    >
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span className="text-xs">Загрузка...</span>
                    </div>
                  ) : s.state === "removing" ? (
                    <div
                      className="flex h-full items-center justify-center text-content-muted"
                      aria-live="polite"
                    >
                      <Loader2 className="h-5 w-5 animate-spin" />
                    </div>
                  ) : s.state === "uploaded" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={mediaUrl(s.url) ?? ""}
                      alt={`Скриншот ${i + 1}`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-1 p-2 text-center">
                      <span className="text-[11px] text-bad">{s.error ?? "Ошибка загрузки"}</span>
                    </div>
                  )}
                </div>

                {s.state === "uploaded" ? (
                  <div className="absolute right-1 top-1 flex gap-1">
                    <button
                      type="button"
                      onClick={() => void move(i, -1)}
                      disabled={i === 0}
                      aria-label={`Сдвинуть скриншот ${i + 1} к началу`}
                      className="rounded bg-black/60 p-1 text-white disabled:opacity-30 hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    >
                      <ArrowLeft className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void move(i, 1)}
                      disabled={i === screenshots.length - 1}
                      aria-label={`Сдвинуть скриншот ${i + 1} к концу`}
                      className="rounded bg-black/60 p-1 text-white disabled:opacity-30 hover:bg-black/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    >
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={() => void removeScreenshot(s)}
                  disabled={s.state === "uploading" || s.state === "removing"}
                  aria-label={`Удалить скриншот ${i + 1}`}
                  className="absolute left-1 top-1 rounded bg-black/60 p-1 text-white hover:bg-bad/90 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <input
          ref={shotsInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          className="sr-only"
          aria-label="Выбрать скриншоты"
          onChange={(e) => {
            if (e.target.files?.length) void handleScreenshotsSelected(e.target.files);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={screenshots.filter((s) => s.state !== "failed").length >= MAX_SCREENSHOTS}
          onClick={() => shotsInputRef.current?.click()}
        >
          <ImagePlus className="mr-2 h-4 w-4" />
          Добавить скриншоты
        </Button>
        {screenshots.some((s) => s.state === "uploading" || s.state === "removing") ? (
          <p className="ml-3 inline text-xs text-content-muted" aria-live="polite">
            Обработка изображений...
          </p>
        ) : null}
        <p className="mt-2 text-xs text-content-muted">
          До {MAX_SCREENSHOTS} изображений · PNG, JPEG, WebP, GIF · до {MEDIA_MAX_MB} МБ
        </p>
      </div>
    </div>
  );
}
