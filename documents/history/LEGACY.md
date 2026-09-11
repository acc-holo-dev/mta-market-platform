status: historical
version: 1.0
recorded: 2026-09-11

# LEGACY — унаследованный материал

Индекс того, что осталось от старой структуры, где это лежит и какие
известные дыры в унаследованных документах. Здесь цитируются старые имена
репозиториев и путей — исторически (см. также
[ARCHITECTURE-HISTORY.md](ARCHITECTURE-HISTORY.md)).

## attic/ — выброшенные заготовки

Каталог `attic/` (`mta-market-site/apps/server/src/attic/` — паркованные
заготовки фаз: `cli-artifact.ts.phase-b`, `signing.ts.phase-b`,
`order.ts.phase-c`, `providers/`, README) **в monorepo не перенесён** —
`site/server` чист от attic-файлов. Материал сохранён в git-истории
репозитория `mta-market-site` (оригинальный репозиторий продолжает
существовать с этим каталогом).

## Модульные документы-наследники

- `documents/history/V1-TO-V2-MIGRATION.md` — гайд миграции SDK модуля
  V1 → V2 (маппинг `src/` → `source/`, `config/module.toml` как источник
  identity, семантика userdata/callback'ов). Это единственный файл в
  `documents/history/` с активным техническим содержанием: путь V1
  (`src/`) больше не существует в дереве, но документ описывает, как
  migrated-структура получилась.
  **Известная дыра:** документ ссылается на `v2-audit.md` как на
  «аудированный baseline» (V1-определение) — в дереве такого файла нет.
  Уточнение по git-истории `mta-market-module`: `other/documents/v2-audit.md`
  **существовал** (добавлен коммитом `4340dd2` «PHASE 0 audit») и был
  удалён коммитом `32ad404` при чистке процессных артефактов v2 — то есть
  ссылка висячая в рабочем дереве, но файл восстановим из истории
  (`git show 4340dd2:other/documents/v2-audit.md`).
- Набор модульных документов из `mta-market-module/other/documents/`
  перенесён в [documents/module/](../module/README.md) (BUILD/RUNTIME/
  LUA-API/TUTORIAL/GUIDES/EXAMPLE); инвентарь DRM-клиента
  (`docs/H-001-inventory.md` старого репозитория, упоминаемый в
  замороженном контракте) в `documents/` пока не перенесён — ссылка на
  него в [development/reference/old_drm-protocol-v2.md](../development/reference/old_drm-protocol-v2.md)
  остаётся ссылкой в старый репозиторий.

## old_* — замороженные контракты

[documents/development/reference/](../development/reference/README.md)
хранит эталоны фазы трёх репозиториев с префиксом `old_`:
`old_drm-protocol-v2.md`, `old_repository-contract.md`,
`old_compatibility-matrix.md`. Префикс означает «замороженный исторический
контракт», а не «устаревший»: DRM Protocol v2 действует, пути внутри них
указаны в старой разметке (`apps/server/...`, `source/...`, `tests_drm/`) —
соответствие новым путям зафиксировано в
[ARCHITECTURE-HISTORY.md](ARCHITECTURE-HISTORY.md) и в заголовках
[drm/](../drm/README.md)-документов.

## Правило размещения новых документов

Новые документы живут **только** в `documents/` — нигде больше
(ни в компонентах, ни в корне). Это прямое наследие правила старого
контракта «документация не владеет дублями кода»: документация — один
каталог, код — свои компоненты. Исключение не делается и для «временных»
заметок — для них есть `documents/development/` (планы) и
`documents/ideas/` (идеи).

## Незавершённые переносы (честный список, 2026-09-11)

- `scripts/` (deploy.sh, backup.sh из `mta-market-site/scripts/`) —
  каталоги `scripts/deployments|database|maintenance` созданы, файлы не
  перенесены; рабочие копии — в git-истории `mta-market-site`.
- `.github/` (CI workflow) — пуст; пайплайн описан в
  [operations/DEPLOYMENT.md](../operations/DEPLOYMENT.md) по реализации
  старого репозитория.
- `infrastructure/nginx/ssl/`, `infrastructure/monitoring/*`,
  `infrastructure/deployments/*`, `config/`, `logs/` — каркасы каталогов
  без содержимого (сертификаты и мониторинг — операторские).
- `contracts/drm/v2/` — машиночитаемые схемы протокола ещё не добавлены
  (см. [drm/PROTOCOL-V2.md](../drm/PROTOCOL-V2.md)).
- `startup.py` (dev-раннер из `pyproject.toml`) — не присутствует в дереве;
  рабочий путь — `pnpm dev` ([operations/DEVELOPMENT.md](../operations/DEVELOPMENT.md)).
