# PLAN-020 — аудит 04: асинхронные процессы (outbox / worker / Redis / локи)

Зона: `site/server/src/worker/index.ts`, `site/server/src/jobs/`, `site/server/src/lib/{events,redis,keyLock,rateLimit,notify,serverMonitoring,priceAlerts}.ts`, `lib/reconciliation/`, `lib/sandbox/` + всё, что пишет/читает outbox или использует Redis (`lib/commerce.ts`, `routes/admin.ts`, `lib/activity.ts`).

Разделы плана: E-001..E-006, F-001..F-004 (`documents/development/completed/PLAN-020.md:423-563`).

Метод: чтение кода, трассировка полного цикла outbox, инвентаризация всех обращений к `redis.*` (grep по `site/server/src`), всех вызовов `emitOutbox`, `withKeyLock`, `bustActivityCache`. Каждое утверждение снабжено файл:строка. Файлов репозитория (кроме данного отчёта) не касались.

---

## E-001 — Outbox: вставка вне транзакции и без await в admin.ts

- severity: high
- verdict: FIX
- current: Контракт `emitOutbox` — «insert в ТОЙ ЖЕ транзакции, что и доменное действие» (lib/events.ts:99-105). Из трёх продюсеров это соблюдено только в `lib/commerce.ts:512` (открытие `db.transaction`) → `commerce.ts:592` (`emitOutbox(tx, "PAYMENT_SUCCEEDED", ...)` — в транзакции, комментарий 588-591). В `routes/admin.ts` PATCH `/admin/resources/:id/status` вся цепочка (status-апдейт admin.ts:159, ModerationEvent:162, версия → PUBLISHED :193-195) идёт по корневому `db` **без транзакции**, а `emitOutbox(db, "RESOURCE_VERSION_PUBLISHED", ...)` (admin.ts:199-204) и `emitOutbox(db, "RESOURCE_PUBLISHED", ...)` (admin.ts:243-247) — ещё и **без `await`** (проверено grep: перед `emitOutbox` нет `await` на обеих строках). Краш/перезапуск между :195 и :199 теряет событие навсегда; отклонённый промис вставки необработан (unhandledRejection), порядок относительно последующих записей не гарантирован.
- change: Обернуть публикационный блок в `db.transaction(async tx => ...)` и вызывать `emitOutbox(tx, ...)` с `await` внутри; минимум — добавить `await` перед обоими вызовами (admin.ts:199, admin.ts:243) как временную меру.
- reason: Именно здесь нарушен инвариант «publish не может произойти до/без commit» — событие прилада к версии теряется при крэше, и срабатывание price-alert (VERSION_RELEASED) молча пропускается.
- risk: Транзакция увели длительность блокировки Resource на время fan-out уведомлений (buyer/follower/creator queries admin.ts:210-216) — fan-out лучше вынести за транзакцию, оставив в ней только status+событие.
- verification: Тест «краш на каждом стыке»: (1) после `ResourceVersion.update(PUBLISHED)` бросить исключение до insert → в outbox есть событие при любом исходе; (2) grep-проверка `await emitOutbox` во всех продюсерах; (3) интеграционный тест publish → ровно одно событие в outboxEvent.

## E-002 — Идемпотентность консюмеров: dedup check-then-insert без unique-констрейнта

- severity: medium
- verdict: FIX
- current: Единственный реальный консюмер (`RESOURCE_VERSION_PUBLISHED` → `priceAlerts.notifyVersionReleases`, worker/index.ts:230-281) защищает дубликат через проверку существования Notification (priceAlerts.ts:325-331: SELECT по `entityType="resourceVersion", entityId=version.id`) перед вставкой. Схема Notification **не имеет** unique-констрейнта на (recipientId, entityType, entityId) (contract.prisma:1811-1826 — только индексы [recipientId, readAt] и [recipientId, createdAt]), `createNotifications` вставляет последовательно без dedup-ключей (lib/notify.ts:49-63). Тот же check-then-insert в `notifyPriceDrops` (priceAlerts.ts:108-116) и `notifyDiscountStarts` (priceAlerts.ts:204-212). Слуги запускаются одновременно из двух мест: интервальная задача worker (worker/index.ts:433-461) и ручной триггер `POST /alerts/dispatch` (routes/alerts.ts:202-206) → окно гонки реально.
- change: Частичный unique-индекс `ON notification(recipientId, entityType, entityId) WHERE entityType IS NOT NULL` через формальную миграцию + вставка с игнорированием unique-violation (паттерн уже есть в lib/idempotency.ts / isUniqueViolation, lib/dbErrors.ts).
- reason: Повторная доставка события (E-002 плана) сегодня даёт пользователю дубликат уведомления при совпадении по времени двух свипов или ретрая после частичного создания.
- risk: Unique-индекс может «поднять» исторические дубликаты — перед созданием почистить существующие пары; вставка с ON CONFLICT-семантикой должна не падать, а пропускать (created+0).
- verification: Параллельный тест: два одновременных вызова `deliverVersionRelease` для одной версии + одного получателя → ровно одна строка Notification; повторная обработка того же outbox-события не создаёт дублей.

