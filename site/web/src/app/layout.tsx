import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { ThemeProvider } from "@/components/layout/theme";
import { AppShell } from "@/components/layout/AppShell";

/*
 * PLAN-017 §55: Inter — финальный производственный шрифт платформы.
 * next/font скачивает файлы на этапе сборки и раздаёт их self-hosted
 * (без внешних CDN-запросов в рантайме), variable-шрифт покрывает все
 * нужные насыщенности одним файлом; display: swap убирает блокировку
 * первой отрисовки. Один источник истины для шрифта: CSS-переменная
 * --font-inter, подключаемая в globals.css (body).
 */
const inter = Inter({
  subsets: ["latin", "cyrillic"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "MTA Market — экосистема MTA:SA",
  description:
    "Маркетплейс серверных ресурсов, услуги, серверы и сообщество MTA:SA в одном месте — с DRM-защитой лицензий",
};

/*
 * PLAN-015 §10: тема применяется до первой отрисовки (no-FOUC):
 * inline-скрипт ставит класс `dark` по localStorage/system ДО гидрации.
 */
const themeInitScript = `(function(){try{var t=localStorage.getItem("mta-theme");var d=t==="dark"||((!t||t==="system")&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" suppressHydrationWarning className={inter.variable}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen bg-background text-content">
        <Providers>
          <ThemeProvider>
            <AppShell>{children}</AppShell>
          </ThemeProvider>
        </Providers>
      </body>
    </html>
  );
}
