status: current
version: 2.0
last_verified: 2026-09-12

# DEVELOPMENT — воспроизведение среды разработки

Единая точка входа для локальной работы — `startup.py` (PLAN-017 §13):
один сценарий валидирует окружение, поднимает инфраструктуру, применяет
схему БД, запускает сервисы и печатает адреса. Низкоуровневые команды
существуют для отладки, но рабочий процесс — только через `startup.py`.

Требования: Node 22 LTS, pnpm 9.15, Python ≥ 3.10 (утилита запуска), Docker
Engine + compose plugin, CMake 3.27+ / Ninja / компилятор C++20 (модуль,
Linux; Windows-сборка модуля пока не поддерживается —
[MODULE.md](../architecture/MODULE.md)), OpenSSL 3.x (модуль).

Диагностика окружения:

```sh
python startup.py doctor
```

Возвращает только actionable-проверки: инструменты, зависимости, порты,
записываемость temp/ и logs/, валидность config/.

## 1. Полная среда разработки одной командой

```sh
python startup.py            # = dev
# или по этапам:
python startup.py dev infra    # только postgres + redis (compose)
python startup.py dev schema   # применить контракт-схему к dev-БД
python startup.py dev backend  # API :3001 (tsx watch)
python startup.py dev web      # web :3000 (next dev)
```

`dev` без аргументов делает всё по порядку: валидация инструментов →
загрузка config/environments/development.yaml → Docker-инфраструктура →
схема БД → backend → web → печать адресов. Второй терминал не нужен.

Адреса: API http://localhost:3001 (health: /health /live /ready /metrics),
WEB http://localhost:3000, PG localhost:5432 (mtamarket), Redis :6379.
Логи процессов: logs/development/{backend,web}.log, PID-файлы:
temp/runtime/pids/.

Сид-данные (админ + демо-контент):

```sh
python startup.py db seed                # admin + plan003 + plan005 + services
python startup.py db seed admin          # только e2e/dev-админ
python startup.py db seed services       # каталог услуг
```

Схема БД (dev quick path; формальный путь для staging/production —
[DATABASE-MIGRATIONS.md](DATABASE-MIGRATIONS.md)):

```sh
python startup.py db apply
python startup.py db reset               # только re-apply (безопасно)
python startup.py db reset --destructive # пересоздать тома dev-БД (DELETE)
```

## 2. Тесты

```sh
python startup.py test unit          # L0: быстрые unit (БД не нужна)
python startup.py test integration   # L1: integration + concurrency
                                     #     (тест-БД, уничтожается после прогона)
python startup.py test affected      # L2: изменённые области (vitest --changed)
python startup.py test e2e           # браузерные сценарии Playwright
python startup.py test smoke         # runtime-пробы /health /live /ready /metrics
python startup.py test release       # L4: build + release-стек + smoke
```

Полная матрица, изоляция запусков и ожидаемые веса —
[TESTING.md](../architecture/TESTING.md).

## 3. Локальный production-like прогон

```sh
python startup.py release
```

Собирает образы (те же Dockerfile, что и CI), поднимает production-топологию
(nginx :8080 → frontend → /api → backend → postgres/redis), проверяет
/ready, БД, Redis и завершает smoke-пробами. Недостающие секреты
генерируются как ЭФЕМЕРНЫЕ (файл temp/runtime/release.env) — это локальная
репетиция, не деплой: реальные боевые секреты сюда не попадают никогда.
Стоп — `python startup.py stop`.

## 4. Сборка и нативный модуль

```sh
python startup.py build          # site (turbo) + module
python startup.py module         # configure + build + ctest
python startup.py build site     # только site
python startup.py build module   # только module
```

На Windows команда `module` честно сообщает об отсутствии поддерживаемого
тулчейна (POSIX-only DRM-клиент; см. MODULE.md) и не блокирует site-сборку.

## 5. Статус, логи, остановка, очистка

```sh
python startup.py status    # таблица WEB/API/WORKER/POSTGRES/REDIS/MODULE/TEST ENV
python startup.py logs      # хвосты logs/development/*.log (--follow)
python startup.py stop      # процессы + контейнеры; тома сохраняются
python startup.py clean     # temp/, .next/, dist/, coverage, отчёты Playwright
python startup.py clean --destructive --yes  # + тома dev/test-БД и uploads/
```

`clean` никогда не трогает боевые данные (тома прод-БД, uploads, секреты)
без `--destructive` и явного подтверждения (`DELETE`).

## 6. Низкоуровневые команды (только для отладки)

Турбо-скрипты корневого package.json (`pnpm dev`, `pnpm build`,
`pnpm type-check`, `pnpm test`, `pnpm test:e2e`) остаются алиасами для CI и
отладки. Обходной путь нужен только при дебаге отдельного слоя (например,
`pnpm --filter @mta-market/server dev` — API без shell).

## 7. Переменные окружения и конфигурация

- Некритичная конфигурация — config/ (config/environments/*.yaml +
  config/application/*.yaml): порты, URL, лимиты, feature-флаги, логирование.
  `startup.py` загружает их и экспортирует производные переменные окружения
  запускаемым сервисам — один источник значений (PLAN-017 §6–§12).
- Секреты — только .env (site/server/.env; корневой .env для compose):
  JWT_SECRET, DRM_* ключи, OAuth-провайдеры, платёжные провайдеры, S3.
  Матрица — корневой [.env.example](../../.env.example) с пометками
  `PROD: REQUIRED`.
- Реальные .env **не трекаются git'ом** — коммитятся только `*.env.example`.

## 8. E2E (браузер, Playwright)

Пререквизиты и сиды делает сам раннер:

```sh
python startup.py test e2e
```

Ручной вариант (отладка): dev-стек запущен (п.1), затем
`pnpm test:e2e:admin` (сид admin-аккаунта) и `pnpm test:e2e`.
Платежи в dev: `YOOKASSA_*` опциональны — иначе используется dev-completion
`POST /payments/:id/simulate`.