## E-002b/E-006 — Двойная доставка VERSION_RELEASED: admin inline vs outbox-консюмер

- severity: medium
- verdict: MERGE
- current: На публикацию версии уведомления уходят двумя параллельными механизмами с разными dedup-ключами и одинаковым текстом: (1) inline в routes/admin.ts:210-228 — `deliverFollowNotifications(... type RESOURCE_UPDATE, title "… — новая версия X", entityType:"resource", entityId:<resourceId>`) покупателям+фолловерам ресурса+фолловерам креатора; (2) через outbox событие (admin.ts:199) → worker → `priceAlerts.notifyVersionReleases` → `deliverVersionRelease` (priceAlerts.ts:317-347) с тем же title (priceAlerts.ts:338) и dedup `entityType:"resourceVersion", entityId:<versionId>`. Пользователь, одновременно фолловер и держатель PriceAlert с VERSION_RELEASED, получает две одинаковые записи; CRON-свая `sweepRecentVersionReleases` (priceAlerts.ts:268-314) — третья копия того же оповещения в другом дедупе.
- change: Оставить один канал доставки «новая версия» — outbox → worker (он уже идемпотентен и переживает рестарт); inline-блок admin.ts:210-228 заменить на фолловерский список, передаваемый в единый `deliverVersionRelease`, либо оставить inline и не эмитить событие, а CRON-свайп убрать. Dedup-ключ выбрать один (`resourceVersion:<versionId>`).
- reason: E-006 требует «producer/schema/consumer/idempotency» на каждое событие; сейчас у VERSION_RELEASED две реализации доставки с несовместимыми ключами дедупликации — классический дубликат событий.
- risk: Мерж меняет типы уведомлений, которые уже доставлены: старые записи с `entityType:"resource"` не защитят новых получателей — после мержа возможен один повтор по каждому подписчику (приемлемо, зафиксировать в changelog).
- verification: E2E: подписчик с PriceAlert(VERSION_RELEASED) + ResourceFollow → публикация версии → ровно 1 уведомление; затем рестарт воркера → 0 новых.

## E-003 — Claim/CAS outbox: механизм корректен, одиночный воркер задокументирован

- severity: low
- verdict: KEEP
- current: Claim — чтение кандидатов (status=PENDING, availableAt≤now, attempts<max, orderBy createdAt, limit) events.ts:161-169, затем построчный CAS `where({id, status:"PENDING", attempts: current}).updateAndCount({status:"PROCESSING", attempts:+1})` (events.ts:174-181); проигравший гонку (`affectedCount !== 1`) пропускает строку. Два воркера не могут владеть одной строкой одновременно: второй CAS даёт 0 обновлений. SKIP LOCKED в ORM недоступен — построчный CAS это честная замена; потеря — только лишний candidate-read (events.ts:149-151). Сироты PROCESSING после hard-kill подхватываются boot-репилейном (worker/index.ts:190-211), graceful shutdown возвращает недиспетченные строки в PENDING (worker/index.ts:214-223, 329-335). Полный цикл: insert (events.ts:113-117) → claim → dispatch → `completeEvent` CAS PROCESSING→PROCESSED (events.ts:198-203) / `failEvent` (events.ts:217-252).
- change: Ничего не менять сейчас; при планах на >1 воркера — добавить lease-таймштамп (processingUntil) в строку и периодический reaper вместо boot-only репилейна (worker/index.ts:190), т.к. boot-репилейн живого воркера вернёт чужую PROCESSING-строку в PENDING → двойная обработка.
- reason: Механизм безопасен в заявленной топологии (один воркер — worker/index.ts:24-25, events.ts:14-15); риск появляется только при масштабировании.
- risk: Добавление lease-поля — миграция; premature-изменение без нужды усложняет claim.
- verification: Нагрузочный тест: 2 экземпляра claimBatch на одной БД → суммарно каждая строка заявлена ровно 1 раз (сумма attempts по строке = число доставок); kill -9 между claim и complete → boot-reclaim возвращает строку в PENDING.

