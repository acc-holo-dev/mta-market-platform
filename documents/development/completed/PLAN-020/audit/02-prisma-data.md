# PLAN-020 — 02 Prisma / Data Layer Audit (разделы B-001..B-005, C-001..C-005)

AUDIT-ONLY. Зона: `site/server/src/prisma/` (contract.prisma 2371 строк, contract.json 26908, contract.d.ts 22263, db.ts),
`site/server/prisma.config.ts`, `site/server/migrations/` (12 пакетов app + snapshots), `lib/prisma.ts`, `lib/dbErrors.ts`
и весь прямой доступ к БД из `site/server/src/routes/*` (48 роутеров) и `site/server/src/lib/*` (60 файлов).
Все утверждения снабжены `файл:строка`; runtime-поведение ORM сверено с дистрибутивом
`@prisma/orm-family-sql@8.0.0-rc.9/dist/orm-client.mjs`.

Метод: спарсены все 85 моделей и 64 enum'а contract.prisma (175 `@@index`, 105 `onDelete`);grep-инвентаризация 1147
строк с `db.orm`, 18 вызовов `db.transaction`, 275 `as any`; ручное чтение критических money-цепочек
(commerce/refunds/payouts/ledger/subscriptions/discount/deals/entitlements/idempotency), webhook-пайплайна payments.ts
и lifecycle-роутов; перекрёстная проверка filter/sort-полей запросов против индексов схемы; версия-скью сверена по
pnpm-lock.yaml и распакованным package.json в store.

**Важно про известный факт:** смешанные мажоры `@prisma/client 7.10.0` + `prisma 8.0.0-rc.13` существовали на HEAD
(07bb748), но **в рабочем дереве уже удалены** (незакоммиченный diff `git diff HEAD -- site/server/package.json`:
строка `"@prisma/client": "7.10.0"` снята; `pnpm-lock.yaml` — importer-запись `@prisma/client` удалена). Документация
ещё описывает удалённую связку — см. B-001.1.

Сводка: **26 находок — 0 critical, 4 high, 9 medium, 13 low.**

Общее состояние: транзакционная дисциплина финансовых ядер (checkout, completion, refund effects, payout, ledger)
высокая — CAS `updateAndCount` + детерминированные ledger-transaction-id + advisory-локи + outbox в той же транзакции.
Главные риски — не-атомарные цепочки активации подписки/вебхука, мёртвые состояния и брешь PENDING-purchase.

---

## B-001.1 — `@prisma/client@7.10.0`: зависимость, не импортируемая нигде; удалена в рабочем дереве, документация не обновлена

- severity: medium
- verdict: FIX (частично применено — осталась документация)
- current: на HEAD `site/server/package.json` (deps) содержал `"@prisma/client": "7.10.0"`, а реальный рантайм — только
  `@prisma/orm-postgres`: `src/prisma/db.ts:2` (`import postgres from "@prisma/orm-postgres/runtime"`), db.ts:6-8
  (`postgres<Contract>({ contractJson, url })`); сгенерированные артефакты импортируют только orm-postgres
  (`src/prisma/contract.d.ts:4,21,26,33` — `@prisma/orm-postgres/adapter|target|family-contract`). Grep
  `from "@prisma/client"` по `site/server/src`, tests, scripts — **0 вхождений**. `@prisma/orm-postgres@8.0.0-rc.9`
  не зависит от `@prisma/client` (его package.json deps: orm-family-sql/orm-framework/orm-target-postgres/orm-toolchain
  rc.9 + pg). В рабочем дереве (незакоммичено) `"@prisma/client": "7.10.0"` удалена из package.json и из
  pnpm-lock.yaml (git diff HEAD: `-    "@prisma/client": "7.10.0",`, минус importer-запись `'@prisma/client':`).
  При этом документация по-прежнему описывает «пару» с клиентом 7.10.0: DEPENDENCY-POLICY.md:59,64
  («клиент — интерфейсный рантайм-пакет… связи с мажором клиента нет»), TOOLCHAIN.md:36,
  DEPENDENCY-MATRIX.md:12, CURRENT.md:82.
- change: закоммитить уже сделанное удаление зависимости (package.json + lockfile); обновить DEPENDENCY-POLICY.md:59-66,
  TOOLCHAIN.md:36, DEPENDENCY-MATRIX.md:12, CURRENT.md:82 — фактический стек: `prisma` CLI 8.0.0-rc.13 +
  `@prisma/orm-postgres` 8.0.0-rc.9 + `@prisma/cli-engine` 0.3.0 (package.json:25,43,51), рантайм-импорт один —
  `@prisma/orm-postgres/runtime` (db.ts:2).
- reason: «парность client/adapter», на которую ссылается политика, фактически не существует — клиентский пакет не входит
  ни в рантайм-граф, ни в генерируемые артефакты; описание смешанных мажоров как «осознанной поддерживаемой схемы»
  вводит в заблуждение и маскирует настоящий инвариант (пин триады CLI/adapter/cli-engine).
- risk: пересмотр документации может «поправить» пин orm-postgres в сторону client-мажора; без правки docs следующий
  аудит снова «найдёт» смешанные мажоры.
- verification: `grep -rn "@prisma/client" site/server/package.json pnpm-lock.yaml` — пусто;
  `pnpm install --frozen-lockfile && pnpm type-check && pnpm exec vitest run tests/unit` — PASS;
  `grep -rn "7\.10\.0" documents/` — только исторические отчёты (completed/), не живая политика.

## B-001.2 — Версионный скоу внутри разрешённого графа: CLI rc.13 тащит orm-toolchain rc.8, adapter-линейка — rc.9; дрейф сгенерированных артефактов никем не проверяется

- severity: low
- verdict: KEEP (пин) + FIX (verification-хук)
- current: `prisma@8.0.0-rc.13` зависит от `@prisma/orm-toolchain: 8.0.0-rc.8` и `@prisma/cli-engine: 0.3.0`
  (site/server/node_modules/prisma/package.json, deps), тогда как `@prisma/orm-postgres@8.0.0-rc.9` тянет
  `orm-toolchain/orm-framework/orm-family-sql` rc.9 — в lockfile живут обе ветки (pnpm-lock.yaml:1271 toolchain rc.8,
  :1283 toolchain rc.9, :1239/:1247 orm-framework rc.8/rc.9, :1231 family-sql rc.9). Генерация — `prisma contract emit`
  (package.json:14, CI .github/workflows/tests.yml:49 и e2e.yml:61 `npx prisma contract emit && npx prisma db update`),
  артефакты contract.json/contract.d.ts коммитятся; `db.ts` собирает клиент из contract.json в рантайме (db.ts:4-8).
  CI делает emit в рабочей области, но не сверяет результат с закоммиченным (tests.yml:49 — нет `git diff --exit-code src/prisma`);
  тестов на совпадение profileHash нет (`grep -rn "profileHash" tests/ site/server/tests/` — пусто).
- change: добавить в CI после `contract emit` шаг `git diff --exit-code site/server/src/prisma/contract.json site/server/src/prisma/contract.d.ts`
  («сгенерированное == закоммиченное»); в тест-сьют — smoke-тест, пересчитывающий контракт и сверяющий `profileHash`
  (contract.json:5) с emitted. Пин rc-линейки сохранить.
