// Мастер регистрации сервера (PLAN-005 B): 5 шагов на одной странице —
// Основное → Подключение → Брендинг → Приватность → Верификация.
// Сервер создаётся на шаге 1 (createServer), дальше шаги через updateServer /
// updateServerPrivacy / issueIntegrationToken. Только для авторизованных.
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Check,
  Copy,
  Eye,
  Globe,
  ImageIcon,
  KeyRound,
  Loader2,
  Lock,
  Plug,
  RefreshCcw,
  Server,
  ShieldCheck,
} from "lucide-react";
import { bootstrapSession } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import {
  createServer,
  fetchVerification,
  getErrorMessage,
  issueIntegrationToken,
  mediaUrl,
  updateServer,
  updateServerPrivacy,
  uploadMedia,
  type ServerFull,
} from "@/lib/api-ext";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input, Textarea } from "@/components/ui/Input";
import { LoadingSpinner } from "@/components/ui/States";
import { VerificationBadge } from "@/components/servers/ServerCard";

const STEPS: [number, string][] = [
  [1, "Основное"],
  [2, "Подключение"],
  [3, "Брендинг"],
  [4, "Приватность"],
  [5, "Верификация"],
];

const VERIFICATION_LABELS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Ожидает подтверждения", cls: "bg-accent-soft text-accent-strong border-accent/30" },
  VERIFIED: { label: "Подтверждён", cls: "bg-ok/10 text-ok border-ok/30" },
  FAILED: { label: "Не прошёл проверку", cls: "bg-bad/10 text-bad border-bad/30" },
  EXPIRED: { label: "Токен истёк", cls: "bg-surface-hover text-content-secondary border-line" },
};

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export default function ServerCreatePage() {
  const router = useRouter();
  const { isAuthenticated } = useAuthStore();

  // Auth-guard bootstrap (как на /dashboard): гость уходит на /auth/login.
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await bootstrapSession();
      if (!cancelled && !ok) {
        router.push("/auth/login");
      }
      if (!cancelled) setBooted(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!booted || !isAuthenticated()) {
    return null;
  }

  return <ServerWizard />;
}

