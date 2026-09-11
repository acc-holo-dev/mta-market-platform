// E-003: guided resource creation wizard (PLAN-003: 5 steps).
//
// Flow aligned with the server contract (apps/server/src/routes):
//   Step 1 — basic info (title, description >= 10 chars, auto-suggested slug).
//   Step 2 — type + price; "Создать черновик" runs POST /resources. The server
//            requires type+price in the create call (and type cannot be
//            PATCHed later), so the DRAFT is created at the end of step 2,
//            before any artifact is uploaded.
//   Step 3 — artifact: POST /upload/resource (multipart, field "file"), then
//            POST /resources/:slug/versions with the upload response fields
//            {version, changelog, fileUrl, fileSize, fileChecksum}. A 422
//            shows the server's validation result inline. Skippable.
//   Step 4 — PLAN-003 B-001..B-004: Presentation (cover + screenshots) via
//            POST /upload/media + resource media endpoints. Optional.
//   Step 5 — PLAN-003 B-005: product-like preview + "Завершить":
//            PATCH /resources/:slug {status: "PENDING_REVIEW"} submits the
//            listing for moderation.
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  createResource,
  uploadResourceFile,
  createResourceVersion,
  setResourceStatus,
  formatRub,
  getErrorMessage,
  type Resource,
  type UploadResult,
  type VersionValidationError,
} from "@/lib/api-ext";
import { bootstrapSession } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { StatusBadge, ErrorText } from "@/components/ui/StatusBadge";
import { MediaManager } from "@/components/seller/MediaManager";
import { ResourceCard } from "@/components/ui/ResourceCard";
import { ArrowLeft, ArrowRight, Check, FileUp, Rocket } from "lucide-react";

const RESOURCE_TYPES = ["SCRIPT", "MAP", "MODEL", "TEXTURE", "SOUND", "GAMEMODE"] as const;
const STEPS = ["Основное", "Тип и цена", "Файл и версия", "Оформление", "Проверка"];

// Server slug rule: ^[a-z0-9-]+$
const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "c", ч: "ch", ш: "sh", щ: "sch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function slugify(title: string): string {
  return title
    .toLowerCase()
    .split("")
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join("")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

const VERSION_RE = /^\d+\.\d+\.\d+$/;

