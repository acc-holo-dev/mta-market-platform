// Тема форума (PLAN-005 F-003/F-004/F-005): посты, реакции, ответы,
// правка/удаление своих сообщений, жалобы, модерация состояния темы.
// Гостям доступно чтение (?page= в URL).
"use client";

import { Suspense, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Eye,
  Lock,
  Archive,
  Pin,
  PinOff,
  LockOpen,
  MessageSquare,
  MessageSquarePlus,
  Pencil,
  ThumbsUp,
  Trash2,
  Globe,
} from "lucide-react";
import { bootstrapSession } from "@/lib/api";
import {
  fetchThread,
  replyToThread,
  editForumPost,
  deleteForumPost,
  toggleReaction,
  setThreadState,
  followThread,
  unfollowThread,
  fetchMyThreadFollows,
  getErrorMessage,
  type ForumPostItem,
} from "@/lib/api-ext";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { Avatar } from "@/components/ui/Avatar";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { LoadingSpinner, EmptyState, ErrorState } from "@/components/ui/States";
import { ThreadStateChip, PinnedChip, authorName } from "@/components/community/ThreadRow";
import { ReportDialog } from "@/components/community/ReportDialog";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------- Сообщение: реакции, правка, удаление, жалоба ----------
function PostItem({
  post,
  isOwn,
  onDelete,
}: {
  post: ForumPostItem;
  isOwn: boolean;
  onDelete: (post: ForumPostItem) => void;
}) {
  const router = useRouter();
  const qc = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const react = useMutation({
    mutationFn: () => toggleReaction(post.id, "LIKE"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["community"] }),
    onError: (e) => setActionError(getErrorMessage(e, "Не удалось поставить реакцию")),
  });

  const saveEdit = useMutation({
    mutationFn: () => editForumPost(post.id, editText.trim()),
    onSuccess: () => {
      setEditing(false);
      setActionError(null);
      qc.invalidateQueries({ queryKey: ["community"] });
    },
    onError: (e) => setActionError(getErrorMessage(e, "Не удалось сохранить изменения")),
  });

  const reacted = post.reactedByMe.includes("LIKE");
  const name = authorName(post.author) ?? "Автор";

  return (
    <div className="p-4 rounded-card border border-line bg-surface-raised">
      <div className="flex items-start gap-3">
        <Avatar src={post.author?.avatar} name={name} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            {post.author?.username ? (
              <Link
                href={`/profile/${post.author.username}`}
                className="font-semibold hover:text-accent-strong"
              >
                {name}
              </Link>
            ) : (
              <span className="font-semibold">{name}</span>
            )}
            <span className="text-xs text-content-muted">#{post.position + 1}</span>
            <span className="text-xs text-content-muted">{formatDateTime(post.createdAt)}</span>
            {post.edited && !post.deleted ? (
              <span className="text-xs text-content-muted">· изменено</span>
            ) : null}
          </div>

          <div className="mt-2">
            {post.deleted ? (
              <p className="text-sm italic text-content-muted">Сообщение удалено</p>
            ) : editing ? (
              <div className="space-y-2">
                <Textarea
                  aria-label="Редактирование сообщения"
                  value={editText}
                  rows={4}
                  onChange={(e) => setEditText(e.target.value)}
                  disabled={saveEdit.isPending}
                />
                {actionError ? <p className="text-sm text-bad">{actionError}</p> : null}
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setEditing(false);
                      setActionError(null);
                    }}
                    disabled={saveEdit.isPending}
                  >
                    Отмена
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => saveEdit.mutate()}
                    disabled={saveEdit.isPending || editText.trim().length === 0}
                  >
                    {saveEdit.isPending ? "Сохранение..." : "Сохранить"}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="whitespace-pre-wrap text-content">{post.content}</p>
            )}
          </div>

          {!editing ? (
            <div className="mt-3 flex flex-wrap items-center gap-1">
              {actionError ? <p className="mr-2 text-sm text-bad">{actionError}</p> : null}
              <button
                type="button"
                onClick={() => {
                  if (!isAuthenticated()) {
                    router.push("/auth/login");
                    return;
                  }
                  if (!react.isPending) react.mutate();
                }}
                aria-pressed={reacted}
                aria-label="Реакция «нравится»"
                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors ${
                  reacted
                    ? "bg-accent-soft text-accent-strong"
                    : "text-content-secondary hover:bg-surface-hover hover:text-content"
                }`}
              >
                <ThumbsUp className="h-4 w-4" aria-hidden />
                {post.reactionCount}
              </button>

              {isOwn && !post.deleted ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditText(post.content ?? "");
                    setEditing(true);
                  }}
                >
                  <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden />
                  Изменить
                </Button>
              ) : null}

              {isOwn && !post.deleted ? (
                <Button variant="ghost" size="sm" onClick={() => onDelete(post)}>
                  <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden />
                  Удалить
                </Button>
              ) : null}

              <ReportDialog targetType="POST" targetId={post.id} className="px-2" />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ---------- Страница темы ----------
function ThreadPageContent() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const threadId = params?.id ?? "";
  const searchParams = useSearchParams();
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);

  const { user, isAuthenticated } = useAuthStore();
  const qc = useQueryClient();
  const [booted, setBooted] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);
  const [modError, setModError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ForumPostItem | null>(null);

  // Публичная страница: сессию тихо восстанавливаем, гостя не редиректим.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await bootstrapSession();
      if (!cancelled) setBooted(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["community", "thread", threadId, page],
    queryFn: () => fetchThread(threadId, page),
    enabled: booted && threadId.length > 0,
    placeholderData: keepPreviousData,
    retry: false,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["community"] });

  const reply = useMutation({
    mutationFn: () => replyToThread(threadId, replyText.trim()),
    onSuccess: () => {
      setReplyText("");
      setReplyError(null);
      qc.invalidateQueries({ queryKey: ["community"] });
    },
    onError: (e) => setReplyError(getErrorMessage(e, "Не удалось отправить ответ")),
  });

  const removePost = useMutation({
    mutationFn: (postId: string) => deleteForumPost(postId),
    onSuccess: () => {
      setDeleteTarget(null);
      setReplyError(null);
      qc.invalidateQueries({ queryKey: ["community"] });
    },
    onError: (e) => {
      setDeleteTarget(null);
      setReplyError(getErrorMessage(e, "Не удалось удалить сообщение"));
    },
  });

  const moderate = useMutation({
    mutationFn: (payload: { state?: string; pinned?: boolean }) =>
      setThreadState(threadId, payload.state, payload.pinned),
    onSuccess: () => {
      setModError(null);
      qc.invalidateQueries({ queryKey: ["community"] });
    },
    onError: (e) => setModError(getErrorMessage(e, "Не удалось изменить состояние темы")),
  });

  if (!booted) return null;

  const thread = data?.thread;
  const category = data?.category;
  const server = data?.server;
  const posts = data?.data ?? [];
  const isModerator = user?.role === "ADMIN" || user?.role === "MODERATOR";
  const openThread = thread?.state === "OPEN";

  // Автор темы: API отдаёт в thread сырую строку без author — берём автора
  // первого сообщения (position 0), он доступен на первой странице.
  const firstPost = posts.find((p) => p.position === 0);
  const threadAuthor = firstPost?.author ?? thread?.author ?? null;
  const threadAuthorName = authorName(threadAuthor);

  const changePage = (next: number) => {
    router.push(next > 1 ? `/community/forum/thread/${threadId}?page=${next}` : `/community/forum/thread/${threadId}`, {
      scroll: false,
    });
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      {isLoading ? (
        <LoadingSpinner label="Загрузка темы..." />
      ) : error || !thread ? (
        <ErrorState error={error ?? new Error("Тема не найдена")} onRetry={() => refetch()} />
      ) : (
        <>
          <nav aria-label="Хлебные крошки" className="mb-4 text-sm text-content-muted">
            <Link href="/community" className="hover:text-accent-strong">
              Сообщество
            </Link>
            {category ? (
              <>
                <span className="mx-2">/</span>
                <Link href={`/community/forum/${category.slug}`} className="hover:text-accent-strong">
                  {category.name}
                </Link>
              </>
            ) : null}
          </nav>

          {/* Заголовок + метаданные */}
          <div className="mb-6">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-bold tracking-tight">{thread.title}</h1>
              {thread.pinned ? <PinnedChip /> : null}
              <ThreadStateChip state={thread.state} />
              <ThreadFollowButton threadId={threadId} followersCount={data.followersCount ?? 0} />
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-content-secondary">
              {threadAuthorName ? (
                <span className="inline-flex items-center gap-1.5">
                  <Avatar
                    src={threadAuthor?.avatar}
                    name={threadAuthorName}
                    size="sm"
                    className="h-6 w-6 text-[11px]"
                  />
                  {threadAuthor?.username ? (
                    <Link href={`/profile/${threadAuthor.username}`} className="hover:text-accent-strong">
                      {threadAuthorName}
                    </Link>
                  ) : (
                    <span>{threadAuthorName}</span>
                  )}
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1">
                <Eye className="h-3.5 w-3.5" aria-hidden />
                {thread.views ?? 0}
              </span>
              <span className="inline-flex items-center gap-1">
                <MessageSquare className="h-3.5 w-3.5" aria-hidden />
                {thread.replyCount}
              </span>
              <span>{formatDateTime(thread.createdAt)}</span>
              {server ? (
                <Link
                  href={`/servers/${server.slug}`}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-content-secondary hover:text-accent-strong"
                >
                  <Globe className="h-3.5 w-3.5" aria-hidden />
                  {server.name}
                </Link>
              ) : null}
              <ReportDialog targetType="THREAD" targetId={thread.id} />
            </div>

            {/* Модерация темы (ADMIN/MODERATOR) */}
            {isModerator ? (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => moderate.mutate({ pinned: !thread.pinned })}
                  disabled={moderate.isPending}
                >
                  {thread.pinned ? (
                    <>
                      <PinOff className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                      Открепить
                    </>
                  ) : (
                    <>
                      <Pin className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                      Закрепить
                    </>
                  )}
                </Button>
                {thread.state === "OPEN" ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => moderate.mutate({ state: "LOCKED" })}
                      disabled={moderate.isPending}
                    >
                      <Lock className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                      Закрыть
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => moderate.mutate({ state: "ARCHIVED" })}
                      disabled={moderate.isPending}
                    >
                      <Archive className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                      В архив
                    </Button>
                  </>
                ) : thread.state === "LOCKED" ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => moderate.mutate({ state: "OPEN" })}
                      disabled={moderate.isPending}
                    >
                      <LockOpen className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                      Открыть
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => moderate.mutate({ state: "ARCHIVED" })}
                      disabled={moderate.isPending}
                    >
                      <Archive className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                      В архив
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => moderate.mutate({ state: "OPEN" })}
                    disabled={moderate.isPending}
                  >
                    <LockOpen className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                    Открыть
                  </Button>
                )}
                {modError ? <p className="text-sm text-bad">{modError}</p> : null}
              </div>
            ) : null}
          </div>

          {/* Посты */}
          {posts.length === 0 ? (
            <EmptyState icon={<MessageSquare className="h-12 w-12" />} title="Сообщений пока нет" />
          ) : (
            <div className="space-y-3">
              {posts.map((post) => (
                <PostItem
                  key={post.id}
                  post={post}
                  isOwn={Boolean(user && post.author.id === user.id)}
                  onDelete={setDeleteTarget}
                />
              ))}
            </div>
          )}

          {/* Пагинация (?page=) */}
          {data && data.pagination.pages > 1 ? (
            <nav className="flex items-center justify-center gap-4 mt-8" aria-label="Постраничная навигация">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => changePage(page - 1)}
              >
                Назад
              </Button>
              <span className="text-sm text-content-secondary">
                Страница {data.pagination.page} из {data.pagination.pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= data.pagination.pages}
                onClick={() => changePage(page + 1)}
              >
                Вперёд
              </Button>
            </nav>
          ) : null}

          {/* Форма ответа */}
          <div className="mt-8">
            {!openThread ? (
              <div className="p-4 rounded-card border border-line bg-surface-raised">
                <p className="flex items-center gap-2 font-medium">
                  <Lock className="h-4 w-4 text-content-muted" aria-hidden />
                  {thread.state === "ARCHIVED" ? "Тема в архиве" : "Тема закрыта"}
                </p>
                <p className="mt-1 text-sm text-content-secondary">
                  Новые ответы в этой теме недоступны.
                </p>
              </div>
            ) : !isAuthenticated() ? (
              <div className="p-4 rounded-card border border-line bg-surface-raised text-center">
                <p className="font-medium">Войдите, чтобы ответить</p>
                <Button size="sm" className="mt-3" onClick={() => router.push("/auth/login")}>
                  Войти
                </Button>
              </div>
            ) : (
              <div className="p-4 rounded-card border border-line bg-surface-raised space-y-3">
                <h2 className="font-semibold">Ваш ответ</h2>
                <Textarea
                  aria-label="Текст ответа"
                  placeholder="Напишите ответ..."
                  rows={4}
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  disabled={reply.isPending}
                />
                {replyError ? <p className="text-sm text-bad">{replyError}</p> : null}
                <div className="flex justify-end">
                  <Button
                    onClick={() => reply.mutate()}
                    disabled={reply.isPending || replyText.trim().length === 0}
                  >
                    <MessageSquarePlus className="mr-2 h-4 w-4" aria-hidden />
                    {reply.isPending ? "Отправка..." : "Ответить"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Мягкое удаление своего сообщения */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title="Удалить сообщение?"
        description="Сообщение будет скрыто. Действие нельзя отменить."
        confirmLabel="Удалить"
        danger
        busy={removePost.isPending}
        onConfirm={() => {
          if (deleteTarget) removePost.mutate(deleteTarget.id);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export default function ThreadViewPage() {
  // useSearchParams требует Suspense-границу при пререндере (как /resources).
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-5xl px-4 py-10">
          <LoadingSpinner label="Загрузка темы..." />
        </div>
      }
    >
      <ThreadPageContent />
    </Suspense>
  );
}

// ---------- PLAN-009: Thread Follow (Community Loop completion, §10) ----------
// The follower list is never exposed — only the aggregate count (§42).
// The own follow state is read from /me/follows/threads, only within a
// session (a guest must not trigger the global session-expiry redirect).
function ThreadFollowButton({ threadId, followersCount }: { threadId: string; followersCount: number }) {
  const { user, accessToken, isAuthenticated } = useAuthStore();
  const qc = useQueryClient();
  const router = useRouter();
  const [override, setOverride] = useState<{ following: boolean; count: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: myFollows } = useQuery({
    queryKey: ["me", "follows", "threads", accessToken ?? "guest"],
    queryFn: fetchMyThreadFollows,
    enabled: isAuthenticated() && !!accessToken,
    retry: false,
  });
  const isFollowing = override
    ? override.following
    : (myFollows ?? []).some((t: any) => t.id === threadId);
  const count = override ? override.count : followersCount;

  const toggle = useMutation({
    mutationFn: () => (isFollowing ? unfollowThread(threadId) : followThread(threadId)),
    onSuccess: (res: any) => {
      setOverride({ following: res.following, count: res.followersCount });
      setError(null);
      qc.invalidateQueries({ queryKey: ["me", "follows", "threads"] });
    },
    onError: (e) => setError(getErrorMessage(e, "Не удалось изменить подписку")),
  });

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        variant={isFollowing ? "outline" : "secondary"}
        size="sm"
        disabled={toggle.isPending}
        onClick={() => {
          if (!isAuthenticated() || !user) {
            router.push("/auth/login");
            return;
          }
          toggle.mutate();
        }}
      >
        {isFollowing ? "Не следить" : "Следить"}
      </Button>
      <span className="inline-flex items-center gap-1 text-sm text-content-secondary">
        <Eye className="h-3.5 w-3.5" aria-hidden />
        {count.toLocaleString("ru-RU")} следят
      </span>
      {error ? <span className="text-xs text-red-400">{error}</span> : null}
    </span>
  );
}