function ServerWizard() {
  const [step, setStep] = useState(1);
  const [created, setCreated] = useState<ServerFull | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // Шаг 1 — Основное
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [region, setRegion] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [discordUrl, setDiscordUrl] = useState("");

  // Шаг 2 — Подключение
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");

  // Шаг 3 — Брендинг
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);

  // Шаг 4 — Приватность (по умолчанию всё приватно, showStats — true)
  const [showStats, setShowStats] = useState(true);
  const [showStaff, setShowStaff] = useState(false);
  const [showResources, setShowResources] = useState(false);
  const [showTechStack, setShowTechStack] = useState(false);
  const [showCommunity, setShowCommunity] = useState(false);

  // Шаг 5 — Верификация
  const [token, setToken] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: () =>
      createServer({
        name: name.trim(),
        description: description.trim() || undefined,
        region: region.trim() || undefined,
        websiteUrl: websiteUrl.trim() || undefined,
        discordUrl: discordUrl.trim() || undefined,
      }),
    onSuccess: (data) => {
      setCreated(data);
      setFormError(null);
      setStep(2);
    },
    onError: (err) => setFormError(getErrorMessage(err, "Не удалось создать сервер")),
  });

  const updateMut = useMutation({
    mutationFn: (patch: Record<string, unknown>) => updateServer(created!.slug, patch),
    onError: (err) => setFormError(getErrorMessage(err)),
  });

  const privacyMut = useMutation({
    mutationFn: () =>
      updateServerPrivacy(created!.slug, { showStats, showStaff, showResources, showTechStack, showCommunity }),
    onSuccess: () => {
      setFormError(null);
      setStep(5);
    },
    onError: (err) => setFormError(getErrorMessage(err, "Не удалось сохранить настройки приватности")),
  });

  const submitStep1 = () => {
    const nameTrimmed = name.trim();
    if (nameTrimmed.length < 3 || nameTrimmed.length > 60) {
      setFormError("Название сервера: от 3 до 60 символов");
      return;
    }
    if (websiteUrl.trim() && !isHttpUrl(websiteUrl.trim())) {
      setFormError("Сайт должен быть ссылкой вида https://...");
      return;
    }
    if (discordUrl.trim() && !isHttpUrl(discordUrl.trim())) {
      setFormError("Ссылка на Discord должна быть вида https://...");
      return;
    }
    setFormError(null);
    createMut.mutate();
  };

  const submitStep2 = () => {
    const portNum = port.trim() === "" ? null : parseInt(port.trim(), 10);
    if (host.trim() && !portNum) {
      setFormError("Укажите порт вместе с хостом");
      return;
    }
    if (portNum !== null && (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535)) {
      setFormError("Порт должен быть целым числом от 1 до 65535");
      return;
    }
    setFormError(null);
    updateMut.mutate(
      { host: host.trim() || null, port: portNum },
      { onSuccess: () => setStep(3) }
    );
  };

  const submitStep4 = () => {
    setFormError(null);
    privacyMut.mutate();
  };

  const goToStep = (target: number) => {
    // Назад — свободно; вперёд — только по пройденным шагам.
    if (!created && target > 1) return;
    if (created && target > step) return;
    setFormError(null);
    setStep(target);
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <nav aria-label="Хлебные крошки" className="mb-4 text-sm text-content-muted">
        <Link href="/" className="hover:text-accent-strong">
          Главная
        </Link>
        <span className="mx-2">/</span>
        <Link href="/servers" className="hover:text-accent-strong">
          Серверы
        </Link>
        <span className="mx-2">/</span>
        <span className="text-content-secondary">Регистрация</span>
      </nav>

      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Регистрация сервера</h1>
        <p className="mt-1 text-content-secondary">
          Подключите свой сервер MTA:SA к MTA Market: профиль, мониторинг, новости и отзывы игроков.
        </p>
      </div>

      {/* Индикатор шагов */}
      <ol className="mb-8 flex flex-wrap items-center gap-2" aria-label="Шаги регистрации">
        {STEPS.map(([num, label]) => {
          const done = created !== null && num < step;
          const active = num === step;
          const reachable = done || active || (created !== null && num <= step);
          return (
            <li key={num}>
              <button
                type="button"
                onClick={() => goToStep(num)}
                disabled={!reachable}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "border-accent bg-accent-soft text-accent-strong"
                    : done
                      ? "border-ok/30 bg-ok/10 text-ok"
                      : "border-line text-content-muted"
                } ${reachable ? "cursor-pointer" : "cursor-not-allowed"}`}
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                    done ? "bg-ok/20" : active ? "bg-accent text-white" : "bg-surface-hover"
                  }`}
                >
                  {done ? <Check className="h-3 w-3" /> : num}
                </span>
                {label}
              </button>
            </li>
          );
        })}
      </ol>

      {created ? (
        <p className="mb-6 flex items-center gap-2 rounded-card border border-ok/30 bg-ok/10 px-4 py-3 text-sm text-ok">
          <Server className="h-4 w-4" />
          Сервер создан: <span className="font-semibold">{created.name}</span>
          <VerificationBadge verification={created.verification} />
        </p>
      ) : null}

      {formError ? (
        <p role="alert" className="mb-6 rounded-card border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">
          {formError}
        </p>
      ) : null}

      {/* Шаг 1 — Основное */}
      {step === 1 ? (
        <Card>
          <CardHeader>
            <CardTitle>Основное</CardTitle>
            <CardDescription>Название и описание увидят все игроки в каталоге серверов.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label htmlFor="srv-name" className="mb-1.5 block text-sm font-medium">
                Название <span className="text-bad">*</span>
              </label>
              <Input
                id="srv-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="От 3 до 60 символов"
                maxLength={60}
              />
              <p className="mt-1 text-xs text-content-muted">{name.trim().length}/60 символов</p>
            </div>
            <div>
              <label htmlFor="srv-desc" className="mb-1.5 block text-sm font-medium">
                Описание
              </label>
              <Textarea
                id="srv-desc"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Чем живёт ваш сервер: режим, особенности, сообщество..."
                maxLength={8000}
              />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="srv-region" className="mb-1.5 block text-sm font-medium">
                  Регион
                </label>
                <Input
                  id="srv-region"
                  value={region}
                  onChange={(e) => setRegion(e.target.value)}
                  placeholder="EU, RU, CIS..."
                  maxLength={64}
                />
              </div>
              <div>
                <label htmlFor="srv-site" className="mb-1.5 block text-sm font-medium">
                  Сайт
                </label>
                <Input
                  id="srv-site"
                  type="url"
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  placeholder="https://example.com"
                />
              </div>
            </div>
            <div>
              <label htmlFor="srv-discord" className="mb-1.5 block text-sm font-medium">
                Discord
              </label>
              <Input
                id="srv-discord"
                type="url"
                value={discordUrl}
                onChange={(e) => setDiscordUrl(e.target.value)}
                placeholder="https://discord.gg/..."
              />
            </div>
            <Button className="w-full sm:w-auto" onClick={submitStep1} disabled={createMut.isPending}>
              {createMut.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Создаём...
                </>
              ) : (
                "Создать сервер"
              )}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* Шаг 2 — Подключение */}
      {step === 2 && created ? (
        <Card>
          <CardHeader>
            <CardTitle>Подключение</CardTitle>
            <CardDescription>
              Адрес нужен модулю мониторинга для опроса онлайна. Данные не публикуются автоматически:
              host и port остаются приватными и не показываются на странице сервера.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
              <div>
                <label htmlFor="srv-host" className="mb-1.5 block text-sm font-medium">
                  Host (приватно по умолчанию)
                </label>
                <Input
                  id="srv-host"
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder="mta.example.com"
                />
              </div>
              <div>
                <label htmlFor="srv-port" className="mb-1.5 block text-sm font-medium">
                  Port (приватно по умолчанию)
                </label>
                <Input
                  id="srv-port"
                  inputMode="numeric"
                  value={port}
                  onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ""))}
                  placeholder="22003"
                />
              </div>
            </div>
            <p className="flex items-start gap-2 text-xs text-content-secondary">
              <Lock className="mt-0.5 h-4 w-4 flex-shrink-0 text-content-muted" />
              Эти поля никогда не попадают в публичный API — их видит только платформа.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button onClick={submitStep2} disabled={updateMut.isPending}>
                {updateMut.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Сохраняем...
                  </>
                ) : (
                  "Сохранить и продолжить"
                )}
              </Button>
              <Button variant="ghost" onClick={() => setStep(3)} disabled={updateMut.isPending}>
                Пропустить
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Шаг 3 — Брендинг */}
      {step === 3 && created ? (
        <Card>
          <CardHeader>
            <CardTitle>Брендинг</CardTitle>
            <CardDescription>Логотип и баннер украсят карточку и страницу сервера.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <MediaUploadField
              label="Логотип"
              hint="Квадратное изображение, до 5 МБ"
              value={logoUrl}
              previewClass="h-16 w-16 rounded-xl"
              onUploaded={(url) => {
                setLogoUrl(url);
                updateMut.mutate({ logoUrl: url });
              }}
              onCleared={() => {
                setLogoUrl(null);
                updateMut.mutate({ logoUrl: null });
              }}
            />
            <MediaUploadField
              label="Баннер"
              hint="Широкое изображение для шапки страницы, до 5 МБ"
              value={bannerUrl}
              previewClass="h-24 w-full max-w-md rounded-card object-cover"
              onUploaded={(url) => {
                setBannerUrl(url);
                updateMut.mutate({ bannerUrl: url });
              }}
              onCleared={() => {
                setBannerUrl(null);
                updateMut.mutate({ bannerUrl: null });
              }}
            />
            {updateMut.error ? (
              <p role="alert" className="text-sm text-bad">
                {getErrorMessage(updateMut.error)}
              </p>
            ) : null}
            <Button onClick={() => setStep(4)}>Продолжить</Button>
          </CardContent>
        </Card>
      ) : null}

      {/* Шаг 4 — Приватность */}
      {step === 4 && created ? (
        <Card>
          <CardHeader>
            <CardTitle>Приватность и видимость</CardTitle>
            <CardDescription>
              По умолчанию всё приватно: публичной остаётся только базовая статистика онлайна.
              Каждую опцию можно включить позже в панели управления.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <PrivacyToggle
              checked={showStats}
              onChange={setShowStats}
              label="Показывать статистику онлайна"
              description="Счётчик «N/M онлайн», время последней активности и график онлайна станут видны всем."
            />
            <PrivacyToggle
              checked={showStaff}
              onChange={setShowStaff}
              label="Показывать персонал"
              description="Список администрации сервера появится на публичной странице."
            />
            <PrivacyToggle
              checked={showResources}
              onChange={setShowResources}
              label="Показывать ресурсы"
              description="Используемые сервером ресурсы Маркетплейса будут видны на публичной странице."
            />
            <PrivacyToggle
              checked={showTechStack}
              onChange={setShowTechStack}
              label="Показывать технологический стек"
              description="Технологии, на которых работает сервер, будут видны на публичной странице."
            />
            <PrivacyToggle
              checked={showCommunity}
              onChange={setShowCommunity}
              label="Показывать сообщество"
              description="Вкладка «Сообщество»: участники сервера и обсуждения на форуме."
            />
            <div className="flex flex-col gap-2 pt-2 sm:flex-row">
              <Button onClick={submitStep4} disabled={privacyMut.isPending}>
                {privacyMut.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Сохраняем...
                  </>
                ) : (
                  "Сохранить и продолжить"
                )}
              </Button>
              <Button variant="ghost" onClick={() => setStep(5)} disabled={privacyMut.isPending}>
                Пропустить
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Шаг 5 — Верификация */}
      {step === 5 && created ? (
        <VerificationStep slug={created.slug} token={token} onToken={setToken} />
      ) : null}
    </div>
  );
}

