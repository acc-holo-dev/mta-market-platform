# DEPENDENCY-MATRIX — инвентаризация и решения PLAN-014

Статус: POINT-IN-TIME AUDIT (2026-09-12, PLAN-014 §3).
Живая политика: [DEPENDENCY-POLICY.md](../../architecture/DEPENDENCY-POLICY.md).

Решения: UPDATE / HOLD / DEFER / IGNORE / REMOVE. Классы: GREEN / YELLOW / RED / BLACK.

## site/server (runtime, `dependencies`)

| Package | Current (locked) | Latest | Класс | Решение | Обоснование / риск |
|---|---|---|---|---|---|
| @prisma/client | 7.10.0 (exact) | 8.1.0-dev (стабильного 8.x нет) | BLACK | **HOLD→PIN** | клиентская ветка спарена с 8 RC toolchain; financial correctness — caret-дрейф запрещён (§38) |
| @prisma/orm-postgres | 8.0.0-rc.9 | 8.0.0-rc.9 | BLACK | **UPDATE** | adapter драйвера; rc.9 спарен с ORM-линейкой rc.13; верифицирован contract-emit hash + 392 теста |
| @aws-sdk/client-s3 | 3.1131.0 | 3.1131.0 | YELLOW+BLACK | **UPDATE** | storage semantics покрыты suite (artifact/DRM tests); regressions не найдены |
| @aws-sdk/s3-request-presigner | 3.1131.0 | 3.1131.0 | YELLOW+BLACK | **UPDATE** | парный к client-s3 |
| express | 4.22.2 | 5.2.1 | RED | **DEFER** | major: router/path-to-regexp v8 behavior; отдельная волна с полной payment/webhook regression |
| ioredis | 6.0.0 | 6.0.0 | YELLOW | **HOLD** | актуальная major-ветка; rate-limit/health зависят от behavior — менять только группой с redis-тестами |
| jsonwebtoken | 9.0.3 | 9.0.3 | BLACK | **HOLD** | auth-критичный; стабильная ветка |
| bcryptjs | 3.0.3 | 3.0.3 | BLACK | **HOLD** | auth; v3 поставляет собственные типы (см. REMOVE @types/bcryptjs) |
| multer | 2.3.0 | 2.3.0 | BLACK | **HOLD** | upload pipeline; стабильна |
| nodemailer | 10.0.8 | 10.0.8 | GREEN | **UPDATE** | patch-линия 10.0.0→10.0.8 |
| zod | 4.6.2 | 4.6.2 | GREEN | **UPDATE** | minor 4.5→4.6; контракты валидации зелёные |
| date-fns | 4.4.0 | 4.4.0 | GREEN | **MOVE→deps** | импортируется production-кодом (reconciliation jobs) — был misclassified как devDep (§37) |
| cookie-parser / cors / dotenv / commander / unzipper | 1.4.7 / 2.8.6 / 16.6.1 / 12.1.0 / 0.12.5 | — | GREEN | **HOLD** | стабильные; commander 15 и dotenv 17 — DEFER (major, низкая ценность) |

## site/server (dev/test)