## E-004 — Retry-политика: конечна, но нет permanent-failure и ручного retry

- severity: low
- verdict: FIX
- current: Retries конечны: claim не берёт строки с attempts≥maxAttempts (events.ts:166), failEvent при attempts≥max ставит FAILED (dead-letter, events.ts:229-235), backoff = 2^attempts·30s с clamp [1,20] (events.ts:50-60) — бесконечного ретрая нет. Но: (1) «постоянные» ошибки (malformed payload — worker/index.ts:263-267; unknown event type) гоняются все 5 попыток с экспонентой до 480s — нет класса permanent-failure с немедленным dead-letter; (2) ручного retry нет: нет ни CLI, ни админ-эндпоинта для requeue FAILED (grep по routes/cli — только emit в admin.ts; `retrySandbox` в другой зоне тоже бросает «not implemented», sandbox/service.ts:211); (3) failEvent читает строку не-CAS и пишет отдельным апдейтом (events.ts:222-245) — при потере PROCESSING-статуса между read и write вернёт RETTY для чужой строки (безвредно, CAS-guard по status в апдейте, но отчётность искажается).
- change: Добавить в `failEvent` параметр `permanent?: boolean` и проброс из dispatch для ошибок валидации payload (worker/index.ts:263-267) — сразу DEAD_LETTER; добавить админ-эндпоинт `POST /admin/outbox/:id/requeue` (CAS PROCESSING/FAILED → PENDING, availableAt=now).
- reason: E-004 плана требует «manual retry»; сейчас dead-letter можно разглядеть только в SystemLog (worker/index.ts:308-316) и вручную в БД.
- risk: Requeue-эндпоинт — точка эскалации прав: закрыть под админ-ролью; permanent-failure при ошибочной классификации пропустит ретраи, которые могли бы спасти доставку — применять только к schema-валидации.
- verification: Юнит-тест: malformed payload → 1 claim → статус FAILED сразу (не 5 ретраев); requeue FAILED-строки эндпоинтом → PENDING → обработка.

## E-005 — Retention outbox: удаления нет вообще (и у сопутствующих таблиц)

- severity: high
- verdict: FIX
- current: Ни одного `delete` по OutboxEvent в кодовой базе (grep `OutboxEvent` + delete/remove/cleanup — пусто); PROCESSED и FAILED копятся вечно (contract.prisma:2071-2087, индексы status+availableAt и eventType+createdAt). Прецедент ретеншена в репо есть: SystemLog граничит 14 дней / последние 5000 одним bounded DELETE (lib/systemLog.ts:63-76, 100-109) — outbox его не имеет. Также неограниченно растут: ReconciliationReport/ReconciliationMismatch (создаются каждым циклом: 4-5 отчётов/сутки, lib/reconciliation/service.ts:60-71, 121-129, 466-477; удаления нет), PaymentProviderEvent (webhook-журнал, contract.prisma:485-503; удаления нет), SandboxRun (cleanupOldSandboxRuns существует — sandbox/service.ts:219-236 — но **никогда не вызывается**: ни планировщик, ни роут, grep по вызывающим пуст).
- change: В worker добавить интервальную задачу `retention_sweep`: удалять OutboxEvent с status=PROCESSED старше 7 дней и FAILED старше 30 дней (партиями по createdAt, использует существующий индекс eventType+createdAt — лучше добавить индекс по status+createdAt); аналогичные политики для ReconciliationReport(+mismatch cascade)>90д, PaymentProviderEvent>90д; вызывать `cleanupOldSandboxRuns(30)` из того же свипа.
- reason: E-005: «queue tables cannot grow indefinitely». PAYMENT_SUCCEEDED пишется на каждую покупку (commerce.ts:592) — это самая быстрорастущая таблица системы.
- risk: Ретеншен FAILED раньше разбора кейсов — потеря forensic-данных; удалить можно только терминальные статусы (PROCESSED/FAILED), никогда PENDING/PROCESSING; перед удалением large-batch убедиться, что ORM-удаление батчится (по строке, как sandbox/service.ts:230-232, или raw SQL по образцу systemLog.ts:64-74).
- verification: Тест: вставить N терминальных строк с старым createdAt → свип удаляет их, PENDING/PROCESSING не трогает; метрика роста таблицы outboxEvent между циклами ~0.

## E-006 — Владение событиями: 8 из 11 типов без producer, 2 без consumer, метрики не подключены

