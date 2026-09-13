# MTA Market — документация

Обновлено: 2026-09-13.

## Что такое MTA Market

MTA Market — единая цифровая площадка сообщества Multi Theft Auto: San
Andreas: сообщество (форум, новости), серверы (профили, мониторинг,
верификация), контент (статьи), маркет ресурсов и услуг, доверие (отзывы,
верификации) и идентичность (профили, бейджи). Это **не** «магазин ресурсов
с немного community» — центральная сущность платформы — SERVER, а коммерция
— одна из опор экосистемы. Полное продуктовое описание:
[product/PROJECT.md](product/PROJECT.md).

## Принцип монорепозитория

`mta-market-platform` — один репозиторий для всей системы: **site**
(веб-приложение: `site/server` API + `site/web` frontend) + **module**
(нативный C++ модуль для MTA-серверов) + **contracts** (машиночитаемые
межкомпонентные контракты) = одна система, один процесс разработки, одна
инфраструктура. История и мотивы —
[history/ARCHITECTURE-HISTORY.md](history/ARCHITECTURE-HISTORY.md).

## Карта documents/

| Каталог | Содержание |
|---|---|
| [product/](product/PROJECT.md) | Продукт: PROJECT, VISION, PRODUCT-MODEL, PRODUCT-ARCHITECTURE, PRODUCT-SURFACE-MAP, DAILY-EXPERIENCE. |
| [development/](development/README.md) | Development Plan system: планы (`active/`, `completed/`), CURRENT.md, NEXT-PHASE.md, замороженные контракты (`reference/`). |
| [architecture/](architecture/) | Архитектурные документы: SYSTEM, DATA (85 моделей / 64 enum'а), SITE, TESTING, SECURITY, DEPENDENCY-POLICY, DESIGN-SYSTEM, MODULE, TOOLCHAIN. |
| [api/](api/README.md) | Предметные API-обзоры: AUTH, MARKETPLACE, COMMERCE, SERVERS, COMMUNITY, CONTENT, DRM. Машиночитаемый OpenAPI — отдельная задача (см. development/CURRENT.md). |
| [adr/](adr/) | Architecture Decision Records: [ADR-001-drm-lease-revocation.md](adr/ADR-001-drm-lease-revocation.md). |
| [module/](module/README.md) | Нативный модуль: сборка, рантайм, Lua API, DRM-клиент, гайды. |
| [drm/](drm/README.md) | Область DRM: протокол v2, безопасность, криптография, ключи. |
| [operations/](operations/README.md) | Эксплуатация: dev/staging/production, деплой, бэкапы, миграции, инциденты. |
| [ideas/](ideas/README.md) | Идеи развития по темам — не обязательства. |
| [history/](history/ARCHITECTURE-HISTORY.md) | История: эволюция репозиториев, унаследованный материал, миграция V1→V2 модуля. |

## Порядок чтения

1. [product/PROJECT.md](product/PROJECT.md) — что это за продукт и что
   уже существует.
2. [development/CURRENT.md](development/CURRENT.md) — текущее состояние,
   последний выполненный план, открытые ограничения.
3. Архитектурный слой: [product/PRODUCT-ARCHITECTURE.md](product/PRODUCT-ARCHITECTURE.md)
   и [architecture/](architecture/), затем предметные области —
   [drm/](drm/README.md), [module/](module/README.md),
   [operations/](operations/README.md).

## Правила документации

- **Все `.md` файлы живут только в `documents/`** — нигде больше в
  репозитории.
- **Документы описывают целевое состояние; реализованное —
  [development/CURRENT.md](development/CURRENT.md)** (плюс записи планов в
  `development/completed/`). Расхождение целевого и фактического —
  нормальное состояние, но оно должно быть помечено как незавершённое
  (пример честных пометок — [history/LEGACY.md](history/LEGACY.md)).
- **Код — истина при расхождении.** Если документ и код расходятся,
  правится документ (с датой и честной пометкой) или код — «молчаливое
  расхождение» дефектно в обоих. Для замороженных контрактов — см.
  [development/reference/README.md](development/reference/README.md).
- **Планы живут циклом active → completed.** Один активный план за раз;
  завершённый план переносится в `development/completed/` с фактическим
  итогом ([development/README.md](development/README.md)).

## Структура репозитория

| Каталог | Назначение |
|---|---|
| `documents/` | Вся документация (этот каталог). |
| `contracts/` | Машиночитаемые межкомпонентные контракты: `contracts/drm/v2/` — протокол DRM v2 (protocol, errors, vectors). |
| `site/` | Веб-приложение: `site/server` (Express API, Prisma contract-ORM (`@prisma/orm-postgres` 8-rc), миграции), `site/web` (Next.js App Router), `site/shared`. |
| `module/` | Нативный C++ модуль MTA: `module/src` (SDK, DRM-клиент, функции), `module/third_party`, `module/tools`, `module/config`; пресеты `module/CMakePresets.json`. |
| `tests/` | Централизованные тесты: `unit/`, `integration/`, `concurrency/`, `e2e/`, `module/`, `tools/` (единственное место тестов — PLAN-010 Rule 002). |
| `logs/` | Конвенция логов dev-раннера (`logs/development/{backend,worker,web}.log`; в git — только `.gitkeep`). |
| `scripts/` | Скрипты эксплуатации: `deployments/`, `database/`, `maintenance/` (audit.sh, verify-contracts.sh), `development/` (repair-cyrillic.cjs), `builds/`, `tests/`. |
| `config/` | Конфигурация платформы: `config/environments/` (development/staging/production/test), `config/application/` (features/limits/logging), `config/schemas/`. |
| `infrastructure/` | Инфраструктура: `docker/compose/` (development/tests/staging/production), `docker/*.Dockerfile` (образы сайта), `nginx/`, `database/`, `monitoring/`, `deployments/`. |
| `.github/` | CI/CD: 9 workflows (validate/contracts/security/tests/module/site/e2e/release/ci — оркестратор `ci.yml` с path-фильтрами на PR). |
| `startup.py` | Каноническая точка входа: `dev` / `release` / `test` / `build` / `module` / `db` / `status` / `logs` / `stop` / `clean` / `doctor` (см. [operations/DEVELOPMENT.md](operations/DEVELOPMENT.md)). |