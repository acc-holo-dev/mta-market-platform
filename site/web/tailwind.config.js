/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  // B-002: тёмная тема включена всегда (html.dark в layout.tsx) — тема одна.
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        surface: {
          DEFAULT: "hsl(var(--surface))",
          hover: "hsl(var(--surface-hover))",
          raised: "hsl(var(--surface-raised))",
          inset: "hsl(var(--surface-inset))",
        },
        line: {
          DEFAULT: "hsl(var(--line))",
          strong: "hsl(var(--line-strong))",
          accent: "hsl(var(--line-accent))",
        },
        content: {
          DEFAULT: "hsl(var(--text-primary))",
          secondary: "hsl(var(--text-secondary))",
          muted: "hsl(var(--muted))",
        },
        accent: {
          DEFAULT: "hsl(var(--primary))",
          strong: "hsl(var(--primary-strong))",
          soft: "hsl(var(--primary-soft))",
        },
        // PLAN-015 §43: текст/иконки поверх brand-заливки (токен, не raw white).
        "on-accent": "hsl(var(--on-accent))",
        // PLAN-015 §43: цвет звёзд рейтинга — единственный тёплый семантический.
        star: "hsl(var(--star))",
        ok: {
          DEFAULT: "hsl(var(--success))",
          soft: "hsl(var(--success-soft))",
        },
        warn: {
          DEFAULT: "hsl(var(--warning))",
          soft: "hsl(var(--warning-soft))",
        },
        bad: {
          DEFAULT: "hsl(var(--danger))",
          soft: "hsl(var(--danger-soft))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          soft: "hsl(var(--info-soft))",
        },
        verified: {
          DEFAULT: "hsl(var(--verified))",
          soft: "hsl(var(--verified-soft))",
        },
      },
      borderRadius: {
        card: "var(--radius-card)",
        lg: "var(--radius-lg)",
        pill: "var(--radius-pill)",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        raised: "var(--shadow-raised)",
        accent: "var(--shadow-accent)",
      },
      transitionDuration: {
        fast: "150ms",
        base: "200ms",
      },
    },
  },
  plugins: [],
};