- severity: medium
- verdict: FIX
- current: Инвентаризация (events.ts:28-40 — 11 типов):
  | event | producer | consumer | idempotency |
  |---|---|---|---|
  | RESOURCE_VERSION_PUBLISHED | admin.ts:199 ( вне tx, без await — см. E-001) | worker→priceAlerts.notifyVersionReleases (worker/index.ts:230-281) | notification dedup (priceAlerts.ts:325-331) — но см. E-002 |
  | RESOURCE_PUBLISHED | admin.ts:243 (вне tx, без await) | НЕТ — worker ACK-ит по умолчанию (worker/index.ts:283-298) | — |
  | PAYMENT_SUCCEEDED | commerce.ts:592 (в tx ✔) | НЕТ — ACK без обработки | — |
  | USER_REGISTERED, PAYMENT_FAILED, REFUND_COMPLETED, PAYOUT_COMPLETED, DISPUTE_OPENED, DISPUTE_UPDATED, LICENSE_EXPIRING, SECURITY_ALERT | не эмитится никем | нет | нет |
  Дублирующиеся реализации событий: outbox (lib/events.ts) vs CRON-свайпы priceAlerts (priceAlerts.ts:85-129,138-233,268-314, запускаются и worker'ом worker/index.ts:433-461, и HTTP POST /alerts/dispatch routes/alerts.ts:202-206) vs inline-доставка admin.ts:210-228 — VERSION_RELEASED живёт во всех трёх (см. E-002b). Сторонний «журнал событий» PaymentProviderEvent (contract.prisma:485-503) — это inbound-idempotency вебхуков (unique [provider,providerEventId,eventType], routes/payments.ts:378-425), отдельная роль, MERGE с outbox не нужен. Метрики outbox (`recordOutboxDepth/incOutboxProcessed/incOutboxDeadLetter`, lib/metrics.ts:125-157) не вызываются нигде (grep — только определения): глубина очереди и dead-letter не наблюдаемы, хотя worker логирует их текстом (worker/index.ts:308-316).
- change: (1) ACK-без-хендлера для финансовых типов (PAYMENT_SUCCEEDED/FAILED, REFUND/PAYOUT) заменить на FAILED с lastError="no_handler_wired" вместо молчаливого PROCESSED (worker/index.ts:283-298) — события не «испаряются» до подключения консюмеров; (2) вычеркнуть из OUTBOX_EVENT_TYPES типы, у которых не появится продюсер в этом релизе, либо пометить в коде как reserved; (3) подключить метрики: depth после claim, processed после completeEvent, dead-letter на outcome==="DEAD_LETTER" (worker/index.ts:306-317).
- reason: E-006: каждое событие должно иметь producer/schema/consumer/retry/idempotency; сейчас схема — «словарь на вырост», а наблюдаемость очереди мёртвый код.
- risk: FAILED-вместо-ACK переключит поведение ретраев: no_handler должен ставиться как permanent (см. E-004), иначе infinite retry; reserved-типы в контракте событий полезны клиентам — удаление словаря согласовывать с планом H-001.
- verification: Тест: PAYMENT_SUCCEEDED при отсутствии консюмера → статус FAILED + SystemLog; `/metrics` содержит ненулевые outbox_depth/outbox_processed_total после обработки.

## F-001 — Классификация Redis: только rate-limit + activity-cache; стейл-комментарий «sessions»

- severity: low
- verdict: KEEP (с правкой комментария — SIMPLIFY)
- current: Полная инвентаризация `redis.*` (grep по site/server/src; единственный клиент — lib/redis.ts:7-17, ioredis, offline-queue включён по умолчанию):
  | назначение | ключ | файл:строка | TTL |
  |---|---|---|---|
  | rate limit (IP) | `rl:strict:<ip>`, `rl:standard:<ip>`, `rl:auth:<ip>` | rateLimit.ts:27,66-88 (incr :30, pexpire :33) | windowMs 60s/60s/900s — только при `current===1` (:32-34) |
  | rate limit (user+action) | `rlu:<action>:<userId>` | rateLimit.ts:115-121 | windowMs (30s-1h на маршрутах) — только при `current===1` (:119-121) |
  | cache (activity) | `activity:live:v2`, `activity:snapshot:v2:{5..50}` | activity.ts:30-31,122,131 | 45s всегда (`SET ... EX 45`, :131) |
  | invalidation | DEL списка ключей | activity.ts:140-148 | — |
  | lifecycle | disconnect на shutdown | index.ts:58, worker/index.ts:484-489 | — |
  Локов, очередей, сессий и персистентных доменных данных в Redis НЕТ (локи — in-process, keyLock.ts:14-32; сессии — JWT/cookie; воркер Redis не держит вовсе — worker/index.ts:481-483). Ключи без TTL: только дефектный кейс из находки F-001b ниже (incr без pexpire при падении между командами). Заголовок lib/redis.ts:1 «rate limiting, sessions» — ложь насчёт sessions (стейл-комментарий).
- change: Исправить комментарий redis.ts:1 на фактическое использование; зафиксировать эту таблицу как контракту F-001 в модуле (docblock над клиентом). Redis остаётся ephemeral-хранилищем: «unapproved persistent-data usage» отсутствует — удалять нечего.
- reason: Классификация подтверждена кодом; отдельной чистки не требуется, но контракт надо зафиксировать, чтобы не появился «второй Redis-паттерн».
- risk: Нет.
- verification: grep `redis\.` по src — совпадает с таблицей; `redis-cli --scan` в стейджинге — все ключи с TTL (кроме задокументированного бага ниже).

## F-001b/F-004 — Rate limit: INCR+PEXPIRE не атомарен → ключ может остаться без TTL (вечный 429)

- severity: medium
- verdict: FIX
- current: Оба лимитера делают `redis.incr(key)`, а `pexpire` — только если `current === 1` (rateLimit.ts:30-34 для IP-лимитов; :118-121 для userRateLimit). Если процесс упадёт/потеряет связь между INCR и PEXPIRE (или pexpire отклонится при Redis-микроауте), счётчик останется навсегда: последующие запросы видят `current > 1`, TTL никогда не выставится повторно → этот IP/пользователь+action получит 429/503 навсегда (fail-closed лимитеры strict/auth ещё и 503, rateLimit.ts:50-55) до ручной чистки Redis.
- change: Сделать окно атомарным: Lua-скрипт (`local c = redis.call('INCR',KEYS[1]); if c==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; return c`) либо `SET key 0 PX window NX` + INCR, либо страховка `redis.pexpire(key, windowMs)` на КАЖДОМ incr (PEXPIRE дёшев, перезапуск окна на отказе pexpire некритичен).
- reason: Классическая race-ошибка двухкомандных rate limiters; воспроизводится обрывом соединения ровно между incr и pexpire.
- risk: Lua-вариант требует поддержки скриптов тестовым Redis; страховочный pexpire-на-каждый-incr мягко продлевает окно при повторных попаданиях — семантика «fixed window» сохраняется.
- verification: Тест: incr без pexpire (симуляция падения) → следующий запрос возвращает TTL>0 (TTL-инвариант); интеграционно: `redis-cli TTL rl:auth:<ip>` > 0 после любого 429.

## F-002 — Матрица инвалидации: activity-кэш полон (ключи бакетированы), триггеры известны

- severity: low
- verdict: KEEP
- current: Единственный Redis-кэш — activity. Ключи/TTL: `activity:live:v2` (activity.ts:30) и `activity:snapshot:v2:<limit>` (:31) с TTL 45s (:29, SET EX :131). Источник — агрегация по таблицам Server/Resource/Forum/News/Review/Article (read-layer, activity.ts:1-15). Триггеры инвалидации `bustActivityCache()` (activity.ts:140-148; удаляет live + снапшоты limit 5..50 шаг 5): routes/serverNews.ts:287,490; routes/community.ts:286,511; routes/admin.ts:206,248; routes/adminContent.ts:94,222; routes/serverReviews.ts:256. Client-limit бакетируется к кратным 5, поэтому перечень ключей баста полон (activity.ts:719-723). Задокументированное исключение: heartbeat-зависимые SERVER_ONLINE/live-aggregates не бастятся — TTL 45s как safety net (activity.ts:137-139); heartbeat-апдейт Server.monitoring/playerCount (routes/integration.ts:75-90) и monitoring-свайп (lib/serverMonitoring.ts:54-57) intentionally не бастят.
- change: Ничего; при добавлении новых источников активности — добавить триггер в их mutation-роуты по той же таблице.
- reason: Матрица key/TTL/source/trigger полная и закомментирована в коде; stale-read ограничен 45s по дизайну «fast signal, not a monitor» (activity.ts:26).
- risk: Нет.
- verification: E2E: публикация новости → GET /activity/snapshot не содержит элемент до и после баста; TTL всех activity-ключей ≤45s (redis-cli TTL).

## F-003 — Stale-read аудит: resource/server/notification/profile/balance/advertising не кэшируются в Redis — риск только у activity (≤45s)

- severity: low
- verdict: KEEP (DEFER по остальным доменам)
- current: Redis используется только rateLimit.ts и activity.ts (grep; см. F-001) — значит resource, server (кроме производных в activity), notification, profile, balance, advertising читаются напрямую из БД без кэша → stale-read невозможен. Единственная кэшируемая проекция — activity (агрегаты + снапшот): после heartbeat/monitoring-обновления (integration.ts:75-90, serverMonitoring.ts:54-57) данные в `activity:live:v2` устаревают до 45s; это явно задокументировано как компромисс (activity.ts:137-139). Попытка уведомления-дедупа (Notification) — это check-then-insert гонка, не кэш (см. E-002). In-memory кэш есть ещё у featureFlags — 60s, источник config YAML, без инвалидации (featureFlags.ts:28-30,54) — осознанно, есть env-override для мгновенного отключения (:10-24).
- change: Ничего; при появлении кэшей на перечисленных доменах — расширять таблицу F-002.
- reason: Зона проверки покрыта; актуальных stale-read рисков вне 45s-окна activity нет.
- risk: Нет.
- verification: Ручной чек: изменить title ресурса → activity-снапшот показывает старое название ≤45s (задокументированное окно), остальные эндпоинты отражают правку сразу.

## F-004 — Планировщики воркера без cross-instance лока: дубли reconciliation-отчётов при >1 инстансе

- severity: medium
- verdict: FIX
- current: Все фоновые задачи воркера защищены только in-process single-flight (`running`-флаг: worker/index.ts:131-145; идентичный паттерн в неиспользуемом jobs/reconciliation.ts:257-271). Нет ни Redis-лока, ни DB advisory lock для: reconciliation (worker/index.ts:389-397), server monitoring (:398-411), demo sweep (:416-425), price-alert sweep (:433-461), самого outbox-loop'а (консюмер защищён CAS'ом — E-003). При запуске двух воркеров: reconciliation-цикл параллельно создаёт дублирующиеся ReconciliationReport с одинаковым окном (service.ts:60-71 — `create` без дедупа), мониторинг-свайп дважды перезапишет Server.monitoring, price-alert свыпы устроят гонку из E-002. Вопрос плана «может ли лок истечь посреди критической секции» — сегодня неактуален в обратную сторону: экспирирующих локов нет вообще; in-process мьютекс не может истечь. Обратный риск: воркер может висеть дольше интервала — `startIntervalJob` пропускает тик пока предыдущий не завершился (worker/index.ts:133-135), unbounded-выполнение не наслаивается.
- change: Добавить вокруг reconciliation-цикла (и demo/price-alert свипов) `pg_try_advisory_lock(hashtext('<job>'))` на соединении воркера (Postgres уже есть, Redis воркеру вводить не придётся — он его сегодня не держит, worker/index.ts:481-489) или TTL-лок `SET lock:<job> NX PX <interval>` если Redis приемлем. Пропуск тика при неудаче захвата — лог warn.
- reason: F-004 требует, чтобы concurrent reconciliation/payments/payouts не портили состояние; платежные пути уже защищены (см. следующую находку), а jobs — нет.
- risk: Забытый release advisory-лока при крэше соединения не врёт: сессия умерла → лок освобождён автоматически (в этом смысл advisory-лока против TTL-ключа).
- verification: Тест: два параллельных `runReconciliationCycle()` под локом → второй пропущен (лог), ReconciliationReport за окно ровно один набор; без лока — дубли.

