// PLAN-016 D-009: честная 404 (§41 — никаких фейковых ссылок).
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center px-4 py-20 text-center">
      <p className="text-5xl font-extrabold tracking-tight">404</p>
      <p className="mt-2 text-lg font-semibold">Страница не найдена</p>
      <p className="mt-1 text-sm text-content-secondary">
        Такого раздела на MTA Market нет — возможно, ссылка устарела.
      </p>
      <div className="mt-6 flex gap-3">
        <Link
          href="/"
          className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent transition-colors duration-fast hover:bg-accent-strong"
        >
          На главную
        </Link>
        <Link
          href="/servers"
          className="rounded-md border border-line-strong px-4 py-2 text-sm font-medium text-content transition-colors duration-fast hover:bg-surface-hover"
        >
          Каталог серверов
        </Link>
      </div>
    </div>
  );
}