// PLAN-016 D-009: route-level error boundary (ru, честное состояние ошибки
// с retry — §41/§48). Глобальная точка, не дубль постраничных состояний.
"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Деградированные поверхности логируются метрикой на бэкенде; здесь —
    // только signal в консоль для dev-инструментов.
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center px-4 py-20 text-center">
      <p className="text-2xl font-bold tracking-tight">Что-то пошло не так</p>
      <p className="mt-2 text-sm text-content-secondary" role="alert">
        Произошла ошибка при отображении страницы. Попробуйте повторить —
        если ошибка повторяется, загляните позже.
      </p>
      {error.digest ? (
        <p className="mt-1 text-xs text-content-muted tabular-nums">
          Код: {error.digest}
        </p>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent transition-colors duration-fast hover:bg-accent-strong"
      >
        Повторить
      </button>
    </div>
  );
}