## F-004b — keyLock: in-process мьютекс без expiration — истечение невозможно; лимитация single-instance задокументирована и прикрыта БД

- severity: low
- verdict: KEEP
- current: `withKeyLock` — keyed promise-chain (keyLock.ts:20-31): лок «держится» до завершения fn, expiration-времени нет → «lock истёк посреди критической секции» невозможно по построению; deadlock-ов нет (очередь промисов, failures изолированы :23-26). Используется на всех финансовых критических секциях: payouts (lib/payouts.ts:130 `payout:<sellerId>`, :253 `payout:<payoutId>`), subscriptions (:439,:498,:645), checkout (lib/commerce.ts:103), adsBilling (:99,:261), ledger settle (lib/ledger.ts:271 `settle:<purchaseId>`). Ограничение «мьютекс живёт в одном процессе» задокументировано (keyLock.ts:9-12) и компенсировано DB-инвариантами: детерминированный id ledger-транзакции `settle:purchase:<id>` + идемпотентный replay (commerce.ts:613-624), DB idempotency-key (lib/idempotency.ts:8-13), unique-констрейнты webhook-событий (contract.prisma:500, routes/payments.ts:407-426).
- change: Не менять; при переходе на multi-instance — заменить на Redis SET NX PX + токен владельца, либо оставить keyLock как second layer и полагаться на DB-констрейнты (уже частично так).
- reason: Для заявленной топологии (один backend-контейнер, keyLock.ts:5-7) решение адекватно и не создаёт риска истечения лока.
- risk: Нет.
- verification: Нагрузочный тест на один ключ из N параллельных запросов — критическая секция исполняется последовательно (трассировка логов без перекрытия таймстампов).

