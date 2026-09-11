// Footer (PLAN-002 D-005): профессиональный footer без битых ссылок.
import Link from "next/link";

export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-line bg-surface/50">
      <div className="mx-auto max-w-7xl px-4 py-10">
        <div className="grid gap-8 md:grid-cols-3">
          <div>
            <p className="font-bold text-content">MTA Market</p>
            <p className="mt-2 text-sm text-content-secondary max-w-xs">
              Маркетплейс серверных ресурсов для MTA:SA — скрипты, карты, модели и гейммоды с
              лицензированием и DRM-защитой.
            </p>
          </div>
          <div>
            <p className="text-sm font-semibold text-content mb-3">Разделы</p>
            <ul className="space-y-2 text-sm text-content-secondary">
              <li>
                <Link href="/resources" className="hover:text-accent-strong">
                  Маркетплейс
                </Link>
              </li>
              <li>
                <Link href="/servers" className="hover:text-accent-strong">
                  Серверы
                </Link>
              </li>
              <li>
                <Link href="/community" className="hover:text-accent-strong">
                  Сообщество
                </Link>
              </li>
              <li>
                <Link href="/news" className="hover:text-accent-strong">
                  Новости
                </Link>
              </li>
              <li>
                <Link href="/dashboard" className="hover:text-accent-strong">
                  Мои покупки
                </Link>
              </li>
              <li>
                <Link href="/seller" className="hover:text-accent-strong">
                  Стать продавцом
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold text-content mb-3">Аккаунт</p>
            <ul className="space-y-2 text-sm text-content-secondary">
              <li>
                <Link href="/auth/login" className="hover:text-accent-strong">
                  Вход
                </Link>
              </li>
              <li>
                <Link href="/auth/register" className="hover:text-accent-strong">
                  Регистрация
                </Link>
              </li>
              <li>
                <Link href="/account" className="hover:text-accent-strong">
                  Профиль
                </Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="mt-8 border-t border-line pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-content-muted">
          <p>&copy; {year} MTA Market. Все права защищены.</p>
          <p>Ресурсы защищены DRM и лицензируются на одного владельца сервера.</p>
        </div>
      </div>
    </footer>
  );
}
