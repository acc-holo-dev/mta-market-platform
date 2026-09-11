# Database Migrations — Production Procedure (PLAN-004 C-001..C-003)

Статус: действующая процедура (PLAN-004).
Область: PostgreSQL 16, **Prisma 8 contract-ORM** (schema = `site/server/src/prisma/contract.prisma`,
конфиг `site/server/prisma.config.ts`, клиент `@prisma/orm-postgres/runtime`),
production/staging.

Важно: это НЕ классический Prisma с `schema.prisma`/`prisma migrate`.
В Prisma 8 два пути применения схемы (см. `site/server/src/prisma/contract.prisma` (skill-заметки prisma-8 генерировались в старом репозитории; `prisma db update --help` в этой версии)):

| Путь | Команда | Что делает | Где разрешён |
|---|---|---|---|
| Quick path | `npx prisma db update --confirm` | diff контракта против живой БД, без файлов миграций, без data-трансформов | **только локальный dev** — БД «без разделяемой истории» |
| Formal path | `npx prisma migration plan` + `npx prisma db migrate` | ревьюемый, контентно-хэшированный migration package под `migrations/app/`, поддержка data-трансформов | **staging, production** |

## 1. Единый процесс (C-001)

```
backup → migration → verification → application deployment
```

1. **Backup.** `./scripts/backup.sh` (deploy.sh делает это автоматически перед
   миграцией и прерывает деплой при провале). Нет бэкапа — нет миграции.
2. **Migration** — до обмена контейнеров: deploy.sh выполняет миграцию внутри
   backend-образа (версия тулинга совпадает с деплоем) против живой БД.
3. **Verification**: деплой продолжается только при успешном коде выхода
   миграции; после деплоя health-gate бьёт `/ready` (реальный DB-пинг).
4. **Application deployment**: только после успешной миграции.

## 2. Команда миграций (C-002)

**Production-деплой:** формальная схема. Изменение контракта коммитится
вместе с миграционным пакетом:

```bash
# 1. Разовый шаг при изменении схемы (на машине разработчика):
npx prisma contract emit
npx prisma migration plan            # пишет migrations/app/<ts>_<slug>/
# при placeholder(...) — заполнить migration.ts и переэмитить
node migrations/app/<dir>/migration.ts
git add src/prisma/contract.prisma migrations/ && git commit

# 2. Применение на production/staging (deploy.sh делает это автоматически):
npx prisma db migrate
```

`migration plan` диффит контракт против origin (`--from`, иначе `db` ref,
иначе пустая БД) и пишет пакет в `migrations/app/`; `db migrate` применяет
ревьюемые, хэшированные пакеты. Snapshots под `migrations/snapshots/`
обязательны в git (см. §5).

Quick-path `db update --confirm` — только для локальной dev-БД. В production
запрещены: `db update` (не оставляет истории и не умеет data-трансформы),
`prisma db push`, ручные ALTER вне механизма, применение схемы с машины
разработчика мимо образа.

CI (job `test`) прогоняет `contract emit && prisma db update` на чистой
сервисной БД при каждом push — смоук пути «контракт → БД» непрерывен;
production-путь (`migration plan` + `db migrate`) проверяется по факту
миграционного пакета в PR.

## 3. Rollback strategy (C-003)

Правило: **откат приложения — да, откат схемы — только через восстановление
backup**. Prisma 8 не генерирует down-миграции; схему не откатывают
вперёд-назад вручную.

| Ситуация | Действие |
|---|---|
| Новая версия приложения несовместима со схемой | rollback image (deploy.sh хранит предыдущий тег, откат одной командой), схема не трогается |
| Миграция ещё не применена | rollback image, миграций не было |
| Миграция применена, деплой упал, нужен откат | восстановить DB из pre-deploy backup (backup-restore.md), затем deploy предыдущего тега |
| Breaking migration нужна в будущем | двухфазный деплой: (1) версия N+1 пишет в old+new схему, (2) версия N+2 убирает old; каждая фаза откатываема |

Каждая миграция обязана иметь запись в PR-описании: forward-эффект, план
отката (backup restore), совместимость с предыдущим образом.

## 4. Connection limits (C-006)

- Клиент (`@prisma/orm-postgres/runtime`) создаёт node-postgres `Pool` с
  дефолтом **10 соединений на процесс** (`max` не задаётся кодом/env);
  Postgres 16 `max_connections` по умолчанию 100.
- В текущей прод-топологии backend — один процесс (nginx → 1 контейнер):
  10 соединений достаточно с запасом; пиковая нагрузка — reconciliation
  (concurrency 5 provider-fetch) кратковременна.
- При масштабировании `--scale backend=N`: сумма пулов (10×N) + jobs должна
  быть < `max_connections` (100) — при N>4 понизить пул или ввести PgBouncer.
- Мониторинг: `/ready` падает при недоступности БД (контейнерный healthcheck
  тоже); алерт — на серию неудачных /ready.

## 5. Versioning миграционных снапшотов

`migrations/snapshots/<hex>/` — контентно-адресованные bookend-контракты,
на которые ссылаются пакеты миграций. Они **обязаны** быть в git: закоммиченный
`migrations/app/refs/db.json` указывает на snapshot hash — игнорирование
каталога оставляло «висячий» ref на свежем клоне (`MIGRATION.SNAPSHOT_MISSING`).
В PLAN-004 строка `site/server/migrations/` убрана из `.gitignore`; новые
снапшоты коммитятся вместе с изменением контракта.