export default function NewResourcePage() {
  const router = useRouter();
  const { accessToken, isAuthenticated, user } = useAuthStore();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // accessToken уже в памяти после логина — не делаем лишний /auth/refresh
      if (isAuthenticated()) return;
      const ok = await bootstrapSession();
      if (!cancelled && !ok) router.push("/auth/login");
    })();
    return () => {
      cancelled = true;
    };
  }, [router, isAuthenticated]);

  // Wizard state
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [type, setType] = useState("SCRIPT");
  const [priceRub, setPriceRub] = useState("0");
  const [draft, setDraft] = useState<Resource | null>(null);
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [version, setVersion] = useState("1.0.0");
  const [changelog, setChangelog] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validationIssues, setValidationIssues] = useState<string[] | null>(null);
  // PLAN-003 B: media state (server-persisted through MediaManager)
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [screenshots, setScreenshots] = useState<{ id: string; url: string; position: number }[]>([]);

  const qc = useQueryClient();
  const suggestedSlug = useMemo(() => slugify(title), [title]);
  const effectiveSlug = slugEdited ? slug : suggestedSlug;

  const priceKopecks = useMemo(() => {
    const n = parseFloat(priceRub.replace(",", "."));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
  }, [priceRub]);

  // ---------- mutations ----------
  const createDraft = useMutation({
    mutationFn: () => createResource({ title: title.trim(), description: description.trim(), slug: effectiveSlug, type, price: priceKopecks }),
    onSuccess: (resource) => {
      setDraft(resource);
      setError(null);
      setValidationIssues(null);
      setStep(2);
      qc.invalidateQueries({ queryKey: ["seller-resources"] });
    },
    onError: (e) => setError(getErrorMessage(e, "Не удалось создать черновик ресурса")),
  });

  const attachVersion = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Выберите файл");
      const up = await uploadResourceFile(file);
      setUpload(up);
      return createResourceVersion(draft?.slug ?? effectiveSlug, {
        version: version.trim(),
        changelog: changelog.trim() || undefined,
        fileUrl: up.fileUrl,
        fileSize: up.fileSize,
        fileChecksum: up.fileChecksum,
      });
    },
    onSuccess: () => {
      setError(null);
      setValidationIssues(null);
      setStep(3); // Presentation step (PLAN-003 B-001)
    },
    onError: (e) => {
      // 422: server-side artifact validation result
      const resp = (e as { response?: { data?: VersionValidationError; status?: number } }).response;
      if (resp?.status === 422 && resp.data?.validation) {
        const v = resp.data.validation;
        const issues = Array.isArray(v.issues)
          ? v.issues.map((i) => [i.path, i.message].filter(Boolean).join(": ") || "Ошибка валидации")
          : [typeof v.summary === "string" ? v.summary : "Артефакт не прошёл проверку"];
        setValidationIssues(issues);
        setError("Артефакт не прошёл валидацию. Исправьте файл и попробуйте снова.");
      } else {
        setValidationIssues(null);
        setError(getErrorMessage(e, "Не удалось загрузить файл или создать версию"));
      }
    },
  });

  const submitForReview = useMutation({
    mutationFn: () => setResourceStatus(draft?.slug ?? effectiveSlug, "PENDING_REVIEW"),
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: ["seller-resources"] });
    },
    onError: (e) => setError(getErrorMessage(e, "Не удалось отправить ресурс на модерацию")),
  });

  // ---------- guards ----------
  if (!isAuthenticated()) return null;

  const step1Valid =
    title.trim().length >= 3 &&
    description.trim().length >= 10 &&
    /^[a-z0-9-]+$/.test(effectiveSlug) &&
    effectiveSlug.length > 0;

  const step2Valid = RESOURCE_TYPES.includes(type as (typeof RESOURCE_TYPES)[number]);
  const step3Valid =
    file !== null && VERSION_RE.test(version.trim()) && !attachVersion.isPending;

  // ---------- success state ----------
  if (submitForReview.isSuccess) {
    return (
      <div className="container mx-auto px-4 py-12 max-w-xl">
        <Card>
          <CardContent className="py-10 text-center space-y-4">
            <div className="mx-auto h-14 w-14 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center">
              <Check className="h-7 w-7 text-green-600 dark:text-green-300" />
            </div>
            <h1 className="text-2xl font-bold">Ресурс отправлен на модерацию</h1>
            <p className="text-slate-600 dark:text-slate-400">
              «{title}» теперь имеет статус{" "}
              <StatusBadge status="PENDING_REVIEW" />. После проверки модератором
              ресурс будет опубликован на Маркетплейсе.
            </p>
            <div className="flex items-center justify-center gap-3 pt-2">
              <Link href="/seller">
                <Button variant="primary">К моим ресурсам</Button>
              </Link>
              <Link href="/">
                <Button variant="ghost">На Маркетплейс</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-2xl">
      <h1 className="text-3xl font-bold mb-1">Новый ресурс</h1>
      <p className="text-slate-600 dark:text-slate-400 mb-6">
        Черновик создаётся на втором шаге, версия с файлом — на третьем, отправка на модерацию — в конце.
      </p>

      {/* Step indicator */}
      <ol className="flex items-center gap-2 mb-8 text-sm">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`inline-flex items-center justify-center h-7 w-7 rounded-full text-xs font-bold ${
                i < step
                  ? "bg-green-600 text-white"
                  : i === step
                    ? "bg-blue-600 text-white"
                    : "bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
              }`}
            >
              {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
            </span>
            <span className={i === step ? "font-medium" : "text-slate-500 dark:text-slate-400"}>
              {label}
            </span>
            {i < STEPS.length - 1 ? <span className="text-slate-300 dark:text-slate-600">→</span> : null}
          </li>
        ))}
      </ol>

      <Card>
        <CardContent className="pt-6 space-y-4">
          {step === 0 ? (
            <>
              <CardHeader className="p-0">
                <CardTitle className="text-lg">Шаг 1. Основная информация</CardTitle>
                <CardDescription>Название и описание увидят покупатели</CardDescription>
              </CardHeader>
              <div>
                <label htmlFor="res-title" className="text-sm text-slate-600 dark:text-slate-400">
                  Название (минимум 3 символа)
                </label>
                <Input
                  id="res-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Например: Система гонок для MTA:SA"
                  className="mt-1"
                />
              </div>
              <div>
                <label htmlFor="res-desc" className="text-sm text-slate-600 dark:text-slate-400">
                  Описание (минимум 10 символов)
                </label>
                <textarea
                  id="res-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Что делает ресурс, что входит в комплект..."
                  rows={5}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                />
                <p className="text-xs text-slate-400 mt-1">
                  {description.trim().length}/10 символов минимум
                </p>
              </div>
              <div>
                <label htmlFor="res-slug" className="text-sm text-slate-600 dark:text-slate-400">
                  Slug (адрес ресурса, только a-z, 0-9 и дефисы)
                </label>
                <Input
                  id="res-slug"
                  value={effectiveSlug}
                  onChange={(e) => {
                    setSlug(e.target.value.toLowerCase());
                    setSlugEdited(true);
                  }}
                  placeholder="race-system"
                  className={`mt-1 ${effectiveSlug && !/^[a-z0-9-]+$/.test(effectiveSlug) ? "border-red-400" : ""}`}
                />
                {!slugEdited && title ? (
                  <p className="text-xs text-slate-400 mt-1">
                    Предложен автоматически из названия — можно изменить.
                  </p>
                ) : null}
              </div>
              <div className="flex justify-end">
                <Button
                  disabled={!step1Valid}
                  onClick={() => {
                    setError(null);
                    setStep(1);
                  }}
                >
                  Далее <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <CardHeader className="p-0">
                <CardTitle className="text-lg">Шаг 2. Тип и цена</CardTitle>
                <CardDescription>
                  По кнопке «Создать черновик» ресурс будет создан (статус «Черновик»).
                </CardDescription>
              </CardHeader>
              <div>
                <label htmlFor="res-type" className="text-sm text-slate-600 dark:text-slate-400">
                  Тип ресурса
                </label>
                <select
                  id="res-type"
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="mt-1 h-10 w-full rounded-md border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                >
                  {RESOURCE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="res-price" className="text-sm text-slate-600 dark:text-slate-400">
                  Цена в рублях (0 — бесплатный ресурс)
                </label>
                <Input
                  id="res-price"
                  type="number"
                  min={0}
                  step="0.01"
                  value={priceRub}
                  onChange={(e) => setPriceRub(e.target.value)}
                  className="mt-1"
                />
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Итоговая цена: {formatRub(priceKopecks)}
                  {priceKopecks === 0 ? " (бесплатно)" : ""}
                </p>
              </div>
              {error ? <ErrorText message={error} /> : null}
              {draft ? (
                <p className="text-xs text-green-600 dark:text-green-400">
                  Черновик создан: /{draft.slug} (можно вернуться к нему из кабинета продавца).
                </p>
              ) : null}
              <div className="flex justify-between">
                <Button variant="ghost" disabled={createDraft.isPending || draft !== null} onClick={() => setStep(0)}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> Назад
                </Button>
                <Button
                  disabled={!step2Valid || createDraft.isPending}
                  onClick={() => (draft ? setStep(2) : createDraft.mutate())}
                >
                  {createDraft.isPending
                    ? "Создание черновика..."
                    : draft !== null
                      ? "Продолжить"
                      : "Создать черновик"}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <CardHeader className="p-0">
                <CardTitle className="text-lg">Шаг 3. Файл и версия</CardTitle>
                <CardDescription>
                  Черновик «{draft?.title ?? effectiveSlug}» создан. Загрузите архив ресурса —
                  сервер сам посчитает размер и контрольную сумму.
                </CardDescription>
              </CardHeader>
              <div>
                <label htmlFor="res-file" className="text-sm text-slate-600 dark:text-slate-400">
                  Файл ресурса (архив)
                </label>
                <input
                  id="res-file"
                  type="file"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="mt-1 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-white hover:file:bg-blue-700"
                />
                {upload ? (
                  <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                    Загружен: {upload.fileName} ({(upload.fileSize / 1024).toFixed(1)} КБ)
                  </p>
                ) : null}
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="res-version" className="text-sm text-slate-600 dark:text-slate-400">
                    Версия (формат 1.0.0)
                  </label>
                  <Input
                    id="res-version"
                    value={version}
                    onChange={(e) => setVersion(e.target.value)}
                    placeholder="1.0.0"
                    className="mt-1"
                  />
                  {version && !VERSION_RE.test(version.trim()) ? (
                    <p className="text-xs text-red-500 mt-1">Формат: x.y.z, например 1.0.0</p>
                  ) : null}
                </div>
                <div>
                  <label htmlFor="res-changelog" className="text-sm text-slate-600 dark:text-slate-400">
                    Список изменений (необязательно)
                  </label>
                  <Input
                    id="res-changelog"
                    value={changelog}
                    onChange={(e) => setChangelog(e.target.value)}
                    placeholder="Первый релиз"
                    className="mt-1"
                  />
                </div>
              </div>

              {validationIssues ? (
                <div className="p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
                  <p className="text-sm font-medium text-red-600 dark:text-red-400 mb-1">
                    Результат проверки артефакта:
                  </p>
                  <ul className="list-disc list-inside text-xs text-red-600 dark:text-red-400 space-y-0.5">
                    {validationIssues.map((issue, i) => (
                      <li key={i}>{issue}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {error ? <ErrorText message={error} /> : null}

              <div className="flex justify-between">
                <Button variant="ghost" disabled={attachVersion.isPending} onClick={() => setStep(1)}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> Назад
                </Button>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    disabled={attachVersion.isPending}
                    onClick={() => setStep(3)}
                  >
                    Пропустить
                  </Button>
                  <Button disabled={!step3Valid} onClick={() => attachVersion.mutate()}>
                    {attachVersion.isPending ? (
                      <>
                        <FileUp className="mr-2 h-4 w-4 animate-bounce" /> Загрузка...
                      </>
                    ) : (
                      <>
                        Загрузить и продолжить <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <CardHeader className="p-0">
                <CardTitle className="text-lg">Шаг 4. Оформление</CardTitle>
                <CardDescription>
                  Обложка и скриншоты показывают товар покупателям. Их можно добавить позже в
                  кабинете продавца — ресурс без обложки получит аккуратную текстовую заглушку.
                </CardDescription>
              </CardHeader>

              {draft ? (
                <MediaManager
                  slug={draft.slug}
                  initialCover={coverUrl}
                  initialScreenshots={screenshots}
                  onChange={({ cover, screenshots: shots }) => {
                    setCoverUrl(cover);
                    setScreenshots(shots);
                  }}
                />
              ) : null}

              {error ? <ErrorText message={error} /> : null}

              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep(2)}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> Назад
                </Button>
                <Button onClick={() => setStep(4)}>
                  Далее <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </>
          ) : null}

          {step === 4 ? (
            <>
              <CardHeader className="p-0">
                <CardTitle className="text-lg flex items-center gap-2">
                  <Rocket className="h-5 w-5 text-blue-600" /> Шаг 5. Проверка и отправка
                </CardTitle>
                <CardDescription>
                  Так покупатель увидит ваш ресурс на Маркетплейсе.
                </CardDescription>
              </CardHeader>

              {/* B-005: preview максимально похож на реальную Resource Card */}
              <div className="rounded-card border border-line p-4 bg-surface-raised">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-content-muted">
                  Так это выглядит в каталоге
                </p>
                <div className="max-w-xs">
                  <ResourceCard
                    resource={{
                      id: "preview",
                      slug: effectiveSlug,
                      title: title.trim() || "Без названия",
                      description: description.trim(),
                      type,
                      status: "DRAFT",
                      price: priceKopecks,
                      createdAt: new Date().toISOString(),
                      coverUrl,
                      seller: { username: user?.username ?? null, displayName: user?.displayName ?? null, avatar: user?.avatar ?? null },
                      rating: null,
                      reviewCount: 0,
                    }}
                  />
                </div>
              </div>

              <dl className="space-y-2 text-sm">
                <SummaryRow label="Название" value={title} />
                <SummaryRow label="Slug" value={`/${effectiveSlug}`} mono />
                <SummaryRow label="Тип" value={type} />
                <SummaryRow
                  label="Цена"
                  value={priceKopecks === 0 ? "Бесплатно" : formatRub(priceKopecks)}
                />
                <SummaryRow
                  label="Файл"
                  value={
                    upload
                      ? `${upload.fileName} · ${(upload.fileSize / 1024).toFixed(1)} КБ · SHA-256 ${upload.fileChecksum.slice(0, 12)}…`
                      : "Версия не прикреплена (можно сделать позже)"
                  }
                />
                <SummaryRow label="Версия" value={upload ? version : "—"} />
                {changelog.trim() ? <SummaryRow label="Изменения" value={changelog} /> : null}
                <SummaryRow
                  label="Обложка"
                  value={coverUrl ? "Загружена" : "Не задана (текстовая заглушка)"}
                />
                <SummaryRow label="Скриншоты" value={String(screenshots.length)} />
              </dl>

              <div className="p-3 rounded-md bg-blue-50 dark:bg-blue-900/20 text-sm text-blue-700 dark:text-blue-300">
                После отправки статус ресурса изменится на «На модерации». Публиковать ресурс
                будет модератор после проверки.
              </div>

              {error ? <ErrorText message={error} /> : null}

              <div className="flex justify-between">
                <Button variant="ghost" disabled={submitForReview.isPending} onClick={() => setStep(3)}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> Назад
                </Button>
                <Button
                  disabled={submitForReview.isPending}
                  onClick={() => submitForReview.mutate()}
                >
                  {submitForReview.isPending ? "Отправка..." : "Завершить"}
                  <Check className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>

      <p className="text-sm text-slate-500 dark:text-slate-400 mt-4">
        Черновики можно продолжить позже из{" "}
        <Link href="/seller" className="text-blue-600 hover:underline dark:text-blue-400">
          кабинета продавца
        </Link>
        .
      </p>
    </div>
  );
}

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500 dark:text-slate-400 flex-shrink-0">{label}</dt>
      <dd className={`text-right font-medium break-all ${mono ? "font-mono text-sm" : ""}`}>{value}</dd>
    </div>
  );
}