- reason: единственная защита от дрейфа «contract.prisma ↔ артефакты» сегодня — дисциплина разработчика; CI тестирует
  свежий emit, а не то, что закоммичено (и что уедет в прод через db.ts).
- risk: шаг может «залечь», если emit недетерминирован (проверить на 2 прогонах) — тогда сверять только `profileHash`.
- verification: локально `pnpm db:emit && git status --short site/server/src/prisma` — пусто; CI-шаг зелёный на чистом clone.

## B-001.3 — postinstall `prisma skills sync || exit 0` молча глотает любые ошибки

- severity: low
- verdict: FIX
- current: `site/server/package.json:13` — `"postinstall": "prisma skills sync || exit 0"`. Команда существует в CLI
  (grep `skills sync` по node_modules/prisma/dist/prisma.js — 10 вхождений) и синхронизирует skills-пакет в
  `site/server/.cursor/skills/prisma-8/` (SKILL.md:27 требует перечитать skills после sync, если версия разошлась).
  `|| exit 0` превращает любой сбой (нет сети, сломанный CLI, ошибка записи) в тихий успех.
- change: заменить на `prisma skills sync || echo "[postinstall] prisma skills sync failed (offline?) — skills may be stale" >&2`;
  при желании вынести sync из postinstall в отдельный скрипт `skills:sync` и звать его явно.
- reason: смысл skills — быть «источником истины по установленной версии» (SKILL.md:27); тихий провал синхронизации
  оставляет устаревшую документацию API, на которую опираются агентные пайплайны.
- risk: постойнсталл начнёт падать? — нет, echo не меняет exit code; риск только в шуме логов.
- verification: `pnpm --filter @mta-market/server exec node -e "process.exit(0)"` после install; руками сломать сеть и
  убедиться, что warning виден, а install зелёный.

## B-001.4 — Тестовый/продовый контур: схема накатывается `db update`, миграции и production-путь документированы; откат — только бэкап