## JOBS-1 — Reconciliation: full-table scans и N+1 (зона lib/reconciliation)

- severity: medium
- verdict: FIX
- current: (1) `fetchInternalTransactions` грузит ВСЕ платежи провайдера и фильтрует по периоду в JS (service.ts:207-209, filter :226); (2) `checkProviderEventMismatches` — `.all()` по всем PaymentProviderEvent и всем Payment (service.ts:480-486) с фильтрацией в памяти; (3) `reconcileAllPurchases` — `.all()` всех COMPLETED-покупок (internal.ts:47-49) + per-purchase lookup Resource (internal.ts:75-77, классический N+1) + per-seller SellerBalance/FinancialTransaction (internal.ts:108-128) + per-transaction проверка сирот (internal.ts:172-190); (4) `getReconciliationSummary` — два `.all()` без лимита (service.ts:567-568); (5) `sweepDemos` — все DemoSession в память (lib/demo.ts:227); (6) `getSandboxRuns` — все SandboxRun (sandbox/service.ts:191-194). Это ежедневный цикл (jobs/reconciliation.ts:35) — рост таблиц покупок/событий линейно увеличивает память и время воркера.
- change: Перенести период-фильтры в WHERE (внутренние транзакции по `createdAt`-окну, события по `receivedAt`-окну), seller-агрегацию сделать GROUP BY вместо по-строчных запросов, сироты — через LEFT JOIN/exists. Достаточно одного прохода с тремя агрегатными запросами.
- reason: Паттерн «.all() + JS filter» в фоновой задаче, которая обязана пережить рост данных (B-005-принципы применить к jobs).
- risk: Переписанные запросы должны сохранить честность отчёта (не «терять» транзакции у границы периода — inPeriod использует `>= periodStart && <= periodEnd`, internal.ts:187-191 — сохранить семантику).
- verification: Прогон цикла на сиде 10k/100k покупок: время цикла суб-линейно, no per-row queries в логе; сравнить mismatch-результаты до/ после рефакторинга на фикстуре.

