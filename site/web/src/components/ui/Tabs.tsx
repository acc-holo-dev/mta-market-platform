// Tabs: простые вкладки на token-стилях (PLAN-002 G-001/I-001).
"use client";

import { cn } from "@/lib/utils";

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: [T, string][];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-1 border-b border-line overflow-x-auto", className)}>
      {tabs.map(([key, label]) => {
        const active = key === value;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-pressed={active}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
              active
                ? "border-accent text-content"
                : "border-transparent text-content-secondary hover:text-content"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}