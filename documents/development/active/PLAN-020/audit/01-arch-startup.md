# PLAN-020 — Architecture & Startup audit (site/server, config/, startup.py, compose)

Scope: site/server/src (app/index, routes×48, lib/, middleware/, cli/, jobs/, worker/), config/, startup.py, infrastructure/docker/compose/*.yml. Sections A-001..A-005, N-001..N-004.
Method: static read-only inspection; import-graph cycle check over 147 TS modules; runtime probe of ORM init with missing DATABASE_URL. Every claim carries file:line. Audit date: 2026-02-14.

---

## A-001/P1 — Зависимостная карта и циклы: слои выдержаны, циклических импортов нет

- severity: low
- verdict: KEEP
- current: Направление зависимостей HTTP→application→data выдержано: ни один файл lib/, middleware/, prisma/, jobs/, worker/ не импортирует routes/ (grep по `from "../routes` / `from "./routes` — 0 совпадений). Полный граф из 147 .ts-файлов site/server/src (скрипт обхода относительных импортов) содержит 0 циклов. lib-граф ацикличен: adsBilling→subscriptions→entitlements→advertising, refunds→paymentProvider/paymentStateMachine, ledger→keyLock. Исключение-инверсия: lib/idempotency.ts:24 импортирует `reqLog` из ../middleware/requestId.js (нижний слой → HTTP-слой), используется на lib/idempotency.ts:184,207.
- change: Ничего не рефакторить. В lib/idempotency.ts заменить `reqLog(req)` на обычный `logger` из lib/logger.js (request-id всё равно попадает в логгер через requestIdMiddleware контекст) либо передавать logger параметром.
- reason: Единственная инверсия слоя — lib→middleware; она не даёт функциональной выгоды и блокирует вынос idempotency за пределы HTTP-процесса.
- risk: Минимальный: меняется только источник логгера; тексты событий сохраняются.
- verification: Повторный цикл-чекер (0 циклов) + grep `middleware/` внутри lib/ даёт 0 совпадений, кроме requestId в middleware-файлах.

## A-001/P2 — Нет ни одного владельца слоя данных: 43/48 route-файлов ходят в ORM напрямую

- severity: high
- verdict: SIMPLIFY
- current: Сервисный слой lib/ существует (~50 файлов), но покрытие неполное и несимметричное: 43 из 48 файлов routes/*.ts обращаются к `db.orm.public.*` inline (grep `db\.orm\.public` в routes/ — 43 файла; не обращаются только activity.ts, config.ts, deals.ts, media.ts, drm/v2.ts). Границы модулей держатся на конвенции и comment-driven знаниях (напр. app.ts:203-210), а не на контрактах. Типовой случай смешения HTTP+домен+данные: routes/seller.ts:64-77 (агрегация продаж по Purchase внутри обработчика), routes/dashboard.ts:98 (Purchase + ForumPost + ServerNews в одном хендлере).
- change: Не переписывать всё разом. Зафиксировать правило: каждый домен имеет один модуль-сервис в lib/ (как lib/commerce.ts, lib/drm/service.ts, lib/subscriptions.ts); новые/изменяемые эндпоинты обязаны идти через сервис домена, а не в ORM. Конкретный первый шаг — перевести через сервисы wallet (находка A-002/P2), discussion-thread (A-002/P3), drm revoke (A-002/P4).
- reason: Сейчас «модуль» = файл-роутер; контракт домена не существует, поэтому A-002 непроверяем автоматически и любое изменение схемы ломает сразу HTTP-слой.
- risk: Большой разовый рефакторинг; поэтому правило вводится инкрементально (только для изменяемых файлов), иначе высокий риск регрессий в 18.5k строк routes/.
- verification: grep-скрипт «route file → touched models» (сохранён в аудите) должен показывать для новых/изменённых файлов пустой список `db.orm.public.*`.

## A-001/P3 — Админ-поверхность раздроблена и порядок монтирования /admin зависит от регистрации

- severity: high
- verdict: MERGE
- current: Под /admin смонтировано 5 роутеров (app.ts:209-210, 228-229, 232, 233, 244-245) плюс админ-эндпоинты внутри корневых пользовательских роутеров: routes/deals.ts:277,297 (GET/POST /admin/deals — роутер смонтирован как `app.use("/", dealRoutes)` app.ts:249), routes/subscriptions.ts:5 (комментарий «/admin/subscriptions/* — admin surface», монтирование app.ts:248), routes/alerts.ts (`POST /alerts/dispatch`, app.ts:247). При этом adminPlatform.ts:300 и admin.ts:414 оба определяют GET /admin/users, admin.ts:516 — PATCH /users/:id/role; работоспособность зависит от порядка монтирования, что задокументировано как обязывающее условие в app.ts:203-210.
- change: Свести админ-эндпоинты deals/subscriptions/alerts в роутеры под /admin (adminFinance.ts / adminPlatform.ts) либо в отдельные admin-файлы; устранить дублирование /admin/users, перенеся user-management целиком в adminPlatform.ts, а admin.ts оставить для контента/модерации (/resources, /stats, /versions).
- reason: Порядок монтирования как «контракт» — скрытая связность: реорганизация app.use() молча меняет поведение авторизации/списков; корневые монтирования скрывают админ-поверхность от аудита путей.
- risk: Клиенты могут использовать конкретные пути — при MERGE сохранить URL-пути 1:1, менять только владение кодом; иначе сломаются фронтовые вызовы /admin/*.
- verification: Сгенерировать таблицу всех зарегистрированных путей (обход Router.stack) до/после — множество путей должно совпасть; e2e-тесты /admin/* зелёные.

## A-002/P1 — Кошелёк UserBalance записывается из auth-роутов; у таблицы нет владельца-сервиса

- severity: high
- verdict: FIX
- current: routes/auth.ts:94-103 `ensureUserBalance()` читает и создаёт UserBalance; вызовы в issueSession (auth.ts:132) и при выдаче баланса (auth.ts:213, 276, 624-625). Grep по всему src показывает: единственный писатель UserBalance — этот роут (остальные совпадения — только contract.d.ts). Таблица кошелька домена commerce не имеет сервиса-владельца, а identity-модуль пишет её inline из HTTP-слоя.
- change: Создать lib/wallet.ts (или перенести в lib/ledger.ts): ensureUserBalance(userId), getBalance(userId). routes/auth.ts вызывает контракт; остальные операции с балансом (начисления/списания) идут через ledger.ts.
- reason: Прямое нарушение A-002 (module A → внутренняя таблица модуля B) плюс риск: «создание кошелька при регистрации» размазано по HTTP-путям — новая точка создания пользователя (OAuth, CLI-сид) обязана помнить про ensureUserBalance.
- risk: Перенос должен сохранить семантику «каждый аккаунт стартует с 0» (auth.ts:92) — покрыть тестом, что регистрация и OAuth-логин создают строку кошелька.
- verification: Гипергреп `UserBalance.where(...).create` остаётся только в lib/wallet.ts; integration-тест регистрации возвращает balance.available=0.

## A-002/P2 — routes/serverNews.ts пишет в таблицы форума (чужой домен) inline

- severity: medium
- verdict: FIX
- current: routes/serverNews.ts:33-56 — `createNewsDiscussionThread()`/`createUpdateDiscussionThread()` читают ForumCategory (serverNews.ts:35,55) и создают ForumThread (serverNews.ts:38). Форум — домен community (community.ts), serverNews — домен servers; запись в чужую таблицу выполняется из HTTP-роутера напрямую.
- change: Вынести в lib/community.ts функцию `ensureNewsDiscussionThread({ serverId, newsId, title, authorId })` с логикой выбора категории; роутер вызывает контракт.
- reason: Правила форума (категория fallback «первая по позиции», state, replyCount) живут в роутере serverNews и будут продублированы при следующей точке создания треда.
- risk: Низкий: чистое перемещение кода; поведение тредов не меняется.
- verification: В routes/serverNews.ts не остаётся `db.orm.public.Forum*`; создание новости в e2e по-прежнему создаёт тред обсуждения.

## A-002/P3 — Легаси routes/drm.ts дублирует политику отзыва лицензии мимо lib/drm/service.ts

- severity: medium
- verdict: MERGE
- current: routes/drm.ts:97-105 (GET /drm/my-licenses — N+1: Purchase.all → License.first на каждую покупку → Installation.all на каждую лицензию) и routes/drm.ts:107-131 (DELETE /drm/revoke/:licenseId) реализуют логику лицензий inline: прямые update License/Installation (drm.ts:118,127). При этом lib/drm/service.ts:398 `revokeInstallation()` — канонический путь v2; v1-роут его не использует и не синхронизирует lease/entitlements.
- change: Оставить 410-эндпоинты activate/verify (routes/drm.ts:18-34, документированный deprecation). /drm/my-licenses переписать одним запросом License.where({buyerId-join}) или через сервис; /drm/revoke — делегировать в lib/drm/service.ts (новая функция revokeLicense с теми же инвариантами, что revokeInstallation).
- reason: Два кодовых пути отзыва с разной политикой — источник расхождения состояния (лицензия REVOKED, но installation/lease живые в одном пути и не в другом).
- risk: Изменение ответа revoke (сейчас `{message}`) — сохранить контракт ответа; проверить, что клиент DRM-модуля не парсит тела 410 как успешные (там protocol: "v1", status: "deprecated").
- verification: Интеграционный тест: revoke через v1-роут оставляет те же статусы License/Installation/Lease, что и v2-путь; grep подтверждает отсутствие прямых License.update в routes/.

## A-002/P4 — Сквозные чтения commerce-таблиц из чужих модулей: список точек

- severity: medium
- verdict: SIMPLIFY
- current: Прямые FK-чтения Purchase/Service/License из не-commerce роутеров: routes/seller.ts:64 (свитч «какой ресурс продаётся» для статистики продавца), routes/disputes.ts:40,48 (Purchase, ServicePurchase), routes/updates.ts:70,85 (Purchase, License), routes/versions.ts:404 (Purchase), routes/reviews.ts:96 (Purchase — проверка «покупал ли»), routes/resources.ts:467,562 (Purchase, Review-агрегаты), routes/dashboard.ts:98; из lib: lib/follows.ts:27-34 (buyerIds читает Purchase), lib/trust.ts (License, Purchase). Корректный образец межмодульной политики уже есть — lib/permissions.ts (Purchase, Resource, SellerProfile) как designated-контракт доступа.
- change: Не запрещать чтения по FK немедленно (это read-only контекст). Зафиксировать каталог: (1) проверки «покупал/имеет право» — только через lib/permissions.ts; (2) массовые агрегаты для чужих доменов — через вынесенные функции commerce-сервиса (как lib/commerce.ts), не inline-запросы в роутерах; (3) новые cross-domain записи — запрещены (см. A-002/P1..P3).
- reason: Каждое такое чтение — скрытая связность на колонки Purchase (buyerId, status, completedAt): изменение commerce-схемы ломает 8+ файлов вне commerce.
- risk: Перевод на контракты без изменения SQL-планов; медленные агрегаты (dashboard) могут потребовать индексов — отследить по плану B-005.
- verification: Codemod-отчёт: список файлов вне commerce, содержащих `db.orm.public.(Purchase|Service|License)` — должен сокращаться при каждом изменении; lint-правило из A-005/P2.

## A-003/P1 — lib/prisma.ts — форвардинг-обёртка без потребителей

- severity: low
- verdict: REMOVE
- current: lib/prisma.ts целиком: `export const prisma: typeof db.orm.public = db.orm.public` (+ комментарий про TS2742). Grep по src, tests, site/server — потребителей нет (0 совпадений вне самого файла).
- change: Удалить lib/prisma.ts.
- reason: Обёртка без владения, валидации, политики или кэша; алиас создаёт второй канонический путь доступа к ORM, размывая границу prisma/db.ts.
- risk: Нулевой — потребителей нет (проверено grep).
- verification: `pnpm --filter @mta-market/server exec tsc --noEmit` и `startup.py test unit` зелёные после удаления.

## A-003/P2 — routes/config.ts обходит кэш фич-флагов и дублирует резолв environment

- severity: medium
- verdict: MERGE
- current: routes/config.ts:13 на каждый GET /config/features вызывает `featureFlags()` из config/loader.ts напрямую → loadApplication() (loader.ts:304-345) синхронно читает 3 YAML + JSON-схему с диска и валидирует их на каждый запрос. lib/featureFlags.ts:37-52 существует ровно для этого (кэш 60s), но роутер его не использует; вдобавок routes/config.ts:13 повторяет inline-логику «production|development» вместо `featureEnvironment()` (lib/featureFlags.ts:20-22).
- change: В routes/config.ts использовать кэшированный доступ (экспортировать `cachedFlags()` из lib/featureFlags.ts) и featureEnvironment(); убрать прямой импорт loader из routes.
- reason: Два пути к одним данным с разной семантикой (кэш/без кэша) — риск расхождения флагов между /config/features и isFeatureEnabled() в течение 60s; плюс fs-нагрузка на публичный эндпоинт.
- risk: Поведенческое отличие: флаги на /config/features станут отставать до 60s после правки YAML — это уже контракт для isFeatureEnabled, расхождение исчезнет, а не появится.
- verification: Нагрузочный smoke GET /config/features ×1000 — отсутствие роста fs-операций (strace/метрика); значения совпадают с isFeatureEnabled().

## A-003/P3 — Реестр платёжных провайдеров собирается side-effect импортами, продублированными в двух входных точках

- severity: medium
- verdict: FIX
- current: lib/providers/payment-yookassa.ts:166-169 (и аналогично tbank/crypto/test, lib/providers/payment-*.ts) саморегистрируются в глобальном реестре `paymentProviders.register(...)` (lib/paymentProvider.ts:161,179). Список провайдеров собирается только побочными импортами: routes/payments.ts:19-20 (yookassa, tbank) и jobs/reconciliation.ts:25-27 (yookassa, tbank, crypto). Наборы РАЗНЫЕ: HTTP-эндпоинт не регистрирует crypto-провайдер, воркер — регистрирует.
- change: Ввести lib/providers/index.ts с явным `registerBuiltinProviders()` (все 4 провайдера) и вызывать его в routes/payments.ts, jobs/reconciliation.ts и worker/index.ts; убрать side-effect импорты.
- reason: Забытый импорт в новой входной точке молча даёт пустой реестр (провайдер «не найден» вместо ошибки конфигурации); расхождение наборов уже есть (crypto отсутствует в HTTP-пути).
- risk: Возможное изменение поведения: если crypto-провайдер специально скрыт от HTTP-публицы — тогда registerBuiltinProviders() принимает параметр набора; задокументировать.
- verification: Unit-тест: `paymentProviders.list()` содержит одинаковый набор в контекстах API и worker; e2e-оплата по каждому провайдеру проходит.

## A-003/P4 — worker/index.ts держит «compat»-динамические импорты для модулей, которые уже существуют

- severity: low
- verdict: SIMPLIFY
- current: worker/index.ts:102-116 `loadOptionalModule()` с try/catch и логом `worker_handler_missing` («module will be wired when its wave lands») для lib/demo.ts и lib/priceAlerts.ts; оба файла существуют (lib/demo.ts, lib/priceAlerts.ts в дереве src) и экспортируют контракты (worker/index.ts:34-40 описывает их).
- change: Заменить на статические импорты sweepDemos/notifyVersionReleases; оставить fallback-лог только если контракт действительно опционален.
- reason: Совместимый слой «модуль может отсутствовать» пережил свою волну: строковая связность скрывает опечатки имени модуля от компилятора.
- risk: Нулевой: модули присутствуют; при отсутствии файла сборка упадёт явно — что и требуется.
- verification: `tsc --noEmit` + `startup.py test unit`; в логах воркера нет `worker_handler_missing`.

## A-004/P1 — Инвентаризация compatibility-долга: что осталось и что уже исчезло

- severity: low
- verdict: KEEP (документированное) / REMOVE (один пункт) / DEFER (мост контейнеров)
- current: (1) DRM v1 410-эндпоинты — routes/drm.ts:13-34, ссылка на ADR-001 в коде; это документированный tombstone, потребители — старые клиенты модуля. (2) CLI-алиасы startup.py:1320 `ALIASES = {"tests": "test", "site": "build"}` — используются в скриптах/документации (проверить перед удалением). (3) Мост легаси-контейнеров startup.py:726-741: ensure_dev_infra переиспользует контейнеры со «stage-имёнами» от прежнего стека mta-market-site — сам комментарий называет это transitional. (4) Слой «api-ext compatibility» из плана A-004 — в коде отсутствует (grep по site/server/src, startup.py, documents — единственное совпадение это текст PLAN-020.md:105), т.е. снят ранее.
- change: (1) и (2) — KEEP до отдельной волны (задокументировать дату снятия). (3) — после подтверждения, что легаси-стек нигде не запущен (динамическая проверка), удалить ветку переиспользования: ensure_dev_infra должен всегда поднимать compose-проект сам.
- reason: Слои (1),(2) несут реальную совместимость; мост (3) — скрытая связность с несуществующей в monorepo сущностью, маскирующая «чужие» контейнеры на канонических портах.
- risk: Удаление (3) сломает окружения, где контейнеры ещё подняты под старыми именами — отсюда DEFER.
- verification: `docker ps --format '{{.Names}}'` на всех dev-хостах: нет контейнеров вне проекта mta-market-dev; затем удаление ветки startup.py:730-734 и повторный `startup.py dev` с нуля.

## A-005/P1 — Правило направления зависимостей не зафиксировано инструментально

- severity: low
- verdict: FIX
- current: Фактическое направление выдержано (A-001/P1), но enforce отсутствует: ни ESLint-правил, ни dependency-cruiser в site/server/package.json (проверено: скрипты тестов/линта не содержат boundary-конфигурации), единственная защита — комментарии в app.ts:203-210 и заголовки файлов.
- change: Добавить dependency-cruiser (или eslint-plugin-boundaries) с правилами: routes/* → lib/*, prisma/* разрешено; lib/* → routes/* запрещено; middleware/* → lib/* разрешено, lib/* → middleware/* запрещено (фиксирует находку A-001/P1); routes/A → routes/B запрещено.
- reason: Единственное инвертированное ребро (lib→middleware) появилось именно потому, что правило нигде не проверяется; без инструмента A-002/A-005 регрессируют при каждой волне.
- risk: Первое включение может подсветить существующие нарушения (сейчас известен 1 кейс) — ввести в warn-режиме, затем strict.
- verification: `pnpm dlx dependency-cruiser --validate` в CI: 0 violations; зелёный PR, добавляющий импорт routes в lib, отклонён.

---

## N-001/P1 — Rate limits: три источника истины с уже проявившимся расхождением

- severity: high
- verdict: FIX
- current: Один и тот же параметр интерпретируется тремя местами: (1) config/application/limits.yaml — колонки по средам (limits.yaml:7-32, production: auth 100, standard 300, strict 10, login 10, refresh 30); (2) startup.py load_limits (startup.py:322-338) экспортирует `<NAME>_RATE_LIMIT_MAX` только при запуске через startup.py (startup.py:413-414); (3) production.yml пинит собственные дефолты (production.yml:55-59) с комментарием «production values match», а lib/rateLimit.ts держит четвёртую копию литералов: strict "10" (rateLimit.ts:88), standard "300" (95), auth "300" (105). Фактический дрейф уже есть: fallback для AUTH = 300, тогда как production-дефолт и limits.yaml = 100 (production.yml:55, limits.yaml:12). В production-контейнере limits.yaml вообще не читается (config/ не поставляется в образ — loader.ts:12-15), значения приходят только из compose-env.
- change: Один источник: limits.yaml. Генерировать env-строку для compose из limits.yaml на CI (скрипт `config:emit-env`, единая реализация — см. N-002/P1) и убрать литеральные fallback'и в rateLimit.ts, заменив на обязательный env с fail-fast при отсутствии (или дефолт, сгенерированный из того же YAML на билд-этапе).
- reason: Расхождение лимитов между окружениями — прямая дыра в защите от брутфорса/DoS: повышение AUTH-лимита в limits.yaml ничего не меняет в проде, и наоборот.
- risk: Изменение фактических лимитов в средах, где relied на fallback (локальный запуск без startup.py: auth станет 100 вместо 300) — зафиксировать в тесте ожидаемые значения.
- verification: Тест-конфарманс: экспорт `config:emit-env development|production` == значения, подставляемые в production.yml; integration-тест читает лимит из env и сравнивает с limits.yaml соответствующей колонки.

## N-001/P2 — startup.py игнорирует YAML-ключи storage.s3Enabled / email.enabled, подменяя их константами

- severity: medium
- verdict: FIX
- current: derive_environment (startup.py:407-408): `S3_ENABLED = "false" if environment == "development" else "true"`, `EMAIL_ENABLED = "false" if environment in ("development","test") else "true"` — жёстко по имени среды. При этом ключи существуют и валидируются схемой: development.yaml `storage.s3Enabled: false`, production.yaml `storage.s3Enabled: true` (production.yaml:15) и `email.enabled: true` (production.yaml:23), staging.yaml `email.enabled: false`; loader.ts типизирует их (loader.ts:45,48). Ни startup.py, ни сервер эти ключи не читают: фактические источники — env (s3.ts:14, email.ts:7).
- change: В derive_environment читать cfg_get(data, ("storage","s3Enabled")) / ("email","enabled") с теми же дефолтами, что сейчас захардкожены; либо удалить ключи из YAML и схемы (см. N-001/P3), оставив env-контракт.
- reason: Схема+типы обещают, что конфиг управляет S3/email, а редактирование development.yaml/production.yaml не даёт эффекта — типичная мнимая конфигурация.
- risk: Если кто-то уже полагался на «правку YAML не работает, ставим env» — после фикса значения совпадут с YAML только при синхронизации файлов; сверить все 4 environment-файла с текущими env.
- verification: Тест-конфарманс: правим s3Enabled в test.yaml-копии → `startup.py dev` экспортирует S3_ENABLED соответственно (можно проверить derive_environment(unit) без запуска сервисов).

## N-001/P3 — Семейство конфиг-ключей, валидируемых схемой, но не потребляемых никем

- severity: medium
- verdict: REMOVE (или подключить — по каждому ключу решение зафиксировать в schema-описании)
- current: Ключи, объявленные в config/schemas/environment.schema.json и фигурирующие в environment-файлах, но не имеющие потребителей: (1) `payments.providersEnabled` (production.yaml:26, staging.yaml) — гейтинг провайдеров идёт через YOOKASSA_ENABLED/TBANK_ENABLED/CRYPTO_ENABLED (startupValidation.ts:124-153); (2) `module.drm.marketApiBase`, `keyStoreHome` (development.yaml:36-39, production.yaml) — C++-модуль получает base_url в рантайме через Lua `mta_market_configure(base_url, server_token)` (module/src/functions/drm/market.cpp:39-54), keyStoreHome не упоминается нигде; (3) `vitest.fileParallelism`, `testTimeoutMs` (test.yaml) — vitest.config.ts:25-29 хардкодит те же значения; (4) `e2e.baseURL/apiUrl/adminEmail` (test.yaml) — playwright.config.ts:19 берёт `E2E_BASE_URL` env, adminEmail задаётся в тестах; (5) `database.test.url` (test.yaml) дублирует дефолт в vitest.config.ts:7, а `database.test.composeFile` игнорируется — startup.py жёстко задаёт COMPOSE_TESTS (startup.py:62), потребляя только database.test.hostPort (startup.py:946).
- change: Удалить непотребляемые ключи из YAML и schema (additionalProperties: false уже защищает от новых) ЛИБО подключить: vitest/playwright читать test.yaml (один loader), composeFile — параметризовать в startup.py. Для каждого ключа решение фиксировать комментарием в schema.
- reason: Мёртвые ключи — источник ложной уверенности: правка test.yaml меняет vitest только в чьих-то ожиданиях, не в реальности.
- risk: Если какой-то внешний скрипт всё же читает эти ключи — греп перед удалением по scripts/, .github/, tests/ (сейчас совпадений нет).
- verification: После удаления — `startup.py doctor` (валидация config/) зелёный; `grep -r "<key>" .` вне config/ — 0 совпадений.

## N-001/P4 — loader.ts: мёртвые экспорты loadEnvironment/rateLimitsFor и дублирование знания о схеме окружения

- severity: low
- verdict: REMOVE
- current: config/loader.ts:277 `loadEnvironment()` и loader.ts:357 `rateLimitsFor()` не имеют ни одного потребителя (grep по src, tests, site/server — только объявление). EnvironmentConfig (loader.ts:24-52) — типизированная копия environment.schema.json, поддерживаемая вручную. Реально из loader.ts используются только featureFlags() (routes/config.ts:6, lib/featureFlags.ts:26) и внутренний loadApplication().
- change: Удалить loadEnvironment, rateLimitsFor и тип EnvironmentConfig (либо wiring'нуть их как единственный reader конфига в TS — но тогда должен появиться потребитель, см. N-001/P1). parseYamlSubset/validateAgainstSchema оставить — они contract-механика для application-конфига и, потенциально, для emit-env.
- reason: Мёртвый код второго интерпретатора окружения создаёт иллюзию, что сервер сам читает environments/*.yaml (он не читает — только startup.py, development.yaml:3-5).
- risk: Нулевой при отсутствии потребителей (проверено).
- verification: tsc + unit после удаления; grep `loadEnvironment|rateLimitsFor` — 0.

## N-001/P5 — Расхождения семантики двух YAML/JSON-Schema-интерпретаторов (startup.py vs loader.ts)

- severity: low
- verdict: FIX (конформанс-тест), долгосрочно MERGE (см. N-002/P1)
- current: Реализации написаны «с одинаковыми семантиками» (startup.py:88-92), но: (1) python различает integer/number (startup.py:191-193,209-210): значение `3` при schema.type "number" → actual "integer" → ошибка «expected type number»; TS считает typeof 3 == "number" (loader.ts:200-205) → принимает. Для текущих схем не стреляет (в schemas есть только integer/boolean/string/array), но латентно. (2) YAML с индентацией верхнего уровня python принимает: parse_block стартует с indent первой строки (startup.py:163), TS требует indent==0 (loader.ts:129 «top-level key must not be indented») → разный вердикт на одном и том же malformed-файле. (3) Списки: TS молча пропускает строки «-» (loader.ts:99) и падает позже с чуть другим сообщением; python падает сразу (startup.py:147-149) — расхождение в тексте ошибки.
- change: Добавить conformance-тест (tests/unit): фиксированный набор YAML-сэмплов (valid/malformed/edge) прогоняется и через parse_yaml, и через parseYamlSubset, плюс schema-кейсы — ассерты идентичности результата и текста ошибки.
- reason: Два интерпретатора одного контракта без общего теста расходятся молча — это и есть главный риск N-001, а не текущие баги.
- risk: Тест зафиксирует текущие различия как «ожидание» — перед этим выровнять тексты ошибок или допускать «same accept/reject, message may differ».
- verification: тест зелёный; намеренно внести расхождение в один парсер — тест краснеет.

## N-002/P1 — startup.py остался оркестратором, но дублирует интерпретацию конфига (~250 строк)

- severity: medium
- verdict: KEEP (роль) + SIMPLIFY (дубликат парсера)
- current: startup.py не стал вторым backend'ом: не слушает HTTP, не пишет в БД напрямую — только prisma CLI (startup.py:759-765) и tsx-сиды (startup.py:789). Роль соответствует плану: orchestrate/validate/launch/lifecycle (cmd_dev/release/test/db/status/logs/stop/clean/doctor, startup.py:798-1273). Но он несёт полную копию YAML-парсера и JSON-Schema-валидатора (startup.py:94-244) параллельно loader.ts:66-243, а также собственную интерпретацию ключей (N-001/P1, P2).
- change: Оставить startup.py как единственный entrypoint (соответствует PLAN-017 §13), но убрать дубликат: вынести `derive_environment`/`load_env_config` в одну TS-утилиту (`site/server/src/config/emit-env.ts`) и вызывать её из startup.py (`pnpm exec tsx config/emit-env.ts <env>`), оставив в python только запуск и проверку exit-code. Python-парсер остаётся только для `validate_all_config`/doctor либо тоже переезжает в emit-env.
- reason: Один интерпретатор конфига — прямое требование N-001; 1368-строчный python с копией парсера неизбежно дрейфует (доказательства дрейфа — N-001/P1..P5).
- risk: Локальный dev теперь требует node даже для чтения конфига — приемлемо, т.к. cmd_dev и так требует node/pnpm (startup.py:804); fallback: сохранить python-парсер как validator-only c conformance-тестом (N-001/P5).
- verification: `startup.py dev` поднимает стек с теми же env (сравнить `derive_environment` вывод до/после через `startup.py doctor`-подобный dry-run); conformance-тест из N-001/P5 удалён вместе с python-копией.

## N-003/P1 — production.yml и staging.yml дублируют env-контракт сервиса

- severity: medium
- verdict: MERGE
- current: production.yml держит якорь `x-backend-environment: &backend-environment` (production.yml:8-70, ~60 переменных), staging.yml повторяет тот же блок (staging.yml:18 environment, ключи REDIS_URL/JWT_SECRET/RATE_LIMIT_* на staging.yml:35-36+) с отличиями только в именах контейнеров/портах. Дубликат уже дал мелкий дрейф возможностей (наборы переменных в двух файлах различаются — diff без комментариев занимает >100 строк) и будет дрейфовать с каждой новой переменной (как уже случилось с rate limits, N-001/P1).
- change: Вынести общий env-якорь в общий фрагмент (compose `include` или отдельный `backend-common.env.yml` через `extends`/`x-` файл, подключаемый обоими), генерируемый из config/ (N-001/P1). Различия (STACK_PREFIX, hostPort) оставить в файлах окружений.
- reason: Топология dev/release/test предсказуема и документирована (development.yml:1-11 — только stateful-сервисы; tests.yml:1-16 — одноразовый postgres:5433; staging.yml:1-10 — зеркало prod), но контракт переменных существует в двух копиях.
- risk: Изменение механизма подключения env — проверить оба окружения после merge: `docker compose -f production.yml config` и `-f staging.yml config` должны показать идентичные env-блоки кроме ожидаемых различий.
- verification: diff `docker compose ... config` прод/стейджинг — только имена контейнеров, порты и префиксы; CI-джоб, сравнивающий env-наборы, зелёный.

## N-003/P2 — Топологии dev/test/release согласованы и документированы

- severity: low
- verdict: KEEP
- current: dev: только postgres+redis в контейнерах, приложение на хосте (development.yml:1-11, healthchecks обоих сервисов); test: одноразовый изолированный postgres-test на 5433 с параметризуемым портом и суффиксом контейнера (tests.yml:5-16, 20-40), уничтожается после прогона (startup.py:967-969); release: полный стек backend+worker+nginx+postgres+redis c healthchecks и smoke-проверками /ready, nginx->web, pg_isready, redis-cli ping (startup.py:923-935); staging — то же с префиксом staging (staging.yml:5-9). Worker выделен в отдельный сервис без портов, healthcheck по процессу (production.yml:146-171).
- change: Не требуется. Зафиксировать описанное в documents/operations, если ещё нет.
- reason: Соответствует требованию N-003 о предсказуемой и документированной топологии.
- risk: —.
- verification: `python startup.py status` показывает все компоненты; smoke `startup.py test release` зелёный.

## N-004/P1 — Порт занят: сервер падает нечитаемым стеком; dev-старт не считает это ошибкой

- severity: medium
- verdict: FIX
- current: (1) index.ts:24 `const server = app.listen(PORT, () => {...})` — обработчик 'error' не вешается: EADDRINUSE → uncaught 'error' event → процесс падает с сырым стеком без указания «занять порт/поменять PORT»; PORT не валидируется (index.ts:22 `process.env.PORT || 3001`, нечисловое значение даст ERR_SOCKET_BAD_PORT). (2) cmd_dev (startup.py:822-824) ждёт только /health и при таймауте печатает INFO «API not healthy yet» и завершается с exit 0 (startup.py:853 возвращает 0, т.к. spawn_detached вернул alive через 1.5s); «доктор» проверяет занятость только postgres-порта (startup.py:1229-1231), не API/web.
- change: (1) В index.ts: `server.on("error", ...)` с явным сообщением для EADDRINUSE (порт, подсказка `PORT=`) и process.exit(1); валидировать PORT как positiveInt с понятной ошибкой. (2) В cmd_dev: перед spawn проверять `port_open(api_port/web_port)` и падать с FAIL+подсказкой; ожидать `/ready`, а не `/health`; при таймауте возвращать 1 (сейчас успех «не здоров, но ок»).
- reason: N-004 требует явных ошибок старта; сейчас занятый порт маскируется под «пока не отвечает», а واقعная причина — только в logs/development/backend.log.
- risk: CI/e2e-сценарии, полагающиеся на мягкий успех cmd_dev при уже запущенном сервисе (spawn_detached:616-619 переиспользует живой pid — этот путь сохраняется); таймаут-ветка станет ошибкой — обновить скрипты, где это использовалось как «best effort».
- verification: `PORT=3001 python -m http.server 3001` (занять порт) → `python startup.py dev backend` завершается FAIL с сообщением о занятом порте; `python startup.py test smoke` зелёный после исправления.

## N-004/P2 — Инициализация ORM выполняется раньше валидации окружения: понятная диагностика не достигает пользователя

- severity: medium
- verdict: FIX
- current: ES-импорты поднимаются до первого оператора index.ts: `db.js` (→ prisma/db.ts:8 `url: process.env["DATABASE_URL"]!`) инициализируется на этапе импорта, а `enforceEnvironmentValidation()` вызывается только после (index.ts:1-12). Runtime-проба: конструктор ORM при пустом/отсутствующем url бросает на этапе инициализации ошибку вида «Contract structural validation failed: domain must be an object …» — сырое сообщение о контракте маскирует реальную причину (нет DATABASE_URL); в production процесс гибнет до того, как startupValidation.ts:69-70 успел напечатать «DATABASE_URL is required in production».
- change: Сделать конфиг-зависимые импорты ленивыми: в index.ts сначала `enforceEnvironmentValidation()` (и dotenv), затем `await import("./app.js")`/`./prisma/db.js`; либо в db.ts валидировать DATABASE_URL до конструктора с человеческой ошибкой. Аналогично worker/index.ts:49 (там validation тоже после импортов).
- reason: Класс N-004 «invalid config» сейчас даёт diagnostic-шум вместо явного отказа.
- risk: Перестановка импортов меняет порядок side-effect'ов (dotenv/config в db.ts:1 загружает .env до остальных модулей) — dotenv оставить первым, проверить, что ни один модуль не читает DATABASE_URL на top-level кроме db.ts.
- verification: Тест как в tests/unit/site/startup-policy.test.ts: запуск без DATABASE_URL в production печатает «DATABASE_URL is required» и exit != 0 (а не contract-стектрейс); интеграционный прогон не зависит от порядка.

## N-004/P3 — Обработка отказов зависимостей в рантайме согласована (Redis/DB/docker/config)

- severity: low
- verdict: KEEP
- current: Redis: fail-closed для критичных лимитеров (503) и fail-open по умолчанию для bulk (lib/rateLimit.ts:33-63), /ready сообщает redis как optional (app.ts:170); DB: /ready → 503 при недоступности (app.ts:160-172), liveness /live не зависит от зависимостей (app.ts:152-156); docker недоступен — явный FAIL в dev/release/test (startup.py:720-722, 891-893, 943-945); невалидный config: startup.py жёстко падает с путём и текстом ошибки (startup.py:258-262), сервер деградирует к дефолтам с warning — осознанно, т.к. образы без config/ (loader.ts:12-15); release-смоук проверяет /ready + компоненты стека и возвращает 1 при отказе (startup.py:920-935); worker переживает отказ джоб (worker/index.ts:127-133 лог worker_job_failed, цикл продолжается).
- change: Не менять. Опционально: добавить в /ready проверку, что применённая схема БД актуальна (дешёвая pragma/системная таблица) — сейчас /ready отвечает 200 на БД с любой схемой.
- reason: Поведение отказов соответствует плану; падение на /health-only в cmd_dev закрыто находкой N-004/P1.
- risk: —.
- verification: Динамические прогоны (DEFER): поднять API без DB → /ready=503, /live=200; без Redis → auth-эндпоинт 503, bulk проходит; `startup.py release` при остановленном postgres → FAIL и exit 1.

---

## Сводка

| severity | count |
|---|---|
| critical | 0 |
| high | 4 (A-001/P2, A-001/P3, A-002/P1, N-001/P1) |
| medium | 11 (A-002/P2, A-002/P3, A-002/P4, A-003/P2, A-003/P3, N-001/P2, N-001/P3, N-002/P1, N-003/P1, N-004/P1, N-004/P2) |
| low | 9 (остальные) |
| Итого | 24 |