## JOBS-2 — Сegaменты мёртвого кода: неиспользуемые планировщики и lib→jobs инверсия

- severity: low
- verdict: REMOVE
- current: Планировщики, заменённые воркером, остались экспортированными и неиспользуемыми: `startReconciliationScheduler` (jobs/reconciliation.ts:238-289; worker использует `startIntervalJob`+`runReconciliationCycle`, worker/index.ts:389-397) и `startServerMonitoringScheduler` (jobs/serverMonitoring.ts:9-41; worker использует `runMonitoringSweep` напрямую, worker/index.ts:398-411) — grep по вызывающим: только определения и re-export. Кроме того, `lib/reconciliation/index.ts:29-34` ре-экспортирует из `../../jobs/reconciliation.js` — lib зависит от jobs (инверсия слоёв; A-005-зона, но след в моей зоне).
- change: Удалить неиспользуемые планировщики (и дублирующий `running`-флаг), перенести ре-экспорт job-функций из lib/reconciliation/index.ts в точку входа CLI/скриптов; `runDailyReconciliation` оставить (используется npm-скриптом reconciliation:run, site/server/package.json:19).
- reason: Два конкурирующих способа запустить один цикл — источник рассинхронизации (например, кто-то вызовет старый планировщик в API-процессе, и reconciliation начнёт работать в двух процессах).
- risk: Убедиться, что ни один тест не импортирует удалённые функции (grep перед удалением).
- verification: `pnpm typecheck`/тесты после удаления; grep `startReconciliationScheduler|startServerMonitoringScheduler` — 0 результатов.

## JOBS-3 — Sandbox: полностью мок-раннер, cleanup не вызывается, retry не реализован