| Package | Current | Latest | Класс | Решение | Обоснование |
|---|---|---|---|---|---|
| prisma (CLI) | 8.0.0-rc.13 | 8.0.0-rc.13 (latest) | BLACK | **UPDATE** | унификация 8 RC-линии (§16, вариант C): репозиторий уже завязан на 8.x API (contract emit, db update, orm adapters); downgrade на 7.x = переписывание миграционной инфраструктуры |
| @prisma/cli-engine | 0.3.0 | 0.3.0 | BLACK | **UPDATE** | парная rc.13 (registry dependencies) |
| vitest | 5.0.0 | 5.0.0 | YELLOW | **HOLD** | стабильная major-ветка, suite зелёный; транзитивный peer-конфликт @effect/vitest (prisma) — не наш код, не блокирует |
| tsx | 4.23.x | 4.x | YELLOW | **HOLD** | стабильна |
| typescript | 5.9.3 | 7.0.2 | RED | **HOLD** | TS 7 — новая генерация; pairing typescript-eslint/Next/Prisma верифицирован на 5.9 |
| supertest / @types/* | — | — | GREEN | **UPDATE (lockfile)** | patch |
| @types/bcryptjs | 3.0.0 | Deprecated | GREEN | **REMOVE** | bcryptjs 3.x шипит собственные типы (§36) |

## site/web

| Package | Current | Latest | Класс | Решение | Обоснование |
|---|---|---|---|---|---|
| next | 15.5.24 (exact) | 16.3.5 | RED | **DEFER** | Next 16 + eslint-config-next 16 (peer eslint>=9) + ESLint flat config — единый миграционный шаг; PLAN-013 редизайн не смешивать с maintenance |
| react / react-dom | 19.2.8 | 19.3.0 | YELLOW | **UPDATE (lockfile→19.3)** | в рамках Next 15.5 compatibility (§12: не обновлять отдельно от Next) |
| @tanstack/react-query | 5.102.x | 5.x | YELLOW | **HOLD** | стабильная minor-линия |
| axios | 1.20.x | 1.x | GREEN | **HOLD** | стабильна; безопасность — через audit gate |
| zustand / clsx / tailwind-merge | 5.0.15 / 2.1.1 / 3.6.0 | — | GREEN | **HOLD** | стабильны |
| lucide-react | 1.45.0 | 1.45.0 | GREEN | **UPDATE** | minor 1.41→1.45 |
| tailwindcss | 3.4.19 | 4.3.3 | RED | **HOLD** | design system PLAN-013 построен на 3.x; Tailwind 4 — только полная миграция (§15) |
| autoprefixer / postcss | 10.5.6 / 8.5.x | — | GREEN | **UPDATE (lockfile)** | patch |
| @types/react(-dom) | 19.3.0 | 19.3.0 | GREEN | **UPDATE** | minor |

## site/packages/eslint-config

| Package | Current | Latest | Класс | Решение | Обоснование |
|---|---|---|---|---|---|
| eslint | 8.57.1 | 10.10.0 | RED | **DEFER** | миграция на 9+/flat config вместе с eslint-config-next 16 одним шагом (§14: не оставлять пакеты на разных major-ветках) |
| eslint-config-next | 15.1.3 | 16.3.5 | RED | **DEFER** | парный к next 15.5 |
| @typescript-eslint/* | 8.70.0 | 8.70.0 | YELLOW | **UPDATE** | minor 8.18→8.70 |
| eslint-config-prettier | 9.1.2 | 10.1.8 | GREEN | **HOLD** | major 10 — совместим, но не требует срочности; в следующий GREEN batch |

## Корень (root devDeps)

| Package | Current | Latest | Класс | Решение | Обоснование |
|---|---|---|---|---|---|
| turbo | 2.10.12 | 2.x | YELLOW | **UPDATE (lockfile)** | minor-линия |
| @playwright/test | 1.63.0 | 1.x | YELLOW | **HOLD** | синхронизирован с CI browser install; обновление — только вместе с browser install + E2E (§20) |
| prettier | 3.9.6 | 3.x | GREEN | **HOLD** | стабильна |
| pg / @types/pg | 8.23.x | 8.x | BLACK | **HOLD** | DB-adapter для тестов |
| typescript / @types/node / vitest / supertest | как выше | — | — | **HOLD/UPDATE** | согласованы с workspace |

## workspace-зависимости

`@mta-market/shared`, `@mta-market/eslint-config`, `@mta-market/tsconfig` — workspace:*; не версия-менеджатся.

## Итог

- UPDATE: 12 пакетов (patch/minor) + prisma-линейка (3) — применено.
- REMOVE: 1 (@types/bcryptjs) + перемещение date-fns deps.
- HOLD: ~20 (стабильные ветки, менять без причины запрещено §19-§21).
- DEFER (major, ручная миграция): next 16+eslint 9, express 5, commander 15, dotenv 17, typescript 7, tailwind 4.
- IGNORE: dependabot-major репо-wide (конфиг), security-обновления идут вне игнора.
- Уязвимости: pnpm audit — 0 (prod и full).
