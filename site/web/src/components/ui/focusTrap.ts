// PLAN-016 D-004: лёгкий фокус-трап для модалок/оверлеев (DESIGN-SYSTEM §10
// обещает «Esc + focus trap»). Хук удерживает Tab-цикл внутри контейнера
// (Shift+Tab поддержан) и передаёт Esc в onEscape; вызывающий код возвращает
// фокус на триггер через restoreTrigger().
"use client";

import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export interface FocusTrapOptions {
  onEscape?: () => void;
  autofocus?: boolean;
}

/**
 * Активный фокус-трап: работает только при active=true.
 */
export function useFocusTrap(
  active: boolean,
  ref: RefObject<HTMLElement | null>,
  options?: { onEscape?: () => void; autofocus?: boolean }
): void {
  useEffect(() => {
    if (!active || !ref.current) return;
    const container = ref.current;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        options?.onEscape?.();
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = Array.from(
        container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
      ).filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const activeEl = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (!activeEl || !container.contains(activeEl) || activeEl === first) {
          event.preventDefault();
          last.focus();
        }
      } else {
        if (!activeEl || !container.contains(activeEl) || activeEl === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    container.addEventListener("keydown", onKeyDown);
    if (options?.autofocus) {
      const first = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      first?.focus();
    }
    return () => {
      container.removeEventListener("keydown", onKeyDown);
    };
  }, [active, ref, options]);
}

// Триггер, на который возвращается фокус при закрытии оверлея.
let savedTrigger: HTMLElement | null = null;

export function rememberTrigger(element: HTMLElement | null): void {
  savedTrigger = element;
}

export function restoreTrigger(): void {
  savedTrigger?.focus();
  savedTrigger = null;
}

/**
 * PLAN-016 D-004 (минимум для dropdown'ов — AccountMenu/ContextCreate):
 * закрытие по Esc (с возвратом фокуса на триггер) и по Tab-out (фокус
 * покинул контрол — меню закрывается, фокус остаётся там, куда ушёл).
 */
export function useDropdownDismiss(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onClose: () => void
): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onCloseRef.current();
      container.querySelector<HTMLElement>("[aria-expanded]")?.focus();
    };
    const onFocusOut = (event: FocusEvent) => {
      if (!container.contains(event.relatedTarget as Node | null)) {
        onCloseRef.current();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    container.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      container.removeEventListener("focusout", onFocusOut);
    };
  }, [active, containerRef]);
}