- severity: low
- verdict: FIX
- current: Docker-раннер — заглушки: createContainer/startContainer/executeInContainer/extract* всегда возвращают «success» без реального исполнения (sandbox/runner.ts:122-265; executeInContainer резолвит через 100ms, :164-172). `validateArtifact` вызывается из routes/versions.ts:178 — т.е. публикационный гейт (admin.ts:150-156) опирается на мок-результаты SandboxRun. `cleanupOldSandboxRuns(30)` (sandbox/service.ts:219-236) не вызывается никем (grep) → SandboxRun растёт вечно; `retrySandbox` всегда бросает «not implemented» (service.ts:200-212); `getSandboxRuns` — full-scan по всем записям (service.ts:191-194). Тайминг: runSandbox полностью управляется таймаутом опций, гонок нет, но promiseWithTimeout (runner.ts:245-252) объявлен и не используется — реальный exec без hard-timeout при появлении dockerode.
- change: (1) Запланировать cleanup в worker retention-свипе (см. E-005); (2) явно пометить модуль как stub в докблоке и в выводе validateArtifact (поле `mock: true` в SandboxRun), чтобы гейт публикации не создавал ложной уверенности; (3) при подключении dockerode — Promise.race с таймаутом на каждый этап (заготовка :245-252) + гарантированный removeContainer в finally.
- reason: Async-политика: мок не является «обработкой»; плюс retention-дыра как в E-005.
- risk: Пометка mock в отчёте SandboxRun — изменение схемы ответа; фронт может показывать «validation passed» — синхронизировать UI.
- verification: Свип удаляет SandboxRun старше 30 дней; grep `mock` в runner.ts помечает все заглушки; интеграционный тест upload → SandboxRun создан с признаком мока.

## JOBS-4 — Monitoring-свайп: EXPIRED перезаписывает CONSUMED (нет статус-guard'а в UPDATE)

- severity: low
- verdict: FIX
- current: `runMonitoringSweep` читает ACTIVE-токены и для просроченных делает `where({id}).update({status:"EXPIRED"})` без guard'а по статусу (lib/serverMonitoring.ts:65-70). Между candidate-read и update токен может быть израсходован (`CONSUMED` — contract.prisma:1367-1371) — свип молча перезапишет CONSUMED → EXPIRED. Аналогично серверная часть: `where({id}).update({monitoring:"UNKNOWN"})` (:54-57) безопасна (поля монитора не конфликтуют), но идемпотентность обеспечена только повторным чтением.
- change: Добавить status в where: `where({id: t.id, status:"ACTIVE"}).update({status:"EXPIRED"})` (CAS, как в claimBatch).
- reason: Тот же класс CAS-дисциплины, что E-003; защита бесплатна.
- risk: Нет.
- verification: Тест: consume токен параллельно со свипом → финальный статус CONSUMED.

## JOBS-5 — Окно reconciliation без watermark: покрытие с «дырами» при простое воркера

- severity: low
- verdict: DEFER
- current: Окно цикла — `[now - interval, now]` (jobs/reconciliation.ts:44-51); если воркер лежал дольше интервала, транзакции из пропуска никогда не попадут в отчёт (нет хранения «последнего обработанного окна»; `runDailyReconciliation` с календарным днём есть только для ручного запуска :53-62). Повторный запуск окно перекрывает (дубли отчётов честные), но gap остаётся незамеченным.
- change: (DEFER до появления метрик цикла) — хранить watermark (последний periodEnd COMPLETED-отчёта) и начинать окно от него; либо алертить по «age of last report».
- reason: Financial-coverage вопрос, но при текущем 24h-цикле и ручном backfill-инструменте (jobs/reconciliation.ts:296-318) риск приемлем.
- risk: Водяной знак усложняет параллельный запуск (конфликтует с FIX F-004 — делать вместе).
- verification: Простой воркера на 3 дня → следующий цикл покрывает весь простой; отчёты не имеют разрывов по periodStart/periodEnd.

---

## Сводка

| severity | находки |
|---|---|
| critical | 0 |
| high | 2 — E-001 (outbox вне tx/без await), E-005 (нет retention) |
| medium | 6 — E-002 (dedup без unique), E-002b (двойная доставка VERSION_RELEASED), E-006 (словарь событий + мёртвые метрики), F-001b (неатомарный rate limit), F-004 (нет cross-instance лока у планировщиков), JOBS-1 (full scans reconciliation) |
| low | 10 — E-003, E-004, F-001, F-002, F-003, F-004b, JOBS-2, JOBS-3, JOBS-4, JOBS-5 |

Всего: 18 находок. Вердикты: FIX×9, KEEP×6, MERGE×1, REMOVE×1, DEFER×1.