/** Шаг 5: выпуск токена интеграции (показывается один раз) + состояние верификации. */
function VerificationStep({
  slug,
  token,
  onToken,
}: {
  slug: string;
  token: string | null;
  onToken: (t: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [issueError, setIssueError] = useState<string | null>(null);

  const verifyQuery = useQuery({
    queryKey: ["server-verification", slug],
    queryFn: () => fetchVerification(slug),
  });

  const issueMut = useMutation({
    mutationFn: () => issueIntegrationToken(slug),
    onSuccess: (data) => {
      onToken(data.token);
      setIssueError(null);
      verifyQuery.refetch();
    },
    onError: (err) => setIssueError(getErrorMessage(err, "Не удалось выпустить токен")),
  });

  const copy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setIssueError("Не удалось скопировать — выделите токен вручную");
    }
  };

  const state = verifyQuery.data;
  const badge = state ? VERIFICATION_LABELS[state.verification] ?? null : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-accent" />
          Верификация
        </CardTitle>
        <CardDescription>
          Токен интеграции подтверждает, что сервером управляет владелец. Он показывается только один
          раз — сохраните его сразу.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Состояние верификации */}
        <div className="rounded-card border border-line bg-surface-raised p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-content-secondary">Статус:</span>
              {verifyQuery.isLoading ? (
                <LoadingSpinner label="" className="py-0" />
              ) : badge ? (
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${badge.cls}`}>
                  {badge.label}
                </span>
              ) : (
                <span className="text-sm text-content-muted">Токен ещё не выпущен</span>
              )}
            </div>
            <Button variant="outline" size="sm" onClick={() => verifyQuery.refetch()} disabled={verifyQuery.isFetching}>
              <RefreshCcw className={`mr-2 h-4 w-4 ${verifyQuery.isFetching ? "animate-spin" : ""}`} />
              Обновить
            </Button>
          </div>
          {state?.note ? <p className="mt-3 text-sm text-content-secondary">{state.note}</p> : null}
          {state?.verifiedAt ? (
            <p className="mt-1 text-xs text-content-muted">
              Подтверждён: {new Date(state.verifiedAt).toLocaleString("ru-RU")}
            </p>
          ) : null}
        </div>

        {/* Выпуск токена */}
        {token ? (
          <div className="space-y-3">
            <p className="text-sm font-medium">Ваш токен интеграции (показывается один раз):</p>
            <div className="flex items-start gap-2 rounded-card border border-accent bg-accent-soft p-4">
              <code className="min-w-0 flex-1 break-all font-mono text-sm text-accent-strong select-all">
                {token}
              </code>
              <Button variant="outline" size="sm" onClick={copy}>
                {copied ? (
                  <>
                    <Check className="mr-1 h-4 w-4 text-ok" />
                    Скопировано
                  </>
                ) : (
                  <>
                    <Copy className="mr-1 h-4 w-4" />
                    Копировать
                  </>
                )}
              </Button>
            </div>
            <div className="space-y-2 rounded-card border border-line bg-surface-raised p-4 text-sm text-content-secondary">
              <p className="flex items-start gap-2">
                <Plug className="mt-0.5 h-4 w-4 flex-shrink-0 text-content-muted" />
                Скопируйте токен и установите его в конфигурацию модуля интеграции на вашем сервере MTA:SA.
              </p>
              <p className="flex items-start gap-2">
                <Eye className="mt-0.5 h-4 w-4 flex-shrink-0 text-content-muted" />
                Статус VERIFIED появится после первого heartbeat от модуля — проверьте состояние кнопкой
                «Обновить» через пару минут.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <Button onClick={() => issueMut.mutate()} disabled={issueMut.isPending}>
              {issueMut.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Выпускаем...
                </>
              ) : (
                <>
                  <KeyRound className="mr-2 h-4 w-4" />
                  Выпустить токен интеграции
                </>
              )}
            </Button>
            {issueError ? (
              <p role="alert" className="text-sm text-bad">
                {issueError}
              </p>
            ) : null}
          </div>
        )}

        {/* Финал */}
        <div className="flex flex-col gap-3 border-t border-line pt-6 sm:flex-row sm:items-center">
          <Link href={`/servers/${slug}`}>
            <Button size="md">
              <Globe className="mr-2 h-4 w-4" />
              Открыть страницу сервера
            </Button>
          </Link>
          <Link href="/dashboard">
            <Button variant="ghost">В кабинет</Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

/** Поле загрузки изображения с превью (uploadMedia → URL). */
function MediaUploadField({
  label,
  hint,
  value,
  previewClass,
  onUploaded,
  onCleared,
}: {
  label: string;
  hint?: string;
  value: string | null;
  previewClass?: string;
  onUploaded: (url: string) => void;
  onCleared: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const res = await uploadMedia(file);
      onUploaded(res.url);
    } catch (err) {
      setError(getErrorMessage(err, "Не удалось загрузить изображение"));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const resolved = mediaUrl(value);

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      {hint ? <p className="text-xs text-content-muted">{hint}</p> : null}
      <div className="flex flex-wrap items-center gap-4">
        {resolved ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={resolved} alt={label} loading="lazy" className={previewClass ?? "h-16 w-16 rounded-xl object-cover"} />
        ) : (
          <div
            className={`flex items-center justify-center border border-dashed border-line bg-surface-raised text-content-muted ${
              previewClass?.includes("w-full") ? "h-24 w-full max-w-md" : "h-16 w-16 rounded-xl"
            }`}
          >
            <ImageIcon className="h-4 w-4" />
          </div>
        )}
        <div className="space-y-2">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            onChange={onFile}
            disabled={uploading}
            aria-label={`Загрузить ${label.toLowerCase()}`}
            className="block w-full text-sm text-content-secondary file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-surface-hover file:px-3 file:py-1.5 file:text-sm file:text-content hover:file:bg-accent-soft"
          />
          {value ? (
            <Button variant="ghost" size="sm" onClick={onCleared} disabled={uploading}>
              Убрать
            </Button>
          ) : null}
          {uploading ? (
            <p className="flex items-center gap-2 text-xs text-content-secondary">
              <Loader2 className="h-4 w-4 animate-spin" />
              Загрузка...
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="text-xs text-bad">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Переключатель приватности в стиле платформы. */
function PrivacyToggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start justify-between gap-4 rounded-card border border-line bg-surface-raised p-4 text-left transition-colors hover:bg-surface-hover"
    >
      <span className="flex items-start gap-3">
        {checked ? (
          <Eye className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent" />
        ) : (
          <Lock className="mt-0.5 h-4 w-4 flex-shrink-0 text-content-muted" />
        )}
        <span>
          <span className="block text-sm font-medium text-content">{label}</span>
          <span className="mt-1 block text-xs text-content-secondary">{description}</span>
        </span>
      </span>
      <span
        className={`mt-0.5 inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full border transition-colors ${
          checked ? "border-accent bg-accent" : "border-line bg-surface-hover"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </span>
    </button>
  );
}