- severity: low
- verdict: KEEP
- current: два пути применения схемы документированы (DATA.md:14-18): quick `db update --confirm` (dev/CI: tests.yml:49,
  e2e.yml:61) и формальный `migration plan` + `db migrate` (staging/prod; deploy.sh: backup → migration → verification).
  Пакеты миграций: `site/server/migrations/app/` — 12 пакетов (20260910T0604_baseline … 20260912T1125_community_resource_threads,
  `ls site/server/migrations/app`), снимки в `migrations/snapshots/` (DATA.md:26-30 обязывает хранить в git).
  Тесты: общий Postgres `127.0.0.1:5433` (vitest.config.ts: TEST_DATABASE_URL, `fileParallelism: false` — интеграционные
  файлы не параллелятся, чтобы не уничтожать fixture'ы).
- change: без изменений. Зафиксировать в отчёте как базовую линию: миграционная инфраструктура соответствует
  документу; down-миграций нет (DATA.md:37-38) — откат бэкапом осознан.
- reason: отдельного runtime-audit-нарушения нет: генерация/миграции/тестовая среда согласованы.
- risk: (уже учтён в B-001.2) — дрейф артефактов.
- verification: smoke-путь CI «contract → db update» зелёный на каждом push (tests.yml:44-49).

## B-002.1 — `lib/prisma.ts` — мёртвый алиас без единого импортера

- severity: low
- verdict: REMOVE
- current: `site/server/src/lib/prisma.ts:9` — `export const prisma: typeof db.orm.public = db.orm.public;` с комментарием
  про TS2742 (prisma.ts:7-8). Grep `lib/prisma` по `site/server/src` — **0 импортеров**: 79 файлов импортируют `db`
  напрямую из `../prisma/db.js`, доступ унифицирован как `db.orm.public.<Model>` (1147 строк с `db.orm`).
- change: удалить `site/server/src/lib/prisma.ts` целиком.
- reason: псевдо-«обёртка» без единого вызова — это именно тот класс «accidental abstraction», который PLAN-020 A-003
  требует убирать; комментарий про TS2742 описывает проблему вывода типов, а не обоснование файла.
- risk: нулевой (нет импортеров); TS2742-мотив переезжает в B-002.2.
- verification: `grep -rn "from \"../lib/prisma\|from \"./lib/prisma" site/server/src` — пусто; `pnpm type-check` PASS.

## B-002.2 — Типовая эрозия: `DbOrTx = any` в 5 модулях и 275 `as any` поверх типизированного контракт-ORM

- severity: medium
- verdict: SIMPLIFY (единый тип) + FIX (не обесценивать `as any` генерик-касты)
- current: минимальные хэндлы транзакций объявлены по-разному: `type DbOrTx = any` в refunds.ts:59-61, payouts.ts:60-61,
  discount.ts:12-14, ledger.ts:38, events.ts:76-78 (каждый со своим eslint-disable), а в 7 местах — типобезопасный
  `Parameters<Parameters<typeof db.transaction>[0]>[0]` (commerce.ts:192,407,512; subscriptions.ts:174; routes/services.ts:300,340).
  Всего `as any` — 275 (134 в lib, 139 в routes); в subscriptions.ts кастуется почти каждый ORM-вызов
  (например subscriptions.ts:345-347, 501-502, 511-519, 526-534, 802-810, 884-886), в entitlements.ts — все
  (entitlements.ts:69-74, 88-101, 150-152). Рукописные Row-типы дублируют контракт: `PayoutRow = any` (payouts.ts:81-83),
  `PaymentRow` (subscriptions.ts:298-309), `SubscriptionRow` (subscriptions.ts:466-480), `EntitlementRow`
  (entitlements.ts:28-41), `DealRoomRow` (deals.ts:58-72).
- change: (1) вывести `export type DbOrTx = Parameters<Parameters<typeof db.transaction>[0]>[0] | typeof db` в одном
  модуле (например `lib/dbTypes.ts`) и импортировать вместо 5 локальных any-копий; (2) механическая волна: убрать
  `as any` там, где контракт-тип выводится (subscriptions/entitlements/deals — наибольшие кластеры), оставив cast только
  там, где вывод реально ломается (TS2742 через pnpm store — см. prisma.ts:7-8, payouts.ts:74-76); (3) рукописные Row-
  типы заменить на `typeof db.orm.public.<Model>`-производные, где это выводится.
- reason: контракт-ORM даёт типы из contract.d.ts; `as any` на каждом вызове отменяет ровно ту гарантию, ради которой
  существует генерируемый клиент, и уже маскирует реальные ошибки (см. B-004.4 — `.update()` и `(consumed as any).status`).
- risk: волна кастов может вскрыть скрытые несоответствия типов (поля ISO-строк vs Date) — гасить инкрементально,
  по одному модулю за PR, с `pnpm type-check` после каждого.
- verification: `grep -c "as any"` по src — монотонно падает; type-check PASS; `tests/unit` зелёные после каждого модуля.

## B-003.1 — Репозиториев нет: два эшелона (routes → lib-сервисы → ORM); 29 копий пагинационного бойлерплейта

- severity: low
- verdict: KEEP (архитектуру) + SIMPLIFY (общий paginate-хелпер)
- current: единого repository-слоя нет: routes работают напрямую с `db.orm.public.*` (например routes/resources.ts:35,425-442),
  доменные операции живут в lib-сервисах (commerce/refunds/payouts/subscriptions/deals/entitlements/deals) — это уже
  «репозиторный» слой по факту. Стандарт CRUD-методов (findById/findMany/count/...) из плана не реализован и не нужен:
  вводить его означало бы создать accidental abstraction (A-003), т.к. доменные вариации несут CAS/адвизори-локи/лимиты.
  Реальная дубликация — пагинация: 29 `.offset(...)`-вызовов, каждый повторяет `safePage/safeLimit/aggregate count/
  pages` (subscriptions.ts:1114-1159, entitlements.ts:205-254, deals.ts:461-517, payouts.ts:424-434, adminCommunity.ts:40,
  serverNews.ts:109,398, community.ts:370,702, updates.ts:79 …), плюс 69 `.aggregate((a) => ...)`-count.
- change: НЕ вводить repository-слой (наметить это в плане как отклонённое с мотивировкой). Вместо этого — один хелпер
  `lib/pagination.ts`: `parsePagination(query)` → `{page,limit,skip}` + `paginate(scoped, page, limit, orderBy)` →
  `{data,total,pages}`, и перевести 29 call-sites на него.
- reason: дубль «clamp page/limit → count → limit/offset → pages» — чистый code-duplication без доменной ценности;
  при этом CAS/локи/идемпотентность — доменная ценность, которую repository-стандарт как раз стёр бы.
- risk: хелпер не должен менять clamp-семантику (limit≤100, page≥1) — переносить с тестом на каждый список.
- verification: `grep -rn "safePage\|Math.max(page" site/server/src | wc -l` → стремится к 0 вне хелпера; тесты списков
  (admin list, deals list) зелёные.

## B-004.1 — Вебхук payment.succeeded: 4 независимых записи без общей транзакции (частичные коммиты ремонтопригодны ретраями)

- severity: medium
- verdict: FIX (упаковать статус-цепочку в транзакцию) 
- current: обработчик `payment.succeeded` (routes/payments.ts) пишет: `transitionPaymentTo(ppId, "SUCCEEDED")` (payments.ts:593,
  CAS-цикл), затем `completeResourceOrderItem` — своя транзакция (commerce.ts:512-601), затем Payment→SUCCEEDED/
  create (payments.ts:626-643), затем `transitionPaymentTo(ppId, "SETTLED")` (payments.ts:646) и event→PROCESSED (691-694).
  Окна сбоя: (а) crash между 593 и 624 — Payment SUCCEEDED, Purchase PENDING; (б) между 627 и 646 — Payment SUCCEEDED,
  не SETTLED. Ремонт: ретраи вебхука по FAILED-событию, ветка `alreadyCompleted` повторяет settle (commerce.ts:612-624),
  `purchase_canceled_then_succeeded_repaired` (payments.ts:612-622) — но «Payment SUCCEEDED + Purchase PENDING»
  ремонтируется только ретраем вебхука, отдельного sweeper'а нет.
- change: принять в `completeResourceOrderItem` опциональный `tx` (как это уже умеют `consumeDiscount`/`recordSellerRevenue`
  через DbOrTx — discount.ts:176-185, ledger.ts:338-362) и в вебхуке обернуть payments.ts:593→646 в один
  `db.transaction` (provider-верификация — до транзакции). Сеттлмент оставить после коммита (INV-001, commerce.ts:603-605).
- reason: сегодня корректность опирается на то, что провайдер ретраит вебхук; при исчерпании ретраев окно
  «деньги captured, entitlement не выдан» закрывается только вручную.
- risk: перевод completion в внешний tx меняет семантику вложенности —`completeResourceOrderItem` уже использует
  `db.transaction` внутри; нужно принимать tx извне и не открывать вложенный (PN `db.transaction` не вкладывается
  явно — проверить поведение runtime при tx-in-tx на тестовом контуре).
- verification: новый concurrency-тест: сбой-инъекция между шагами (mock, бросающий после SUCCEEDED) → после ретрая
  Purchase COMPLETED, Payment SETTLED, ledger-записи `settle:purchase:<id>` единожды; существующие
  tests/concurrency/* зелёные.

## B-004.2 — Активация подписки: 5 записей (payment/order/subscription/entitlement/ledger) без транзакции и без БД-инварианта

- severity: high
- verdict: FIX
- current: `activateSubscriptionPayment` (subscriptions.ts:624-750) под in-process `withKeyLock` (645) выполняет
  раздельно: `capturePlatformPayment` (CAS, subscriptions.ts:345-354) → `completePendingOrder` (CAS, :700,
  :364-371) → `upsertSubscriptionWindow` (subscriptions.ts:705, create/update :511-535) → `grantPlanEntitlement`
  (:706, → entitlements.ts:94-102) → `settlePlatformOrderRevenue` (:707, ledger :385-404 + best-effort SETTLED :408-413).
  Каждая ступень — отдельный автокоммит: crash после `completePendingOrder` оставляет Order COMPLETED без подписки,
  и повторная активация уходит в идемпотентную ветку (647-662), которая при отсутствии live-подписки бросает 409
  `subscription_missing` (:649-651) — самовосстановления нет; crash между 705 и 706 — подписка без Entitlement; между
  706 и 707 — нет ledger-записи. Для сравнения: resource-completion в commerce атомарен (commerce.ts:512-601).
  additionally: `upsertSubscriptionWindow` читает все подписки и фильтрует в JS (subscriptions.ts:501-506) — в БД нет
  частичного unique на (userId, plan) live-статусов (Subscription имеет только `@@index([userId, status])`,
  contract.prisma:2190-2191) — кросс-инстансный дубль подписки возможен.
- change: обернуть subscriptions.ts:700-707 в `db.transaction` (CAS-ы внутри уже ready для tx-хэндла — заменить
  `db.orm` на `tx.orm`), вынести provider-верификацию до транзакции; добавить частичный unique-индекс
  `subscription_user_plan_live_uq` (`where: status IN ('ACTIVE','GRACE_PERIOD','PAST_DUE')`) по аналогии с
  `purchase_buyer_resource_live_uq` (contract.prisma:363-365) — миграцией.
- reason: это «subscription state» из обязательного списка B-004; сейчас атомарность держится только на
  процессном локе, который PLAN-012 для прочих money-путей сознательно считал недостаточным (commerce.ts:83-90).
- risk: транзакция с upsert+entitlement+ledger длиннее обычных — держать короткой (без provider-вызовов);
  миграция partial unique требует отсутствия дублей в прод-данных (проверить SELECT-ом до наката).
- verification: интеграционный тест «crash после completePendingOrder» → повторная активация восстанавливает
  подписку+entitlement; тест на параллельную активацию → ровно одна подписка (unique).

## B-004.3 — Async-refund тупик: провайдер-вебхуков для refund нет, PENDING-refund навсегда зависает (деньги и лицензия не применяются)

- severity: high
- verdict: FIX
- current: `createRefund` создаёт PENDING-refund в транзакции с advisory-локом (refunds.ts:111-139), вызывает провайдера;
  если провайдер ответил succeeded — эффекты применяются (refunds.ts:159-165 → applyRefundEffects :191-370). Если
  провайдер вернул «pending» (async-сценарий, явно предусмотренный: refund остаётся PENDING, refunds.ts:168-169;
  yookassa-адаптер: «async refinement arrives with the refund webhook (E-008 note)» —
  providers/payment-yookassa.ts:124-126) — но вебхук-хендлер обрабатывает ТОЛЬКО `payment.succeeded|payment.canceled`
  (payments.ts:443), событий refund.succeeded/refund.canceled не существует; sweep/re-poll PENDING-refund'ов тоже нет
  (jobs/reconciliation.ts:112-114 — только reconciliation по уже REFUNDED платежам).
  Итог: PENDING-refund не имеет пути к SUCCEEDED → payment не переходит в PARTIALLY_REFUNDED/REFUNDED, лицензия не
  ревокнется (K-004, refunds.ts:277-291), ledger `refund:<id>` не постится.
- change: минимально — шаг в reconciliation-джобе: для PENDING-refund'ов дергать `provider.getRefund(...)`
  (или эквивалентную capability) и при подтверждении вызывать существующий `applyRefundEffects` (idempotent:
  refunds.ts:243-256). Плюс: добавить в вебхук-диспетчер обработку refund-событий провайдера (после добавления
  capability в IPaymentProvider).
- reason: это прямая дыра в «refund»-атомарности из B-004: запись о частичном коммите уже встроена в дизайн
  (K-004/F-003 в одном tx), но вход в этот tx существует только для синхронного ответа провайдера.
- risk: getRefund-способности нет у всех провайдеров — фичефлаг по capability (`refund.verification`), иначе джоба
  молчит для провайдеров без API (как уже сделано в reconciliation/service.ts:242).
- verification: тест: refund создан → статус PENDING → джоба с mock-провайдером «succeeded» → Payment PARTIALLY_REFUNDED,
  ledger `refund:<id>` есть, повторный прогон — no-op.

## B-004.4 — `update()` как условный переход: 5 мест нарушают документированное правило ORM (TOCTOU, не-CAS)

- severity: medium
- verdict: FIX
- current: рантайм доказуемо делает `update()` как select-first-then-update-by-PK: в
  `@prisma/orm-family-sql@8.0.0-rc.9/dist/orm-client.mjs` `update()` → `#findFirstMatchingRowIdentityWhere()` (SELECT
  с полным фильтром, LIMIT 1) → `#clone({filters:[identityWhere]}).#updateAllWithAnnotations(...)` (UPDATE только по
  identity-колонкам) — то есть не-ключевые условия where соблюдаются лишь в момент SELECT, между SELECT и UPDATE
  статус может уйти, и UPDATE всё равно применится. Правило «условные переходы — только через updateAndCount»
  зафиксировано самим репозиторием (DATA.md:22; discount.ts:206-211; commerce.ts:513-515), но нарушено:
  1) `routes/payments.ts:475` — `Purchase.where({id, status:"PENDING"}).update({status:"FAILED"})` на
  `payment.canceled` (гвардит ровно ту гонку, о которой пишет комментарий 470-474; узкое TOCTOU-окно, есть ремонт
  FAILED→PENDING в payments.ts:612-622);
  2) `routes/services.ts:158` — submit сервиса `where({id, status:"DRAFT"}).update(...)` с guard `if (!transitioned)`;
  3) `routes/services.ts:362` — rollback `where({id, status:"IN_PROGRESS"}).update({status:"DELIVERED"})` внутри tx;
  4) `routes/serverReviews.ts:162-167` — replay-защита токена: `where({id, status:"ACTIVE"}).update({status:"CONSUMED"})`;
  5) `routes/disputes.ts:155-156` — freeze purchase: статус проверен чтением (155), обновление — plain `update()` по id.
- change: во всех пяти местах — `updateAndCount` + `affectedCount(...) !== 1 → 409` (шаблон уже массово используется:
  commerce.ts:516-518, refunds.ts:265-274, subscriptions.ts:511-522).
- reason: это единственный класс мест, где финансовые/безопасные переходы держатся на недокументированном как
  безопасный поведении; два комментария в коде прямо запрещают этот паттерн.
- risk: механическая замена; обновления ответов (`transitioned` → boolean) в services.ts:159-161 и serverReviews.ts:167-170.
- verification: `grep -rn "\.where({[^}]*status[^}]*})\s*\.update(`-подобный линт-скрипт → 0 вхождений; новые
  concurrency-тесты на двойной claim review-токена и submit не-DRAFT сервиса.

## B-004.4b — Идемпотентные гранты/подписки держатся на check-then-insert без DB-инварианта

- severity: medium
- verdict: FIX
- current: `grantEntitlement` (entitlements.ts:88-102) — SELECT активного гранта, потом create; индекс
  `@@index([subjectType, subjectId, kind])` НЕ уникальный (contract.prisma:2063). `upsertSubscriptionWindow` —
  SELECT-all + фильтр в JS + create (subscriptions.ts:501-535). Оба пути сериализуются только in-process
  (`withKeyLock`, keyLock.ts:20) — на двух инстансах racing-гранты дают дубликаты Entitlement/Subscription
  (речь ровно про топологию «multi-instance», на которую PLAN-012 уже отвечал partial unique для purchase/payment).
- change: миграция: частичный unique `entitlement_active_uq` on (subjectType, subjectId, kind)
  `where: "revokedAt IS NULL"`; для подписок — см. B-004.2; грант перевести на create+catch(isUniqueViolation)
  (паттерн уже есть: idempotency.ts:134-144, disputes.ts:130-136, dbErrors.ts:52-71).
- reason: «идемпотентный грант» без DB-инварианта — тот же класс проблемы, который проект уже решал в PLAN-012 §4/§6.
- risk: в проде могут найтись уже существующие дубли (чистка перед миграцией: dedupe-скрипт, ревокация лишних).
- verification: параллельный тест двух грантов → 1 строка; SQL-аудит дублей до миграции.

## B-005.1 — 13 избыточных `@@index`, дублирующих уникальный индекс той же колонки

- severity: low
- verdict: REMOVE
- current: первая колонка `@@index` дублирует уже уникальную: User.email (contract.prisma:24 vs 88), User.username
  (27 vs 89), Session.refreshTokenHash (113 vs 126), Resource.slug (149 vs 176), Service.slug (215 vs 231),
  Purchase.orderItemId (340 vs 362), Installation.publicKey (405 vs 423), Payment.providerPaymentId (457 vs 468),
  ArtifactSignature.versionId (602 vs 615), Lease.nonce (649 vs 663), ArtifactEncryption.dekId (1054 vs 1065),
  ForumThread.newsId (1741 vs 1765) и resourceId (1743 vs 1766).
- change: удалить 13 строк `@@index` из contract.prisma + миграция `DROP INDEX` (уникальные CONSTRAINT-индексы остаются).
- reason: каждый дубль — лишний индекс на каждой INSERT/UPDATE ключевых таблиц (User, Session, Purchase, Payment)
  без единого планируемого выигрыша: планировщик и так берёт unique-индекс.
- risk: миграция под таблицами с данными (Session, Purchase) — брать CONCURRENTLY-совместимый путь миграции
  (ops.json миграции `plan016` уже показывает механику check-constraints — migrations/app/20260912T0456_plan016_payment_providers).
- verification: `pnpm db:emit` → diff артефактов; в БД `\di` — каждый из 13 индексов отсутствует, unique-аналоги на месте;
  тесты/платёжный smoke зелёные.

## B-005.2 — Горячие сортировки без подходящих индексов (каталог, история покупок, активные треды)

- severity: low
- verdict: DEFER (сначала EXPLAIN-профилирование)
- current: (а) каталог: sort `newest`/`price_asc|desc` по `filtered()` (status-фильтр) — resources.ts:521-537; у Resource
  есть только `@@index([sellerId])`, `@@index([status])`, `@@index([slug])` (contract.prisma:174-176) — нет
  (status, createdAt) и (status, price); (б) `GET /payments/transactions/mine`: `Purchase.where({buyerId}).orderBy(createdAt.desc())`
  (payments.ts:863-865) — индекс только `@@index([buyerId])` (contract.prisma:360), сортировка по всем покупкам покупателя;
  `Payment.where(purchaseId in ...).orderBy(createdAt)` (payments.ts:869-871) — по purchaseId есть лишь partial unique
  captured-строк (contract.prisma:470), обычные PENDING/FAILED-строки им не покрываются; (в) «активные треды» дашборда:
  `ForumThread.where({state:"OPEN"}).orderBy(lastPostAt.desc())` (community.ts:86-90) — композитный индекс только
  (categoryId, lastPostAt) (contract.prisma:1764), глобального (state, lastPostAt) нет.
- change: сначала EXPLAIN ANALYZE на реальных объёмах (у PN нет .explain — подключить собственный `pg.Pool` через
  `pg:`-биндинг рантайма, как предписывает skills/queries.md «EXPLAIN»), затем точечно:
  `@@index([status, createdAt])` и `@@index([status, price])` на Resource, `@@index([buyerId, createdAt])` на Purchase,
  `@@index([state, lastPostAt])` на ForumThread — только те, что подтвердятся планами.
- reason: план B-005 прямо требует добавлять индексы только под подтверждённые планы; текущие лимиты (50/10 строк,
  cap 1000 id) делают деградацию незаметной до роста данных.
- risk: лишние индексы = лишняя цена записи; отвергать кандидатов без EXPLAIN.
- verification: скрипт с EXPLAIN до/после; метрики p95 endpoint'ов (lib/metrics.ts) на каталоге и transactions/mine.

## B-005.3 — Поиск через `ilike('%…%')` — sequential scan по title/description (нет trigram/полнотекстового пути)

- severity: low
- verdict: DEFER
- current: `search.ts:150-151` (Resource.title/description ilike, limit 400), :215-216 (Server.name/description),
  :281 (ForumThread.title); аналогично resolveSearchIds в resources.ts:425-442 (User.username/displayName limit 50,
  Resource title/description limit 400). B-tree по этим колонкам бесполезен для `%pat%`; трigram/FTS-индексов в
  схеме нет (в contract.prisma нет ни одного расширения/pg_trgm).
- change: зафиксировать порог (объём Resource/Server/ForumThread), после которого вводить `pg_trgm` GIN — при условии,
  что PN-контракт поддерживает расширения-индексы (проверить `references/contract.md` skill'а: extensions через
  `prisma.config.ts extensions`); до тех пор — ограничение candidate-limit (уже стоит) приемлемо.
- reason: честный DEFER: на текущих объёмах sequential scan с LIMIT дешевле ввода нового индексного типа и миграции.
- risk: если поиск станет медленным раньше, чем это заметят метрики — деградация каталога; держать p95 в мониторинге.
- verification: EXPLAIN (seq scan → GIN после внедрения); p95 search-эндпоинтов.

## C-001.1 — Строково-закодированные состояния и CSV-поля вместо enum'ов (7 колонок)

- severity: medium
- verdict: FIX (enums + check constraints миграцией)
- current: колонки типа `String` с состоянием в комментарии/дефолте: ServiceRevision.status `"OPEN" | "ADDRESSED"`
  (contract.prisma:946), ServiceOrderMessage.senderRole `"BUYER | SELLER | ADMIN"` (:916), Entitlement.source
  `"ADMIN_GRANT | PLAN_PURCHASE"` (:2051), DealRoom.subjectType `"resource | service | server"` (:2213),
  PriceAlert.events — CSV-подмножество enum'а PriceAlertEvent (:2147, сам enum :2138 объявлен, но колонкой не
  используется), ResourceMedia.kind `"SCREENSHOT"` (:186), ForumReaction.kind `@default("LIKE")` (:1800).
  Все остальные машины состояний в схеме — настоящие enum'ы (64 enum'а).
- change: ввести enum'ы (ServiceRevisionStatus, SenderRole, EntitlementSource, DealSubjectType, ResourceMediaKind,
  ForumReactionKind) и для PriceAlert — отдельную таблицу PriceAlertEventPreference (userId, resourceId, event) с
  unique (userId, resourceId, event) вместо CSV.
- reason: строка-«enum» не защищена ни типом, ни check-констрейнтом — вся валидация живёт в zod/JS; опечатка уходит в БД
  молча (что уже потребовало default-комментариев «kept uppercase for legacy rows» в ArtifactEncryption.algorithm,
  contract.prisma:1060-1062).
- risk: миграция с backfill-конвертацией значений; PriceAlert CSV → таблица затрагивает priceAlerts.ts:122-218 и
  matcher-джобу — самое крупное из изменений этого отчёта, делать отдельной волной.
- verification: после миграции `SELECT DISTINCT` по каждой колонке — значения из enum; type-check выявит расходящиеся
  литералы в коде.

## C-001.2 — Мёртвые состояния: OrderStatus.CANCELLED и SubscriptionStatus.PAST_DUE никогда не записываются; PENDING-заказы вечны

- severity: medium
- verdict: FIX
- current: единственные записи статуса Order — COMPLETED (commerce.ts:583-586, subscriptions.ts:700→365-367); CANCELLED
  не пишет никто (grep `'"CANCELLED"'` с контекстом Order — пусто), хотя enum объявляет его (contract.prisma:789-792).
  Отмена платежа (webhook payment.canceled, payments.ts:461-477) переводит Purchase в FAILED, но Order навсегда остаётся
  PENDING. SubscriptionStatus.PAST_DUE (contract.prisma:2163-2169) не имеет ни одного writer'а (grep `status: "PAST_DUE"`
  — только чтения/валидация: subscriptions.ts:482,1008; routes/subscriptions.ts:234) — при этом комментарий
  subscriptions.ts:11-13 обосновывает дизайн «нет PENDING», не замечая мёртвый PAST_DUE.
- change: (1) реализовать CANCELLED: в webhook payment.canceled вместе с Purchase FAILED ставить Order CANCELLED
  (+`cancelledAt`), либо удалить значение из enum'а и из схем; (2) удалить PAST_DUE из enum'а/фильтров или завести
  writer (провайдерный dunning); (3) добавить sweep истёкших PENDING-заказов (шаблон: expireSweep subscriptions.ts:792-871).
- reason: мёртвые значения枚 стают ловушкой для новых фич (frontend уже рисует «отменён» для Order), а вечные PENDING-Order
  искажают любые агрегаты по заказам.
- risk: enum-значения снесены миграцией с check-constraint — сверить, что в проде нет строк с этими значениями
  (для Order CANCELLED их и не может быть).
- verification: `grep -rn "status: \"CANCELLED\"" site/server/src | grep -i order` — 1 writer после правки; SQL-подсчёт
  Order PENDING старше N дней → 0 после первого sweep.

## C-001.3 — Тройное дублирование money-снимка: Order / OrderItem / Purchase (+ServicePurchase)

- severity: low
- verdict: DEFER (осознанный bridge, консолидация дорогая)
- current: одна и та же тройка (base price, discount, final, fee, net) хранится в OrderItem (contract.prisma:884-900,
  комментарий C-006 «immutable price snapshot»), в Purchase.priceSnapshot/discountSnapshot/finalPrice/platformFee/
  sellerRevenue (:338-367, «Copied from OrderItem»), в ServicePurchase (:265-291, priceSnapshot/discountSnapshot/
  finalPrice/platformFee/sellerRevenue) и агрегируется в Order.subtotal/discountTotal/finalTotal (:861-878).
  Purchase.orderItemId — «Phase C bridge» (:340), инвариант `platformFee + sellerRevenue == finalPrice` проверяется
  в рантайме (ledger.ts:293-296).
- change: не консолидировать сейчас (каждая модель обслуживает свой lifecycle: Order — checkout, Purchase — владение/лицензии,
  ServicePurchase — delivery). Зафиксировать документ-правило: любой НОВЫЙ money-снимок кладётся только в OrderItem,
  а Purchase/ServicePurchase читают его; когда commerce-rewrite из комментария :340 случится — убрать снимки Purchase.
- reason: риск несогласованности снимков реален, но миграция затрагивает ledger/refunds/payouts — выигрыш не стоит риска
  в этой волне.
- risk: появление ещё одной копии полей при следующей фиче (сделать правило явно в DATA.md).
- verification: кросс-чек тестом: для всех COMPLETED Purchase значения равны их OrderItem (можно reconcile-запросом).

## C-001.4 — Ledger — источник истины, но legacy-кэши (SellerBalance/FinancialTransaction/UserBalance) всё ещё пишутся на горячих money-путях

- severity: low
- verdict: MERGE (двухфазно, с defer)
- current: схема объявляет LedgerEntry источником истины, балансы — «derived caches» (contract.prisma:997-999); refunds.ts:293
  прямо называет SellerBalance/FinancialTransaction «legacy cash-cache + transactions (kept for reconciliation)».
  При этом caches пишутся в каждом settlement/refund/payout (ledger.ts:444-512 applySellerBalanceDelta, refunds.ts:294-307,
  payouts.ts:299-315) в тех же транзакциях, что и LedgerEntry — рассинхрон исключён транзакционно, но запись дублируется
  в 3 местах на каждый money-ход, а UserBalance (routes/auth.ts:94-99 ensureUserBalance) пишется при логине.
- change: поэтапно: (1) все записи кэша оставить только внутри lib/ledger.ts (сейчас так почти везде — исключений нет,
  зафиксировать линтером-правилом «никаких прямых SellerBalance.write вне ledger.ts»); (2) после стабилизации —
  вывод FinancialTransaction/SellerBalance в read-only reconcile-модели (схема их уже называет derived).
- reason: двойной учёт — постоянный источник расхождений при каждой новой money-фиче; reconciliation уже умеет
  сверять (lib/reconciliation/internal.ts:134-138), т.е. инфраструктура для MERGE есть.
- risk: сторонние читатели кэшей (dashboard, payouts.getAvailableBalance payouts.ts:86-88) — менять только после
  инвентаризации читателей.
- verification: grep-тест «write в SellerBalance|FinancialTransaction вне lib/ledger.ts» → 0; reconciliation-джоба зелёная.

## C-001.5 — DATA.md дрейфует: «68 моделей и 44 enum'а» при фактических 85/64; список миграций устарел

- severity: low
- verdict: FIX
- current: documents/architecture/DATA.md:11 и :80 — «68 моделей», фактическое количество: 85 `^model` и 64 `^enum`
  (grep -c по contract.prisma). Список «актуальных пакетов» (DATA.md:26-33) обрывается на
  20260912T0456_plan016_payment_providers, тогда как в migrations/app/ лежат ещё 20260912T1042_admin_platform_foundation,
  20260912T1122_productization_foundation, 20260912T1125_community_resource_threads (`ls site/server/migrations/app`).
- change: обновить счётчики и список; в идеале — генерировать оба блока скриптом из contract.prisma и migrations/
  (чтобы перестало дрейфовать), или заменить числа на «см. contract.prisma».
- reason: DATA.md — входная точка для агентных/человеческих ревью слоя данных; заниженный инвентарь скрывает 17 моделей
  (весь DRM/lease/sandbox/productization-хвост).
- risk: нулевой (док).
- verification: `grep -c "^model " site/server/src/prisma/contract.prisma` == число в DATA.md.

## C-002.1 — Центральные таблицы переходов есть у 5 машин; Purchase/Order/Subscription/ServicePurchase/License/Installation/LeakCase/DemoSession/AdCampaign — ad-hoc

- severity: medium
- verdict: FIX (центральные таблицы для финансовых машин)
- current: экспортированные transition-таблицы с self-check существуют для: Payment (paymentStateMachine.ts:45-54,
  module-load проверка :59-72), Payout (payouts.ts:68-74), Deal (deals.ts:211-216 PARTY_TRANSITIONS), Dispute
  (routes/disputes.ts:23 DISPUTE_TRANSITIONS, применение :266-270), Resource-модерация (moderation.ts:32-48
  SELLER/ADMIN_TRANSITIONS). Для остальных машин переходы разбросаны ad-hoc: Purchase PENDING→COMPLETED (commerce.ts:516-518),
  PENDING→FAILED (payments.ts:475, TOCTOU — B-004.4), FAILED→PENDING ремонт (payments.ts:612-622), COMPLETED→DISPUTED
  (disputes.ts:155-156), DISPUTED→COMPLETED (disputes.ts:335-338), COMPLETED→REFUNDED (refunds.ts:277-280); Subscription —
  пять писателей статусов в subscriptions.ts (647-703, 806-861, 884-886, 911-913, 993-1046) без таблицы; ServicePurchase —
  routes/services.ts:303,349,363,405,428,448,482; License ACTIVE→REVOKED — refunds.ts:281-289; Installation —
  lib/drm/service.ts:184,352,403; LeakCase/DemoSession/AdCampaign — routes/leak.ts, demo.ts, adminAdvertising.ts:261,370.
- change: для финансовых машин (Purchase, Order, Subscription, ServicePurchase) завести `TRANSITIONS`-таблицы в стиле
  paymentStateMachine.ts (export + module-load self-check + генерация док-таблицы), и перевести guard'ы на
  `canTransition`+CAS. Остальные — по мере касания (не рефакторить ради рефакторинга).
- reason: PLAN-020 C-002 требует единой таблицы переходов и центрального reject'а нелегальных переходов; для Payment это
  уже сделано и работает (CAS-цикл transitionPaymentTo payments.ts:82-105) — шаблон готов.
- risk: формализация таблицы может «отрезать» применяемые сегодня переходы (например FAILED→PENDING ремонт) — таблицу
  писать по фактическому множеству переходов из кода, а не по желаемому.
- verification: юнит-тест на каждую таблицу: полный перебор пар (from,to) сверяется с объявлением; док-таблицы в
  documents/api перегенерированы.

## C-003.1 — PayoutRequest.seller onDelete: Cascade разрушает payout-историю вместе с пользователем, вразрез с финансовой политикой Restrict

- severity: medium
- verdict: FIX
- current: из 105 onDelete 86 — Cascade; финансовое ядро защищено Restrict: Order.buyer (contract.prisma:873),
  Purchase.buyer (:354), Purchase.versionId (:355), License.versionId (:389), FinancialTransaction.user (:526),
  Refund.payment (:981), LedgerEntry.account (:1035), DiscountCampaign.seller (:833). Исключение:
  PayoutRequest.seller — **Cascade** (contract.prisma:2110), т.е. удаление продавца каскадно удаляет историю выплат,
  в то время как все прочие финансовые записи такого продавца сохраняются (и даже блокируют удаление — Restrict).
  SellerBalance/PayoutRequest-хвост — единственное финансовое исключение.
- change: `onDelete: Restrict` для PayoutRequest.seller (+ миграция check-констрейнта; актуальных удалений продавцов
  с выплатами в коде нет — `grep -rn "User.*delete" src` пусто, поэтому поведение не изменится, а инвариант появится).
- reason: бизнес-правило «финансовые записи живут дольше субъекта» проведено в схеме последовательно везде, кроме выплат.
- risk: нулевой в текущем коде (никто не удаляет User), чисто инвариантная правка.
- verification: миграция + тест: попытка удалить продавца с выплатой → FK-ошибка, а не удаление истории.

## C-003.2 — DELETE /resources/:slug без статус-guard'а: 500 на FK для продаваемых ресурсов и каскадное уничтожение отзывов/обсуждений

- severity: high
- verdict: FIX
- current: routes/resources.ts:905-938 — DELETE проверяет только существование (:909-916) и владельца (:923-925), затем
  `Resource.where({id}).delete()` (:938). Никакой проверки статуса (DRAFT/PENDING_REVIEW/PUBLISHED/SUSPENDED) нет.
  Последствия: (а) у опубликованного ресурса с покупками delete падает FK-ошибкой: каскад Resource→ResourceVersion
  (contract.prisma:316 `onDelete: Cascade`) упирается в `Purchase.versionId … onDelete: Restrict` (:355) и
  `License.versionId … Restrict` (:389) → 500 «Failed to delete resource» (resources.ts:939-941); (б) у ресурса без
  покупок каскад уносит reviews, media, forumThread, priceAlerts, demoSessions, viewDays (Resource relations
  :166-181) — при том, что исторические OrderItem-снимки явно спроектированы «переживать» удаление продукта
  («historical orders survive product edits/removal», contract.prisma:886).
- change: запретить hard-delete для не-DRAFT: `if (!["DRAFT","PENDING_REVIEW"].includes(resource.status)) → 409`
  (модель MEDIA_EDITABLE_STATUSES уже есть в этом файле, resources.ts:39-40); для публикации/снятия — существующий
  moderation-пайплайн (moderation.ts:32-56). Опционально: REPLACE hard-delete на «архив» (status SUSPENDED) для
  поддержки будущих GDPR-кейсов.
- reason: сейчас эндпоинт либо 500-ит, либо молча уничтожает контент, на который есть живые снапшоты заказов.
- risk: продавцы потеряют возможность удалять опубликованные товары — это и есть требуемое поведение (снять с продажи
  можно через модерационные переходы).
- verification: тест: DELETE опубликованного ресурса с покупкой → 409; DELETE draft → 200; FK-целостность после обоих.

## C-004.1 — POST /payments/cancel закрывает только Payment: Purchase остаётся PENDING и partial-unique навсегда блокирует повторную покупку; sweep'а нет

- severity: high
- verdict: FIX
- current: локальный эндпоинт отмены (payments.ts:733-789) вызывает `provider.cancelPayment` + `transitionPaymentTo(CANCELED)`
  (:779-781) и НЕ трогает Purchase — Purchase PENDING→FAILED выполняет только webhook payment.canceled
  (payments.ts:475). Если webhook не приходит (провайдер не доставляет/модифицировал flow), покупка зависает в PENDING,
  а частичный unique `purchase_buyer_resource_live_uq` (contract.prisma:363-364, где live = PENDING|COMPLETED)
  даёт покупателю вечный 409 `pending_purchase_exists` (commerce.ts:152-156) на повторный checkout — срос-инстансный
  repair-путь (representExistingCheckout, commerce.ts:323-359) перепредставляет зависшую покупку, а не закрывает её.
  Периодического sweep по PENDING Purchase/Order/Payment нет (есть только subscription expireSweep — subscriptions.ts:792-871,
  и reconciliation по REFUNDED — jobs/reconciliation.ts:112-114).
- change: (1) в POST /payments/cancel после успешной провайдерской отмены закрывать связную PENDING-покупку тем же
  CAS-переходом, что делает webhook (payments.ts:475, но через updateAndCount — см. B-004.4); (2) джоба-сweep:
  PENDING Purchase/Order старше N часов без captured payment → FAILED/CANCELLED (идемпотентно, только CAS), что также
  закрывает C-001.4 (вечные PENDING Order).
- reason: это единственное место, где покупатель может permanently потерять возможность купить ресурс; починка
  не требует новых инвариантов — только связки существующих CAS-переходов.
- risk: гонка «cancel и webhook succeed одновременно» — закрывать покупку только при отсутствии captured-платежа
  (условие как в payments.ts:487-499, провайдер-truth wins).
- verification: интеграционный тест: cancel → Purchase FAILED (повторный checkout успешен); прогон sweep поfixture-набору
  зависших PENDING → переведены, captured-случаи не тронуты.

## C-004.2 — «Плавающие» строковые ссылки без FK (Payment, LedgerEntry, FinancialTransaction, LedgerAccount.userId) — структурно возможные сироты

- severity: low
- verdict: KEEP (с документацией) + точечные reconcile-проверки
- current: Payment.purchaseId/orderItemId — plain String без relation (contract.prisma:452-453); LedgerEntry.orderId/
  paymentId/userId (:1027-1029) и LedgerAccount.userId (:1013); FinancialTransaction.relatedPurchaseId/relatedPayoutId
  (:521-522); DealRoom.orderId (:2217). На сегодня это безопасно: удалять сущности, на которые они ссылаются, почти
  нечем — Purchase/Payment/Order удаляются только reconciliation-джобой служебных таблиц
  (reconciliation/service.ts:671-674,706-708; idempotency.ts:66-68; events.ts:285 — служебные таблицы), а пользователи
  с финансовой историей не удалимы вовсе (Restrict-цепочка B-003/C-003). Исключение по дизайну:
  OrderItem.resourceId «not an FK (historical orders survive product edits/removal)» (contract.prisma:886).
- change: ничего не удалять; добавить в reconciliation три read-only-проверки «ссылка есть — строка есть» (Payment→Purchase,
  LedgerEntry.paymentId→Payment, FinancialTransaction.relatedPurchaseId→Purchase) как отчётные метрики.
- reason: FK здесь сознательно не заводятся (живучесть истории), но без мониторинга дрейф замечается только по жалобам.
- risk: добавление FK задним числом сломало бы legitimate сценарии (provider-dashboard payments, refunds.ts:631-643
  create без purchaseId) — поэтому KEEP, а не FIX.
- verification: SQL-скрипт сирот в CI-отчёте → 0; при появлении — алерт, не удаление.

## C-005.1 — Деньги: все суммы в целых копейках; float только на границе отображения/провайдера; нейминг amount vs amountMinor расходится

- severity: low
- verdict: KEEP (инвариант) + SIMPLIFY (нейминг)
- current: в схеме нет ни одного Float/Decimal money-поля: Order.subtotal/discountTotal/finalTotal Int (contract.prisma:866-868),
  OrderItem.basePrice/finalPrice/platformFee/sellerNet Int (:891-897), Purchase.priceSnapshot/finalPrice/platformFee/
  sellerRevenue Int (:344-348), Payment.amount Int (:455), Refund.amount Int (:972), LedgerEntry.amount Int (:1026),
  FinancialTransaction.amount/balanceAfter Int (:519-520), PayoutRequest.amountMinor Int (:2099), DealRoom.amountMinor
  (:2215), Subscription-планы priceMinor (subscriptions.ts:80-103). Единственный Float в схеме —
  LeakCase.confidence Float (contract.prisma:2318) — не деньги. Float-арифметика на money-путях отсутствует: split
  fees — `Math.round(finalPrice * 0.1)` (commerce.ts:44-47), скидка — `Math.floor(base*value/100)` (discount.ts:118),
  провайдерская граница — `Math.round(parseFloat(rub)*100)` (tbank.ts:128), float остаётся только в отображении
  `(amount/100).toFixed(2)` (email.ts:161, priceAlerts.ts:122, yookassa.ts:83). Защита от int4-переполнения есть
  только в выплатах: MAX_PAYOUT_AMOUNT_MINOR = 2_000_000_000 (payouts.ts:76-77) — Payment.amount Int (contract.prisma:455)
  имеет тот же физический предел ~21.4 млн ₽ на платёж без явного guard'а (сумма одного платежа — нефактический риск).
- change: ничего не менять в представлении. Переименование `amount` → `amountMinor` (Payment, Refund, LedgerEntry,
  DiscountUsage.amount, FinancialTransaction) — только по мере касания этих моделей другими волнами (мигрировать
  ради переименования не стоит). Опционально: clamp-хелпер `assertMinorAmount(int)` на входах создания Payment.
- reason: инвариант «integer minor units» соблюдён во всём коде; Plan C-005 выполнен; расхождение имён — косметика,
  а миграция имён ради красоты — риск без выгоды.
- risk: будущий код, копирующий `amountMinor`-нейминг вперемешку с `amount`, размывает читаемость — правило зафиксировать
  в DATA.md (одна строка).
- verification: `grep -rn "Float\|Decimal" site/server/src/prisma/contract.prisma` → только LeakCase.confidence;
  `grep -rn "\* 0\.\|/ 100" site/server/src/lib|routes` → только отображение/граница провайдера (перечислено выше).

---

## Приложение: что проверено и признано корректным (KEEP без находок)

- Checkout-тройка Order+OrderItem+Purchase атомарна, race-loss обрабатывается через partial unique + re-present
  (commerce.ts:192-269, contract.prisma:363-364 `purchase_buyer_resource_live_uq`).
- Resource completion: CAS + license + discount-usage + Order + outbox в одной транзакции; settlement после коммита
  с детерминированным id `settle:purchase:<id>` и репарацией на alreadyCompleted (commerce.ts:512-631).
- Refund: INV-013 потолок в транзакции под `pg_advisory_xact_lock` (refunds.ts:82-88,111-139); подтверждённые эффекты —
  одна транзакция с идемпотентностью через ledger `refund:<id>` (refunds.ts:243-356); K-004 revocation только на full
  refund (refunds.ts:276-291).
- Payout: транзишн-таблица + CAS + маркер ledger + withKeyLock (payouts.ts:68-74, 271-319).
- Ledger settlement exactly-once: dedup через FinancialTransaction marker + unique
  `financial_txn_settlement_once_uq` + `ledger_entry_tx_account_direction_uq` (contract.prisma:536-537,1046-1048;
  ledger.ts:306-335).
- Idempotency: DB-уникальность `[operation, key]`, PROCESSING-маркер, replay сохранённого ответа (idempotency.ts:79-216).
- dbErrors.ts: структурная классификация 23505 с обходом cause-цепочки, 15 потребителей (dbErrors.ts:22-71).
- Outbox: emitOutbox в транзакции доменного действия (events.ts:76-107; commerce.ts:592-598).
- CAS-хелперы `affectedCount` (discount.ts:151-164) и `transitionPaymentTo` CAS-цикл с ретраем (payments.ts:82-105) — KEEP.
- Partial unique captured-payment (`payment_purchase_captured_uq` / `payment_orderitem_captured_uq`, contract.prisma:470-471)
  и settlement-once (`financial_txn_settlement_once_uq`, :536-537) — корректные DB-инварианты мульти-инстансной топологии.

## Сводка

| Severity | Кол-во | Находки |
| --- | --- | --- |
| critical | 0 | — |
| high | 4 | B-004.2 (активация подписки не атомарна), B-004.3 (async-refund тупик), C-003.2 (DELETE ресурса), C-004.1 (cancel оставляет вечную PENDING-покупку) |
| medium | 9 | B-001.1 (мёртвый @prisma/client + док), B-002.2 (as any), B-004.1 (вебхук-цепочка), B-004.4 (update()-TOCTOU), B-004.4b (grants без DB-инварианта), C-001.1 (строковые состояния), C-001.2 (мёртвые состояния), C-002.1 (таблицы переходов), C-003.1 (payout cascade) |
| low | 13 | B-001.2 (скоу toolchain + CI drift-check), B-001.3 (postinstall), B-001.4 (миграции, baseline), B-002.1 (мёртвый алиас), B-003.1 (пагинация), B-005.1 (13 дублей-индексов), B-005.2, B-005.3, C-001.3, C-001.4, C-001.5, C-004.2, C-005.1 |