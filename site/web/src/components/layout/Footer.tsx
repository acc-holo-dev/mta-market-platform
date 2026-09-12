// PLAN-013 §11: единый footer как часть продукта — бренд, разделы,
// сообщество и аккаунт, аккуратная сетка и правовой блок.
import Link from "next/link";
import { Gauge } from "lucide-react";

const COLUMNS: Array<{
  title: string;
  links: Array<{ href: string; label: string }>;
}> = [
  {
    title: "Разделы",
    links: [
      { href: "/resources", label: "Маркетплейс" },
      { href: "/servers", label: "Серверы" },
      { href: "/news", label: "Новости серверов" },
      { href: "/search", label: "Поиск" },
    ],
  },
  {
    title: "Сообщество",
    links: [
      { href: "/community", label: "Форум" },
      { href: "/content", label: "Статьи" },
    ],
  },
  {
    title: "Аккаунт",
    links: [
      { href: "/dashboard", label: "Мои покупки" },
      { href: "/seller", label: "Стать продавцом" },
      { href: "/notifications", label: "Уведомления" },
      { href: "/auth/login", label: "Вход" },
      { href: "/auth/register", label: "Регистрация" },
    ],
  },
];

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-line bg-surface/60">
      <div className="mx-auto max-w-[1400px] px-4 py-12 sm:px-6">
        <div className="grid gap-10 md:grid-cols-4">
          {/* Brand column */}
          <div>
            <p className="flex items-center gap-2 font-bold text-content">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft ring-1 ring-line-accent/40">
                <Gauge className="h-4 w-4 text-accent-strong" />
              </span>
              MTA Market
            </p>
            <p className="mt-3 text-sm leading-relaxed text-content-secondary max-w-xs">
              Единая экосистема MTA:SA — маркет ресурсов и услуг, серверы,
              новости и сообщество, с лицензированием и DRM-защитой покупок.
            </p>
          </div>

          {COLUMNS.map((column) => (
            <div key={column.title}>
              <p className="text-xs font-semibold uppercase tracking-wide text-content-muted mb-3">
                {column.title}
              </p>
              <ul className="space-y-2 text-sm text-content-secondary">
                {column.links.map((link) => (
                  <li key={`${column.title}-${link.label}`}>
                    <Link href={link.href} className="transition-colors duration-fast hover:text-accent-strong">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-content-muted">
            © {year} MTA Market — платформа сообщества Multi Theft Auto.
          </p>
          <p className="text-xs text-content-muted">
            Оплата через платёжных провайдеров · DRM-лицензии · Возвраты через
            споры и модерацию
          </p>
        </div>
      </div>
    </footer>
  );
}