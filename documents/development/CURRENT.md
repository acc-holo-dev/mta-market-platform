# CURRENT — состояние проекта

Обновлено: 2026-09-13 (PLAN-020 выполнен + follow-up stabilization).

## Статус

Активного плана нет. Последние выполненные работы:

- **PLAN-017/018/019** (коммит `07bb748`) — консолидация архитектуры
  (config/environments, worker runtime, outbox), продуктовая волна
  (admin-секции, deals, subscriptions, advertising, notifications),
  Execution Map: [active/EXECUTION-MAP-017-018-019.md](active/EXECUTION-MAP-017-018-019.md).
- **PLAN-020 — Architecture Deep Audit & Stabilization** (`575954a`):
  9 параллельных аудитов (разделы A–T, 192 находки), 26 исправлений;
  итоговый отчёт: [COMPLETED/PLAN-020-AUDIT.md](COMPLETED/PLAN-020-AUDIT.md)
  (детальные отчёты аудита — `PLAN-020/audit/01…09.md`).
- **Follow-up stabilization** (`af6cadb`) — отложенные high-находки
  реализованы: F-004 (кросс-инстанс лок планировщиков, `lib/schedulerLock.ts`),
  E-002/E-002b (`Notification.dedupKey` + единый ключ доставки по всем
  путям), G-006.1 (вебхук диспетчеризует платформенные Order-чекиуты:
  подписки/реклама), B-004.3/G-003.1 (завершение PENDING-возвратов через
  `refund.*` вебхуки, CAS), G-005.1 (ledger-проводки атомарны под
  advisory-локом), O-002/O-003 (pnpm-кэш + path-фильтры CI).

## Фактическое состояние (проверено)

- Тесты: **693/693** в 74 файлах — `python3 startup.py test unit|integration`
  (vitest: `tests/unit` + `tests/integration` + `tests/concurrency`).
- Модуль: `python3 startup.py module` — cmake + ctest **3/3** (linux-gcc;
  Windows-сборка модуля не поддерживается — [../architecture/MODULE.md](../architecture/MODULE.md)).
- Prisma: контракт-ORM на `@prisma/orm-postgres` 8.0.0-rc.9 + CLI
  `8.0.0-rc.13` (классического `@prisma/client` в рантайме нет);
  контракт **85 моделей / 64 enum'а** (`site/server/src/prisma/contract.prisma`).
- Каноническая точка входа: `python3 startup.py dev` (infra → schema →
  backend + worker + web); полный набор команд —
  [../operations/DEVELOPMENT.md](../operations/DEVELOPMENT.md).
- Dev-данные: `python3 startup.py db seed` (targets `admin`, `plan003`,
  `plan005`, `services`, `heartbeat`; скрипты `site/server/scripts/*.ts`,
  идемпотентны по slug). `plan003` — 16 PUBLISHED-ресурсов с обложками,
  артефактами, отзывами и покупками + 4 продавца (пароль
  `seed-password-123`); `admin` — dev-админ (дефолт `admin@mtamarket.dev`
  / `dev-password-123`, переопределяется env `DEV_ADMIN_EMAIL` /
  `DEV_ADMIN_PASSWORD`).
- CI: 9 workflows, оркестратор `.github/workflows/ci.yml`; на PR —
  path-фильтры для module/E2E, полный гейт на push/workflow_call;
  mojibake-гейт (`scripts/development/repair-cyrillic.cjs --check`)
  в validate.yml; образы сайта — `infrastructure/docker/*.Dockerfile`,
  публикация в ghcr только с main.

## Открытые вопросы (честно, из PLAN-020-AUDIT §WHAT REMAINS)

1. **OpenAPI** (`contracts/api/openapi.yaml` — пустой стаб): ~93 эндпоинта
   вне контракта → генерация из кода (D-001), затем канон ошибок
   (D-003: 733 legacy `{error}` ответа) и генерация клиента (D-002).
2. **Sandbox runner — pass-through мок** (`site/server/src/lib/sandbox/runner.ts`):
   publish-гейт опирается на фантомные SandboxRun; замена на честный
   PENDING + E2E публикации.
3. **Frontend-миграции** (audit 07): 37/37 страниц `app/` — `"use client"`
   (RSC-миграция), 166 inline queryKey против фабрики `queries.ts`,
   `next/image` не используется, api-ext shim (~75 импортёров).
4. **Reconciliation scan bounding**: payment_reconciliation сканирует все
   платежи (сотни строк за цикл) — периодное ограничение требует
   отдельного решения по семантике.
5. **Redis fail-open fixture и worker-crash drill** — тест-ONLY change-set
   (частично закрыто: scheduler-lock/dedup/webhook тесты добавлены).

## Blockers (унаследованные ограничения)

1. **Windows-сборка модуля** — POSIX-сокеты в http_client.cpp + OpenSSL
   линковка (MODULE.md §support matrix).
2. **Production verification** — live domain, боевые ключи провайдеров
   (OAuth/платежи), restore drill; боевые env включаются владельцем и в
   E2E не гоняются.
3. **Почтовые уведомления** — in-app готовы; email-канал (digest/анти-спам)
   — будущий план; password reset по email — до боевого SMTP.
4. **OAuth token refresh** — токены провайдеров хранятся зашифрованными
   (AES-256-GCM), путь refresh'а провайдерских токенов не реализован
   (AUTH.md).

## Следующий шаг

Сформировать следующий план отдельным решением (автоматически не
создаётся). Кандидаты — из PLAN-020-AUDIT §WHAT REMAINS (см. выше).
Наличие темы в списке не является обязательством её реализовать.

---

## История планов (кратко)

- **PLAN-016** — Identity Expansion, Multi-Provider Payments & Platform
  Debt Closure (VK/Google/Yandex/Telegram, `/account/identities`,
  AES-256-GCM OAuth-токены, T-Bank/crypto адаптеры, checkout UI).
- **PLAN-015** — AppShell (Sidebar/Topbar), две темы, GlobalSearch,
  Home-редизайн, маркет-вкладки (Ресурсы | Услуги), Creator Studio.
- **PLAN-014** — E2E-регрессия (repair-cyrillic codemod), Prisma
  унификация (8-rc), Node 22 + pnpm 9.15 матрица, Dependabot rewrite,
  Docker runner fix.
- **PLAN-012/013** — transactional correctness core (идемпотентность,
  advisory-локи, DB-инварианты), гигиена тестов.
- **PLAN-011 и ранее** — см. [COMPLETED/](COMPLETED/).