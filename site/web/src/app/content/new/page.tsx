// PLAN-007 C-001: article creation wizard — Basic → Content → Media →
// Links → Preview → Submit (→ PENDING_REVIEW). Plain text only (no raw
// HTML); cover via the validated media pipeline; links are explicit and
// validated server-side (resources: PUBLISHED; servers: staff-only).
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  createArticle,
  submitArticle,
  uploadMedia,
  fetchMyResources,
  fetchDashboardCommunity,
  fetchMyPurchases,
} from "@/lib/api-ext";
import { api } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { LoadingSpinner, ErrorState } from "@/components/ui/States";
import { getErrorMessage } from "@/lib/api-ext";
import { ARTICLE_CATEGORY_LABELS } from "@/lib/domain";
import { useAuthStore } from "@/store/auth";
import { bootstrapSession } from "@/lib/api";
import { PenLine, Upload, X } from "lucide-react";

const CATEGORIES = Object.keys(ARTICLE_CATEGORY_LABELS);

interface ServerOption {
  slug: string;
  name: string;
  lifecycle: string;
  verification: string;
  isStaff?: boolean;
}

export default function NewArticlePage() {
  const router = useRouter();
  const { user, accessToken, isAuthenticated } = useAuthStore();

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("GUIDES");
  const [tags, setTags] = useState("");
  const [content, setContent] = useState("");
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [resourceIds, setResourceIds] = useState<string[]>([]);
  const [serverIds, setServerIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await bootstrapSession();
      if (!cancelled && !ok) router.push("/auth/login");
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  // My published resources (seller) and my staffed servers — link options.
  const { data: myResources } = useQuery({
    queryKey: ["seller", "resources", "links"],
    queryFn: fetchMyResources,
    enabled: isAuthenticated(),
  });
  const { data: community } = useQuery({
    queryKey: ["dashboard", "community", "links"],
    queryFn: fetchDashboardCommunity,
    enabled: isAuthenticated(),
  });
  const { data: purchases } = useQuery({
    queryKey: ["purchases", "mine", "article-links"],
    queryFn: fetchMyPurchases,
    enabled: isAuthenticated(),
  });

  // Only servers where the user is OWNER (dashboard endpoint) — staff link
  // rule is enforced server-side anyway; the UI mirrors it.
  const serverOptions: ServerOption[] = (community?.ownedServers ?? []).map((s: any) => ({
    slug: s.slug,
    name: s.name,
    lifecycle: s.lifecycle,
    verification: s.verification,
    isStaff: true,
  }));
  const resourceOptions = [
    ...(Array.isArray(myResources) ? myResources : [])
      .filter((r: any) => r.status === "PUBLISHED")
      .map((r: any) => ({ id: r.id, title: r.title })),
    ...(Array.isArray(purchases) ? purchases : []).map((p: any) => ({
      id: p.resource?.id,
      title: p.resource?.title,
    })),
  ].filter((r: any) => r.id && r.title);

  const toggle = (list: string[], setList: (v: string[]) => void, id: string) => {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  const onCoverUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const res = await uploadMedia(file);
      setCoverUrl(res.url);
    } catch (e) {
      setError(getErrorMessage(e, "Не удалось загрузить обложку"));
    } finally {
      setUploading(false);
    }
  };

  const onSubmit = async () => {
    setError(null);
    if (title.trim().length < 3 || content.trim().length < 30) {
      setError("Заголовок от 3 символов, текст от 30 символов");
      return;
    }
    setSubmitting(true);
    try {
      const article = (await createArticle({
        title: title.trim(),
        content,
        category,
        tags: tags.trim() || undefined,
        coverUrl,
        resourceIds,
        serverIds,
      })) as { id: string };
      await submitArticle(article.id);
      router.push("/content/mine");
    } catch (e) {
      setError(getErrorMessage(e, "Не удалось отправить статью"));
    } finally {
      setSubmitting(false);
    }
  };

  if (!isAuthenticated() || !user) {
    return <LoadingSpinner label="Проверка сессии…" className="mt-16" />;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-bold tracking-tight">Новая статья</h1>
      <p className="mt-1 text-sm text-content-secondary">
        Статья проходит модерацию перед публикацией. Текст — обычный текст с абзацами.
      </p>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Основное</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="article-title">
              Заголовок
            </label>
            <input
              id="article-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Оптимизация MTA-сервера: таймеры и колбэки"
              className="w-full rounded-card border border-line bg-surface px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="article-category">
                Категория
              </label>
              <select
                id="article-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-card border border-line bg-surface px-3 py-2 text-sm"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {ARTICLE_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="article-tags">
                Теги (через запятую)
              </label>
              <input
                id="article-tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="roleplay, экономика"
                className="w-full rounded-card border border-line bg-surface px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="article-content">
              Текст статьи
            </label>
            <textarea
              id="article-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={12}
              placeholder="Пустые строки — разрыв абзаца."
              className="w-full rounded-card border border-line bg-surface px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-content-muted">{content.length} / 20000</p>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Обложка (необязательно)</CardTitle>
        </CardHeader>
        <CardContent>
          {coverUrl ? (
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={coverUrl} alt="" className="h-24 w-40 rounded-card object-cover" />
              <Button variant="outline" size="sm" onClick={() => setCoverUrl(null)}>
                <X className="mr-1 h-4 w-4" />
                Убрать
              </Button>
            </div>
          ) : (
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-card border border-dashed border-line bg-background p-6 text-sm text-content-secondary hover:border-accent/40">
              <Upload className="mb-2 h-6 w-6" />
              {uploading ? "Загрузка…" : "Загрузить изображение (PNG/JPG, до 5 МБ)"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onCoverUpload(f);
                }}
              />
            </label>
          )}
        </CardContent>
      </Card>

      {(resourceOptions.length > 0 || serverOptions.length > 0) && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Связанное (необязательно)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {resourceOptions.length > 0 ? (
              <div>
                <p className="mb-2 text-sm font-medium">Ресурсы</p>
                <div className="flex flex-wrap gap-2">
                  {resourceOptions.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => toggle(resourceIds, setResourceIds, r.id!)}
                      className={`rounded-full border px-3 py-1.5 text-xs ${
                        resourceIds.includes(r.id!)
                          ? "border-accent bg-accent/10 text-accent-strong"
                          : "border-line bg-surface text-content-secondary hover:border-accent/40"
                      }`}
                    >
                      {r.title}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {serverOptions.length > 0 ? (
              <div>
                <p className="mb-2 text-sm font-medium">Серверы (только те, где вы в персонале)</p>
                <div className="flex flex-wrap gap-2">
                  {serverOptions.map((s) => (
                    <button
                      key={s.slug}
                      onClick={() => {
                        if (!s.isStaff) {
                          setError("Свой сервер может привязать только его персонал");
                          return;
                        }
                        toggle(serverIds, setServerIds, s.slug);
                      }}
                      className={`rounded-full border px-3 py-1.5 text-xs ${
                        serverIds.includes(s.slug)
                          ? "border-accent bg-accent/10 text-accent-strong"
                          : "border-line bg-surface text-content-secondary hover:border-accent/40"
                      } ${s.isStaff ? "" : "cursor-not-allowed opacity-50"}`}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}

      {error ? (
        <div className="mt-4 rounded-card border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">
          {error}
        </div>
      ) : null}

      <div className="mt-6 flex items-center gap-3">
        <Button onClick={onSubmit} disabled={submitting} size="lg">
          <PenLine className="mr-2 h-4 w-4" />
          {submitting ? "Отправка…" : "Отправить на модерацию"}
        </Button>
        <Link href="/content" className="text-sm text-content-secondary hover:text-accent-strong">
          Отмена
        </Link>
      </div>
      <p className="mt-3 text-xs text-content-muted">
        После отправки статья получит статус «На модерации». Решение придёт уведомлением.
      </p>
    </div>
  );
}
