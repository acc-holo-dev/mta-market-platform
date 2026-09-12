# DEPENDENCY-POLICY — политика зависимостей

Статус: NORMATIVE (PLAN-014 §40).
Дата: 2026-09-12.

## Классы риска

| Класс | Определение | Политика |
|---|---|---|
| GREEN | patch/minor с низким риском (утилиты, типы, иконки) | групповой maintenance batch, обычная приёмка (typecheck + suite) |
| YELLOW | связанные ecosystem-пакеты (React, ESLint, typescript-eslint, Turbo, Playwright, AWS SDK, testing) | обновляются **группой**, не поодиночке |
| RED | major/toolchain миграции (Next, React, TS, Tailwind, Prisma major, Node, pnpm) | отдельный compatibility analysis внутри плана; никогда «просто потому что новее» |
| BLACK | security/financial/DRM-correctness (payment libs, crypto, DRM, DB engine/adapters, storage, auth) | ручной review + полный regression pass (commerce/ledger/refund/DRM suite + E2E) |

## Обновление версий

- **patch** — автоматически (Dependabot, группой), еженедельно.
- **minor** — автоматически (Dependabot, группой), еженедельно; выборочная
  приёмка при сомнении.
- **major** — ручная миграция отдельным планом; Dependabot-major игнорируются
  (см. ниже). Для major требуются: technical review, compatibility check,
  полный CI, E2E; frontend majors — только согласованно с ecosystem pairing.
- **security updates** — немедленно, вне расписания (Dependabot alerts /
  `pnpm audit` high+critical gate в CI security.yml).

### Текущие ручные исключения (осознанные DEFER/HOLD)

| Пакет | Текущая | Latest | Решение | Обоснование |
|---|---|---|---|---|
| next | 15.5.x | 16.3.x | **DEFER** | RED: Next 16 + eslint-config-next 16 (требует ESLint >= 9) + flat-config миграция ESLint — единый шаг; PLAN-013 редизайн только что прошёл, риски дизайнерской поверхности не смешиваются с maintenance-этапом |
| eslint | 8.57.1 | 10.x | **DEFER** | мигрируется вместе с eslint-config-next 16 (peer `eslint >=9`) |
| express | 4.22.x | 5.2.x | **DEFER** | RED: path-to-regexp v8 / router behavior; миграция отдельной волной с полной payment/webhook regression. `@types/express` запинен на 4.17.x ПОД рантайм 4.x — кросс-мажорные связки types/runtime недопустимы (PLAN-019 A-003) |
| commander | — (удалён) | 15.x | **REMOVED** | PLAN-019 A-006: использовался только DRM CLI; CLI переписан на ручной разбор аргументов (площадь стабильна, зависимость не нужна) |
| date-fns | — (удалён) | — | **REMOVED** | PLAN-019 A-006: три хелпера (subDays/startOfDay/endOfDay) в jobs/reconciliation.ts заменены нативной Date-математикой |
| dotenv | 16.6.x | 17.4.x | **DEFER** | major (tips/behavior); приходит транзитивно через prisma rc.13 — прямой бамп не требуется |
| typescript | 5.9.3 | 7.0.2 | **HOLD** | TS 7 — новая генерация; ecosystem (typescript-eslint 8.x, Next 15, Prisma emit) верифицирован на 5.9; миграция RED-класса отдельным планом |
| tailwindcss | 3.4.x | 4.3.x | **HOLD** | PLAN-013 design system построен на 3.x; Tailwind 4 — только полная миграция (tokens/theme/globals/utilities/components/build/visual QA/E2E) |
| axios | — (удалён) | 1.x | **REMOVED** | PLAN-019 A-005: канонический fetch-клиент (lib/api.ts) покрывает единственный сценарий axios (bearer + single-flight refresh); удаляется вместе с миграцией клиента |

## Dependabot

- npm: patch и minor — **группами** (еженедельно, cap 5 PR); major-обновления
  **игнорируются** в конфиге — это ручной путь (см. таблицу выше).
- github-actions: minor+patch группой; action majors — отдельные PR (review).
- pip: ежемесячно.
- Security updates идут вне групп немедленно (Dependabot alerts).

## Lockfile

- `pnpm-lock.yaml` — единственный источник истины версий; коммитится всегда.
- CI работает только через `pnpm install --frozen-lockfile`.
- Обновления — целевые (`pnpm -r update <pkg>` / правка спецификатора +
  `pnpm install`), никогда `pnpm update --latest` целиком.
- После изменений dependency graph проверяется: fresh install (клон + install),
  `--frozen-lockfile` install, build, tests.

## Критические зависимости (exact-pinned)

Prisma-линейки пинятся точно (`8.0.0-rc.9`, `8.0.0-rc.13`, `0.3.0`), пока 8.x
в RC: финансовые инварианты и генерируемый контракт не должны дрейфовать с
caret-обновлениями.

**Рантайм-стек Prisma (PLAN-020 B-001)**: рантайм — только
`@prisma/orm-postgres 8.0.0-rc.9` (драйвер-adapter, `src/prisma/db.ts`
`postgres<Contract>({contractJson})`), CLI — `prisma 8.0.0-rc.13`,
`@prisma/cli-engine 0.3.0`. Классический `@prisma/client` НЕ используется:
в кодовой базе ноль импортов (проверено grep'ом), зависимость удалена в
PLAN-020. Валидация стека — `prisma contract emit` + `db update` + полный
тестовый прогон.

## Лицензии (§35)

Политика: принимаются пермиссивные лицензии (MIT, ISC, BSD, Apache-2.0,
0BSD, Unlicense, Blue Oak, Python-2.0) и слабые copyleft, совместимые с
серверным использованием (MPL-2.0 для неизменённых библиотек, LGPL-3.0 для
динамически линкуемых системных бинарников, например `@img/sharp-libvips-*`).
Запрещено принимать: AGPL, GPL-серии в runtime-графе (кроме tooling
вне поставки), лицензии без права коммерческого использования.
Новая зависимость проходит license check при review.

## Проверка неиспользуемых зависимостей (§36/§37)

Аудит usage выполняется при каждом maintenance-плане: grep по реальным
импортам для каждого direct dep. Зависимость, импортируемая production-кодом,
не может лежать в devDependencies (пример PLAN-014: `date-fns` перенесён в
dependencies). Deprecated @types/*, для которых типы поставляет сам пакет,
удаляются.

## Порядок применения обновлений (волны §46)

1. GREEN patch/minor batch → typecheck + suite.
2. Testing/tooling (Vitest, Playwright, Turbo, ESLint minor) → suite + E2E.
3. Frontend toolchain majors — только группой и после compatibility analysis.
4. Database/ORM (Prisma + adapters) — отдельно: schema emit hash + db update
   на свежей БД + полный suite (commerce/ledger/payments/DRM).
5. Native tooling — локальный GCC build + ctest + DRM make test.
6. Финальная интеграция: полный CI, E2E, Docker build, production smoke.
