# MTA Market — документация

Обновлено: 2026-09-11.

## Что такое MTA Market

MTA Market — единая цифровая площадка сообщества Multi Theft Auto: San
Andreas: сообщество (форум, новости), серверы (профили, мониторинг,
верификация), контент (статьи), маркет ресурсов и услуг, доверие (отзывы,
верификации) и идентичность (профили, бейджи). Это **не** «магазин ресурсов
с немного community» — центральная сущность платформы после PLAN-005 —
SERVER, а коммерция — одна из опор экосистемы. Полное продуктовое
описание: [product/PROJECT.md](product/PROJECT.md).

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
| [development/](development/README.md) | Development Plan system: планы (`active/`, `completed/`), CURRENT.md, NEXT-PHASE.md, замороженные контракты (`reference/old_*`). |
| [architecture/](architecture/) | Архитектурные документы — каталог зарезервирован, файлов пока нет (2026-09-11). |
| [adr/](adr/) | Architecture Decision Records: [ADR-001-drm-lease-revocation.md](adr/ADR-001-drm-lease-revocation.md). |
| [api/](api/) | API-контракты (OpenAPI — P-007, ещё не введён) — каталог зарезервирован, файлов пока нет. |
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
   (каталог `architecture/` будет наполняться по мере появления
   архитектурных документов), затем предметные области —
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
| `contracts/` | Машиночитаемые межкомпонентные контракты (`contracts/drm/` — схемы протокола DRM v2; каталог создан, наполнение — pending). |
| `site/` | Веб-приложение: `site/server` (Express API, Prisma contract-ORM, миграции), `site/web` (Next.js), `site/shared`, `site/packages`. |
| `module/` | Нативный C++ модуль MTA: `module/src` (SDK, DRM-клиент, функции), `module/third_party`, `module/tools`, `module/config`. |
| `tests/` | Централизованные тесты: `e2e/`, `integration/`, `unit/`, `module/`, `tools/` (единственное место тестов — PLAN-010 Rule 002). |
| `logs/` | Корневая конвенция логов dev-раннера (в git — только `.gitkeep`; рантайм-логи не коммитятся). |
| `scripts/` | Скрипты эксплуатации: `deployments/`, `database/`, `maintenance/` (каркасы; перенос из старого репозитория — pending). |
| `config/` | Конфигурационные файлы платформы (зарезервирован, пуст). |
| `infrastructure/` | Инфраструктура: `docker/compose/` (development/tests/staging/production), `nginx/`, `database/`, `monitoring/`, `deployments/`. |
| `.github/` | CI/CD workflows (сейчас пуст — пайплайн описан в [operations/DEPLOYMENT.md](operations/DEPLOYMENT.md)). |
