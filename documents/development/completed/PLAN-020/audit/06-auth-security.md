# PLAN-020 — аудит 06: аутентификация, авторизация и security-инфраструктура

Зона: `site/server/src/routes/auth.ts`, `lib/{jwt,cookies,identityProvider,permissions,audit,rateLimit,auth,tokenCrypto,tokenSecurity,logger}.ts`, `middleware/`, `lib/providers/{discord,yandex,google,vk,telegram}.ts`, все admin-роуты (`admin.ts`, `adminPlatform.ts`, `adminAdvertising.ts`, `adminFinance.ts`, `adminPremium.ts`, `adminCommunity.ts`, `adminContent.ts`, `leak.ts`), модель сессии (`Session`), OAuth-токены (`Account`), frontend-авторизация `site/web/src`, `app.ts`, `infrastructure/nginx/nginx.conf`, `config/`, `startup.py`, `.github/`.

Разделы плана: I-001..I-004, J-001..J-004, Q-001..Q-006 (`documents/development/completed/PLAN-020.md:718-825,1162-1229`).

Метод: чтение кода с фиксацией файл:строка; grep-инвентаризация guard'ов (`requirePermission`, `requireRole`, `adminOnly`) по всем admin-роутам; трассировка жизненного цикла сессии (issue → refresh → reuse → revoke); grep секретов по `site/server/src`, `scripts/`, `.github/`, `config/`, `.env*`, `logs/`; проверка CI-workflow. Файлы репозитория (кроме этого отчёта) не изменялись.

---

## I-001-a — Матрица провайдеров: password

- severity: low
- verdict: KEEP
- current: Регистрация POST /auth/register (`routes/auth.ts:159-232`): zod-схема (`auth.ts:77-86`, пароль 8..200), pre-check username/email (`auth.ts:182-199`), bcrypt cost 10 (`auth.ts:201`), роль принудительно USER (`auth.ts:206`). Логин POST /auth/login (`auth.ts:235-295`): username ИЛИ email (`auth.ts:245-249`), единая ошибка `INVALID_CREDENTIALS` для unknown-identity и неверного пароля (анти-энумерация, `auth.ts:252-266`), проверка `status !== "ACTIVE"` (`auth.ts:267-272`). Лимиты: IP-bucket `authRateLimit` (300/15мин, `lib/rateLimit.ts:83-88`; prod=100, `infrastructure/docker/compose/production.yml:55`) + per-user login 10/мин (`auth.ts:235`, `LOGIN_RATE_LIMIT_MAX` production.yml:58). Смена пароля PATCH /auth/password требует текущий пароль и отзывает прочие сессии (`auth.ts:565-611`).
- change: Без изменений. Два мелких дефекта вынесены в отдельные находки (I-001-b, I-001-c).
- reason: Контракт логина/регистрации корректен и соответствует плану PLAN-001.
- risk: —
- verification: `tests/integration/api/auth/login-session.test.ts` (rotation/reuse/logout — :85,:105,:138); ручной curl регистрации/логина.

## I-001-b — Регистрация: TOCTOU username/email даёт 500 вместо 409

- severity: low
- verdict: FIX
- current: Проверки занятости username/email выполняются отдельными SELECT до INSERT (`auth.ts:182-199`); `User.email @unique` и `User.username @unique` (`prisma/contract.prisma:24,27`) — реальная защита, но параллельные регистрации одного username/email падают с необработанным unique-violation → глобальный 500 «Registration failed» (`auth.ts:226-231`). То же для OAuth-username: `buildUsername` check-then-create (`auth.ts:56-61`, вызов `auth.ts:1057`).
- change: Ловить unique-violation (по аналогии с `isUniqueViolation` из `lib/dbErrors.ts`, применяемым в `routes/payments.ts:404-408`) и отвечать 409 USERNAME_TAKEN/EMAIL_TAKEN.
- reason: Инвариант держится на БД, но клиентский контракт ломается гонкой.
- risk: Никакого — маппинг ошибки.
- verification: Параллельные POST /auth/register с одним username → один 201, один 409.

## I-001-c — Логин: per-account dimension отсутствует (spray по одному аккаунту)

- severity: low
- verdict: FIX
- current: `userRateLimit({action:"login"})` на /auth/login (`auth.ts:235`) ключуется `req.user?.userId ?? req.ip` (`lib/rateLimit.ts:111-115`) — в логине `req.user` нет, bucket фактически per-IP (10/мин/IP в prod). Распределённый brute-force одного аккаунта с многих IP ограничен только IP-бакетами.
- change: Ключовать login-limiter по нормализованному `login` (identifier) в дополнение к IP: `rlu:login:<hash(login)>`, общий лимит на пару (ip+identifier).
- reason: Комментарий `rateLimit.ts:90-95` обещает identity-размерность — на login она вырождается в IP.
- risk: Ложно-положительные 429 для NAT с одним логином — выбрать консервативный max.
- verification: Интеграционный тест: 11 попыток логина одного аккаунта с разных IP за минуту → 429.

## I-001-d — Матрица провайдеров: Google / Yandex / VK / Discord / Telegram + discovery + disabled-provider

- severity: low
- verdict: KEEP
- current: Discovery GET /auth/providers отдаёт только ENABLED провайдеров (`auth.ts:704-715`), без конфигурации провайдер просто отсутствует. Отключённый провайдер даёт 404 на всех поверхностях: GET /auth/:provider (`auth.ts:842-845`), callback (`auth.ts:886-889`), link (`auth.ts:729-732`, `auth.ts:805-808`), telegram POST callback (`auth.ts:771-774`). isEnabled: Google `lib/providers/google.ts:44-46`, Yandex `lib/providers/yandex.ts:44-46`, VK `lib/providers/vk.ts:53-55`, Discord `lib/providers/discord.ts:46-48` (clientId+secret+redirectUri), Telegram — наличие bot-токена (`lib/providers/telegram.ts:146-148`). Verified-email политика: существующий пользователь «забирается» только при `user.email && user.verified` (`auth.ts:1044-1052`); иначе синтетический `.local` email (`auth.ts:1056`). Yandex намеренно всегда `verified:false` (`yandex.ts:125`), Telegram не имеет email (`telegram.ts:126`), Google `email_verified` (`google.ts:127`), VK `email_verified` (`vk.ts:150`), Discord `verified` (`discord.ts:129`). Telegram direct-login: HMAC data-check-string, constant-time compare, окно свежести 24ч, replay-guard по (id, auth_date) (`telegram.ts:82-111,169-183`).
- change: Без изменений (проблемы переноса — I-003-a, I-003-b).
- reason: Матрица discovery/login/linking/unlinking/disabled полная и безопасная: takeover через неподтверждённый email провайдера исключён.
- risk: —
- verification: `tests/integration/api/auth/providers-discovery.test.ts`, `tests/integration/api/auth/identity-link.test.ts:103-163`.

## I-001-e — OAuth: state-CSRF корректен, но PKCE отсутствует у всех redirect-провайдеров

- severity: low
- verdict: DEFER
- current: Callback проверяет `query.state === cookie.oauth_state` (`auth.ts:896-905`), cookie 10 мин, httpOnly, sameSite=lax (`auth.ts:31-44`); mismatch → 400 (тест `identity-link.test.ts:389`). State генерируется `crypto.randomBytes(16)` (`discord.ts:55`, `google.ts:53`, `vk.ts:62`, `yandex.ts:53`). PKCE не используется нигде: VK отправляет пустой `code_verifier` (`vk.ts:85-98`), Discord/Google/Yandex — только state.
- change: DEFER: добавить PKCE (S256) для Discord/Google/Yandex/VK при ближайшем касании провайдеров; самостоятельного приоритета нет (same-site callback topology, state закрывает CSRF).
- reason: Code interception требует контроля редирект-URI или междоменного утечета; топология behind-nginx её не создаёт.
- risk: Несовместимые провайдеры потребуют включения PKCE пофлагово.
- verification: В authorize-запросе появился `code_challenge`; в token-exchange — `code_verifier`.

## I-002-a — Сессии: rotation / reuse detection / revocation / revoke all / expiry / device listing

- severity: low
- verdict: KEEP
- current: Refresh-токен — JWT type=refresh с jti, типовая изоляция access/refresh (`lib/jwt.ts:25-72`); в БД только SHA-256 хэш (`Session.refreshTokenHash @unique`, `contract.prisma:113`; `lib/tokenSecurity.ts:11-13`), сравнение timing-safe (`tokenSecurity.ts:31-33`). POST /auth/refresh: валидация JWT → поиск сессии по хэшу (`auth.ts:298-322`); replay СТАРОГО токена после ротации → `reuseDetected=true` → отзыв всего tokenFamily (`auth.ts:325-357`); ротация создаёт новую сессию того же family и ставит новый cookie (`auth.ts:368-390`); просроченная сессия удаляется (`auth.ts:359-366`). Logout удаляет сессию по хэшу (`auth.ts:403-428`). Сессии пользователя: GET /auth/sessions (метаданные без токенов, фильтр по expiry, маркер `current`, limit 50, `auth.ts:438-467`), DELETE /auth/sessions/:id (ownership-guard `auth.ts:470-495`), DELETE /auth/sessions (отзыв всех прочих, `auth.ts:499-522`). Frontend SessionsCard.tsx ровно соответствует API (список/отзыв одного/«завершить все прочие», без токенов, `site/web/src/components/account/SessionsCard.tsx:29-136`). Suspend из adminPlatform жёстко удаляет сессии (`routes/adminPlatform.ts:589-591`).
- change: Без изменений по контракту; дефекты реализации — I-002-b (гонка ротации) и I-002-c (нет re-check статуса/роли).
- reason: Все пять пунктов I-002 реализованы и покрыты тестами (`tests/integration/api/auth/login-session.test.ts:85-138`).
- risk: —
- verification: интеграционные тесты выше; вручную: login → refresh → replay старого cookie → 401 «reuse», все сессии family удалены.

## I-002-b — Ротация без атомарной CAS-пометки: гонка переигрывает reuse detection

- severity: medium
- verdict: FIX
- current: Ротация: `Session.where({id}).update({reuseDetected:true})` (`auth.ts:374-376`) затем INSERT новой сессии (`auth.ts:379-387`). Обновление безусловное (нет `reuseDetected=false` в WHERE и нет подсчёта затронутых строк), поэтому два параллельных запроса с одним и тем же старым refresh-токеном оба читают сессию с `reuseDetected=false` (`auth.ts:316-325`), оба проходят ветку reuse, оба создают дочерние сессии → вместо одной lineage получается N параллельных валидных веток, и последующий replay уже не всегда отзывывает всё семейство. Дополнительно флаг `reuseDetected` перегружен смыслом «токен уже использован» (маркер нормальной ротации = маркер атаки), поэтому потеря ответа при легитимном refresh (cookie не обновился) приводит к отзыву всей family при повторе старого токена.
- change: Атомарная CAS-ротация: `UPDATE session SET reuseDetected=true WHERE id=? AND reuseDetected=false` c подсчётом затронутых строк (`updateAndCount`, как в `adminPlatform.ts:581-587`); count=0 → трактовать как reuse. Разделить семантику: `usedAt` (легитимное использование) и `reuseDetected` (инцидент) — либо уникальный частичный индекс на «активный» токен family.
- reason: Reuse detection — ключевая защита refresh-потока; текущее окно гонки её ослабляет, а перегрузка флага превращает сетевой retry в принудительный logout всей family.
- risk: Нужно проверить поведение тестов (`login-session.test.ts:105`) и фронтового single-flight refresh (`site/web/src/lib/api.ts`, 401→single-flight) — CAS-ветка должна возвращать «session not found» с тем же 401.
- verification: Тест: 2 параллельных refresh с одним старым токеном → ровно одна новая сессия; replay старого после успешной ротации → 401 и пустая family.

## I-002-c — Refresh не перепроверяет user.status/role; role в JWT протаскивается бесконечно

- severity: high
- verdict: FIX
- current: POST /auth/refresh вообще не читает User: роль/статус берутся из payload СТАРОГО JWT (`verifyRefreshToken` → `generateAccessToken(payload)`/`generateRefreshToken(payload)`, `auth.ts:307-370`), а expiresAt каждой ротации сдвигается на +7d (`auth.ts:383`) — sliding-сессия. Следствия: (1) SUSPENDED/BANNED пользователь с живой сессией бесконечно продлевает доступ; (2) пониженный/заблокированный админ сохраняет роль ADMIN в access-токенах бесконечно (guard'ы `requirePermission`/`adminOnly` читают `req.user.role` из JWT, `lib/permissions.ts:351-364`, `lib/auth.ts:31-44`). Работающая альтернатива в кодовой базе уже есть: suspend делает `Session.delete` (`adminPlatform.ts:589-591`), но легаси-роут статуса не отзывает сессии (см. J-001-c), и OAuth-логин вообще обходит статус (I-002-d).
- change: В refresh после поиска сессии один раз прочитать User и: проверить `status === "ACTIVE"`, иначе удалить сессию + clearRefreshCookie + 401; брать `role/email` для новых токенов из БД, а не из payload. (Опционально — tokenVersion в JWT.)
- reason: Инвариант «отзыв доступа должен срабатывать не позднее следующего refresh» сейчас не выполняется; вместе с I-002-d бан становится полностью обходимым.
- risk: Рост числа запросов к БД на refresh на 1 read; тесты, подменяющие payload (если есть), потребуют обновления.
- verification: Тест: ban пользователя → POST /auth/refresh с его cookie → 401, сессия удалена; тест: ADMIN→USER → access-токен после refresh содержит role=USER.

## I-002-d — OAuth-логин не проверяет user.status: BANNED пользователь входит через провайдера

- severity: high
- verdict: FIX
- current: В `handleLoginCallback` для существующей идентичности (возвратившийся пользователь, `auth.ts:1034-1042`) и для email-matched (`auth.ts:1051-1052`) нет проверки `targetUser.status` — сессия выдаётся (`auth.ts:1086-1108`) безусловно. Локальный логин такую проверку делает (`auth.ts:267-272`), linking тоже не проверяет (`auth.ts:958-995`). Итог: забаненный (в т.ч. suspended через модерацию) пользователь с привязанным Google/VK/Discord продолжает логиниться и получать валидные 7-дневные сессии.
- change: В `handleLoginCallback` после резолва `targetUser`: `status !== "ACTIVE"` → 403 `ACCOUNT_DISABLED` (унифицировать с `auth.ts:267-272`), без создания сессии и без апдейта токенов. В linking-режиме — тот же guard до `Account.create`.
- reason: Обход блокировки аккаунта — прямой security-дефект I-001 («disabled-provider поведение» здесь не при чём — это disabled-ACCOUNT поведение).
- risk: Тесты OAuth-логина с не-ACTIVE фиксчурами; e2e (если банят тестового пользователя между шагами).
- verification: Интеграционный тест: user.status=BANNED → POST /auth/telegram/callback / GET /auth/google/callback → 403, Session не создана.

## I-003-a — Identity-linking: уникальный констрейнт защищает от duplicate identity / cross-account binding, гонка даёт сырой 500

- severity: low
- verdict: KEEP (констрейнт) + FIX (UX гонки)
- current: Инвариант держит БД: `Account @@unique([provider, providerAccountId])` (`prisma/contract.prisma:106`). Linking конфликт с чужой идентичностью обрабатывается явно → redirect `identity_conflict` (`auth.ts:965-984`, тест `identity-link.test.ts:245`); idempotent re-link (`auth.ts:980-984`). Но check-then-create не атомарен (`auth.ts:965-990`): параллельный link одной идентичности к двум аккаунтам — оба проходят SELECT, один INSERT падает по unique → внешний catch отвечает JSON 500 «Authentication failed» (`auth.ts:928-931`) вместо браузерного редиректа с ошибкой (контракт §63 — `auth.ts:945-950`). Аналогично login-режим: параллельные первые логины одной идентичности → один падает 500 на User.email unique (`auth.ts:1059-1083`). Account takeover невозможен: link всегда от аутентифицированного пользователя, конфликт владельца проверен, а email-matching только для verified (`auth.ts:1044-1052`).
- change: В `handleLinkingCallback`/`handleLoginCallback` ловить unique-violation (`isUniqueViolation` из `lib/dbErrors.ts`) и переводить в браузерный редирект `linked=0&error=identity_conflict` / повторный lookup аккаунта.
- reason: Конкурентность реальна (двойной клик, повторный callback провайдера); ответ должен оставаться в контрактном UX-канале.
- risk: Нет — только ветка обработки ошибки.
- verification: Тест с параллельным link одной (provider, providerAccountId) к двум пользователям → один 200-redirect, один redirect с identity_conflict, в БД один Account.

## I-003-b — Unlink: TOCTOU позволяет passwordless-аккаунту остаться без методов входа

- severity: low
- verdict: FIX
- current: DELETE /auth/identities/:id проверяет владение (`auth.ts:671-676`) и «не отзывать единственный метод» подсчётом всех Account (`auth.ts:679-683`), затем DELETE (`auth.ts:685`). Два параллельных unlink последних двух идентичностей оба проходят проверку (видят count=2) → 0 идентичностей у passwordless-пользователя (вход невозможен; живёт только текущий refresh-cookie до 7 дней). С существующим passwordHash это не блокировка (пароль остаётся) — но проверка `allAccounts.length <= 1` вообще не учитывает `passwordHash`.
- change: Условное удаление: удалять только если `(счётчик Account у userId) > 1 OR user.passwordHash != null` — атомарно через транзакцию/conditional delete c повторной проверкой; тест на параллельный unlink.
- reason: «Always keep at least one login method» (`auth.ts:678`) — заявленный инвариант, гонка его ломает.
- risk: Никакого; семантика ответов не меняется.
- verification: Параллельные DELETE двух последних идентичностей passwordless-пользователя → ровно один 200, один 409.

## I-004-a — OAuth-токены at rest: AES-256-GCM на записи, startup-sweep legacy plaintext, расшифровки нет вовсе

- severity: low
- verdict: KEEP (шифрование) + SIMPLIFY (мёртвый decrypt-путь)
- current: Запись: все provider-токены прогоняются через `encryptProviderToken` при логине/linking (`auth.ts:1017-1025`, `auth.ts:1078-1083`) — AES-256-GCM, формат `v1:iv:tag:ct` (`lib/tokenCrypto.ts:39-48`); Telegram хранит null (`auth.ts:790-791`, `telegram.ts:122`). Требование ключа в production при сконфигурированном провайдере — fail-closed на старте (`lib/startupValidation.ts:73-87`). Legacy plaintext: идемпотентный sweep при старте (`index.ts:37-47` → `tokenCrypto.ts:78-102`), зашифровываются accessToken/refreshToken/idToken без v1-префикса; чтение терпимо к legacy (`tokenCrypto.ts:51-53`). Токены НИКОГДА не отдаются клиенту (GET /auth/identities отдаёт id/provider/providerAccountId, `auth.ts:650-666`), `decryptProviderToken` и `refreshToken?` провайдеров не используются никем (grep: единственные ссылки — сам tokenCrypto.ts; свип — index.ts:7,39): read-пути к токенам в системе нет.
- change: SIMPLIFY/DEFER: либо удалить хранение токенов (столбцы Account.* и поля `accountTokenFields`) — они никогда не читаются; либо оставить как есть с пометкой «reserve for provider-API features». Отдельно: sweep читает ВСЕ Account (`tokenCrypto.ts:84`) без пагинации — при росте таблицы заменить на батчи.
- reason: Хранение расшифровываемых секретов, у которых нет read-пути, — чистая attack-surface без функции.
- risk: Удаление столбцов — миграция; проверять, что ни один импорт не использует Account.accessToken (grep уже это подтверждает).
- verification: Инспекция БД: все непустые Account.accessToken/refreshToken/idToken начинаются с `v1:`; `SELECT count(*) WHERE left(accessToken,3)<>'v1'` = 0 после sweep.

## J-001-a — Каркас прав: каталог + requirePermission применён по всему adminPlatform/finance/leak

- severity: low
- verdict: KEEP
- current: Типизированный каталог 28 разрешений + бандлы ролей (`lib/permissions.ts:63-308`), guard `requirePermission` (401/403, `permissions.ts:351-364`). adminPlatform: все 12 роутов прикрыты — users.view (206,302,416,843,1235), users.suspend (549,635), roles.manage (705), roles.view (804,828), audit.view (1127), logs.view (1183) — после `authenticate`, с `standardRateLimit`. adminFinance: finance.view (110,154,231,294), finance.payout (185). leak-роуты: router-level `requirePermission("system.manage")` (`routes/leak.ts:29`). SUPERADMIN/ADMIN держат всё, FINANCE/SUPPORT/MODERATOR — точные бандлы (`permissions.ts:263-308`).
- change: Без изменений.
- reason: J-001 на «новой» платформенной части закрыт полностью.
- risk: —
- verification: grep `requirePermission(` в routes/ (см. выше); негативный тест FINANCE → PATCH /admin/users/:id/role → 403.

## J-001-b — Три копии adminOnly + requireRole("ADMIN") + inline-гуары: матрица прав не соблюдена

- severity: medium
- verdict: MERGE
- current: Три локальных копии `adminOnly` (ADMIN|MODERATOR): `routes/admin.ts:30-38`, `routes/adminCommunity.ts:15-...`, `routes/adminContent.ts:18-...` — все роуты admin.ts (11: `admin.ts:39-724`), adminCommunity.ts:29-424, adminContent.ts:27-175 прикрыты ими, НО это role-check, а не permission-check: SUPPORT (бандл содержит reports.resolve/community.moderate/users.suspend, `permissions.ts:276-286`) не имеет доступа к `/admin/reports/:id/resolve` (`adminCommunity.ts:266-274`) и `/admin/users/:id/status`; FINANCE (finance.refund) — к `/payments/refunds` (`routes/payments.ts:798` requireRole("ADMIN")). Обратная сторона: `requireRole("ADMIN")` — точное равенство (`lib/auth.ts:31-44`), поэтому **SUPERADMIN получает 403** на: POST /payments/refunds (`payments.ts:798`), GET /payments/:id/refunds (`payments.ts:921`), POST /disputes/:id/transition и GET /disputes/admin/all (`routes/disputes.ts:258,370`), GET /seller/list и POST /seller/:userId/{approve,reject} (`routes/seller.ts:164,180,217`). Inline-гуары ADMIN/SUPERADMIN в adminAdvertising/adminPremium функционально корректны (соответствуют «advertising.manage/premium.manage: ADMIN+SUPERADMIN only»), но обходят каталог и содержат TODO(permission-engine) (`routes/adminAdvertising.ts:33-39`, `routes/adminPremium.ts:35-41`).
- change: Заменить все `requireRole("ADMIN")` на `requirePermission(<catalog-key>)`: payments refunds → finance.refund, disputes → disputes.resolve, seller-модерация → users.manage (или новый sellers.moderate); adminOnly-копии — на соответствующие requirePermission (community.moderate, content.moderate, reports.resolve, users.suspend); inline-гуары adminAdvertising/adminPremium — на requirePermission("advertising.manage"/"premium.manage"). Удалить `requireRole` либо переопределить как «роль ∈ иерархии».
- reason: Единая матрица (J-001) сейчас расходится с реальными guard'ами в обе стороны: есть и недопуск легитимных ролей (SUPERADMIN/FINANCE/SUPPORT), и допуск без сверки с каталогом.
- risk: Негативные тесты, фиксирующие 403 для MODERATOR на finance-эндпоинтах, должны продолжать проходить; аккуратно с users.suspend у SUPPORT (бандл разрешает — эндпоинт раньше не пускал: это исправление, не регрессия).
- verification: Матричный тест: для каждой роли × каждого privileged-эндпоинта сверять 403/200 с ROLE_PERMISSIONS; SUPERADMIN проходит все эндпоинты.

## J-002-a — Frontend-авторизация независима: сервер везде enforced, UI только скрывает

- severity: low
- verdict: KEEP
- current: Все admin-роуты серверно прикрыты (см. J-001-a/J-001-b) — прямые HTTP-запросы без роли дают 401/403 независимо от UI. Frontend: токен в памяти (zustand, ничего в localStorage — `site/web/src/store/auth.ts:1-10`), refresh — HttpOnly cookie (`site/web/src/lib/api.ts:6-24`); админ-UI гейтится по role на клиенте (`site/web/src/app/admin/page.tsx:63`) — это именно UI-hidden. Сервер никогда не доверяет клиенту: ownership-проверки в seller/resource-роутах дублируются на каждый эндпоинт (`routes/resources.ts:52,76,115,154,202,259,692,855,918`; `routes/versions.ts:103,267`; серверные роли через `loadRole` в `routes/servers.ts:67,301-305`).
- change: Низкоприоритетный FIX: клиентский гейт `page.tsx:63` не знает roles SUPERADMIN/SUPPORT/FINANCE — SUPERADMIN выкидывается с /admin UI, хотя API ему разрешает (перекликается с J-001-b); расширить список ролей.
- reason: Дырки «UI-скрытие как источник правды» не найдено; найдено обратное — UI строже API.
- risk: —
- verification: curl с токеном SUPPORT на /admin/reports → до/после merge-фикса сверить с матрицей.

## J-003-a — Эскалация ролей: self-change, last-SUPERADMIN, confirm-gate, CAS — но гонка на «последних двух»

- severity: low
- verdict: KEEP + FIX (TOCTOU)
- current: PATCH /admin/users/:id/role (`routes/adminPlatform.ts:702-795`): self-change запрещён (`:724-728`); demote последнего SUPERADMIN запрещён подсчётом прочих (`:729-741`); выдача ADMIN/SUPERADMIN требует `confirm=true` (`:742-748`); CAS на предыдущей роли (`:750-757`); audit + SystemLog + notification (`:759-785`). Сuspend SUPERADMIN — только SUPERADMIN-актором или ADMIN+confirm (`adminPlatform.ts:568-578`). Проблема: guard last-SUPERADMIN — check-then-update вне транзакции; два конкурентных demote ДВУХ последних суперадминов оба видят `others.length === 1` и оба проходят (CAS защищает только ту же строку) → 0 SUPERADMIN.
- change: Считать и апдейтить в одной транзакции с блокировкой строк SUPERADMIN (`SELECT ... FOR UPDATE`/`withKeyLock("roles", ...)` — для single-container достаточно `lib/keyLock.ts`), либо conditional update «role=X WHERE EXISTS(другой SUPERADMIN)».
- reason: Инвариант «существует ≥1 SUPERADMIN» должен держаться под конкурентностью, а не только в happy-path.
- risk: Минимальный; сериализация роли не влияет на прочие потоки.
- verification: Тест: параллельные PATCH demote двух последних SUPERADMIN → один 200, один 409.

## J-003-b — Легаси PATCH /admin/users/:id/role — мёртвый обходной путь (shadow-mount)

- severity: low
- verdict: REMOVE
- current: `routes/admin.ts:483-531` содержит смену роли без self-guard, без last-SUPERADMIN-guard, без confirm и без audit (role из allowlist USER/ADMIN/MODERATOR). Маршрут недостижим: adminPlatform смонтирован раньше (`app.ts:203-210`) и перехватывает PATCH /admin/users/:id/role (`adminPlatform.ts:702`). Но корректность зависит НЕЯВНО от порядка монтирования — при реорганизации app.ts это готовый bypass.
- change: Удалить хэндлер admin.ts:483-531 (и его комментарий-дубль), либо защитить так же, как §41.
- reason: Мёртвый код, дублирующий защищённую поверхность с менее защищённой семантикой.
- risk: Никакого: путь уже перехватывается.
- verification: PATCH /admin/users/:id/role — 403-матрица как у adminPlatform; grep — второй хэндлер удалён.

## J-003-c — Легаси PATCH /admin/users/:id/status — обходной duplicate без audit, без защиты SUPERADMIN и без отзыва сессий

- severity: high
- verdict: REMOVE (переход на adminPlatform suspend/restore)
- current: `routes/admin.ts:432-481` — живой (не shadowed: adminPlatform имеет только /suspend и /restore) эндпоинт PATCH /admin/users/:id/status с гардом `adminOnly` (ADMIN|MODERATOR). Дефекты: (1) защита цели `user.role === "ADMIN"` (`admin.ts:464`) не покрывает SUPERADMIN — MODERATOR может поставить BANNED суперпадминистратору; (2) ни одного `recordAudit` (в admin.ts audit только у moderation.transition, `admin.ts:171`); (3) сессии не отзываются (в отличие от `adminPlatform.ts:589-591`); (4) нет self-guard (MODERATOR может забанить MODERATOR'a); (5) нет confirm для привилегированных целей. В сочетании с I-002-c (refresh не проверяет статус) забаненный этим роутом пользователь сохраняет полный доступ до слайдинг-истечения сессии.
- change: Удалить эндпоинт; при необходимости совместимости — проксировать на suspend/restore-семантику (guard §41 + Session.delete + recordAudit + notification), как в `adminPlatform.ts:546-700`.
- reason: Дубликат с более слабой моделью угроз; нарушение J-003 (нет защиты SUPERADMIN) и J-004 (нет audit).
- risk: Если фронтенд ещё вызывает PATCH /admin/users/:id/status — перевести его на POST /admin/users/:id/suspend (grep по site/web/src перед удалением).
- verification: MODERATOR: PATCH /admin/users/:id/status на SUPERADMIN → 404/405 после удаления; все баны проходят через suspend с audit-записью `user.suspend`.

## J-004-a — Audit-покрытие привилегированных действий: новая платформа полная, легаси-роутер с дырами

- severity: medium
- verdict: FIX (легаси) + KEEP (платформа)
- current: Полное покрытие: roles (`adminPlatform.ts:759-768` — user.role.change), suspend/restore (`adminPlatform.ts:593-602`, `663-672`), seller approve/reject (`routes/seller.ts:196-204`, `239-247`), advertising CRUD+transition (4 вызова `adminAdvertising.ts:195,267,376,429`), premium grant/revoke (`lib/entitlements.ts:104-120`, `158-172`), payouts (`lib/payouts.ts:154-165`, `373-380`), refunds (`lib/refunds.ts:358-365`), community/content-модерация (по одному на каждую мутацию: `adminCommunity.ts:135,202,292,345,395,453`; `adminContent.ts:73,146,201`), leak-cases (`routes/leak.ts`), ресурсы (`admin.ts:171-179`). Дырки в легаси `routes/admin.ts`: DELETE /admin/reviews/:id (`admin.ts:534-559`) — удаление отзыва без audit; POST /admin/versions/:id/yank (`admin.ts:691-718`) — security-релевантное действие (блокирует выдачу лицензий) только в reqLog, нет AuditLog; POST /admin/versions/:id/verify (`admin.ts:641-688`) — нет AuditLog (частично компенсируется `CompatibilityReport.verifiedBy`, `admin.ts:669`); PATCH /admin/users/:id/status — см. J-003-c. Конфигурация: runtime-мутаций фичефлагов нет (GET /config/features read-only, `routes/config.ts:11-21`) — audit-поверхности не создаёт. `recordAudit` никогда не бросает (`lib/audit.ts:29-55`), но при недоступности БД запись теряется с error-логом — приемлемо.
- change: Добавить `recordAudit` в три легаси-хэндлера (reviews.delete, version.yank, version.verify) с actorId/req.ip/req.id; либо закрыть легаси-роутер и перевести действия на платформенные роуты.
- reason: J-004 требует полноты: действия moderation/security-класса (yank) обязаны оставлять who-did-what-to-whom.
- risk: Нет — добавочный insert, формат записей уже стандартизирован.
- verification: Для каждого мутационного admin-эндпоинта — integration-тест «после 200-ответа в AuditLog есть запись с action/targetId/actorId»; grep `recordAudit` в admin.ts ≥ 4.

## Q-001-a — Security headers: сервер + nginx, согласованы

- severity: low
- verdict: KEEP
- current: API: X-Content-Type-Options/X-Frame-Options DENY/Referrer-Policy strict-origin-when-cross-origin/X-Permitted-Cross-Domain-Policies/CSP `default-src 'none'; frame-ancestors 'none'; form-action 'self'` на каждый ответ (`middleware/observability.ts:11-24`); HSTS — только NODE_ENV=production (`observability.ts:21-24`). Edge: полный набор на 443 — HSTS 1y+includeSubDomains (без preload до подтверждения домена), строгий CSP фронтенда, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy (`infrastructure/nginx/nginx.conf:86-100`); в `/media/` и `/_next/static/` заголовки повторно объявлены локально (компенсация отключения наследования add_header, `nginx.conf:156-160,184-186`). next.config заголовков не задаёт (`site/web/next.config.ts` — только rewrites) — CSP отдаёт nginx, это заявленная топология (закомментировано в nginx.conf:91-95).
- change: Без изменений. (Опционально: HSTS-заголовок API в dev не нужен — уже так.)
- reason: Все пять пунктов Q-001 закрыты на обоих слоях без конфликтов.
- risk: —
- verification: `curl -I https://<host>/` и `/api/health` — сверить наличие всех заголовков; `tests/integration/api/platform/app-security.test.ts` (существующие проверки).

## Q-002-a — CORS: точные origins, wildcard запрещён структурно

- severity: low
- verdict: KEEP
- current: `cors({ origin(origin, cb) { allow если !origin || origin в allowlist }, credentials: true })` — ни `*`, ни echo-origin (`app.ts:86-136`). Allowlist из `CORS_ORIGINS` (split по запятой, `app.ts:86-91`). По окружениям: production/staging `corsOrigins: []` — same-origin за nginx (`config/environments/production.yaml:9`, `staging.yaml:8`); startup.py при пустом списке подставляет `[frontend_url]` (не wildcard: `startup.py:386,402`); development `[http://localhost:3000]` (`config/environments/development.yaml:11`). Wildcard в production-компоузе отсутствует (`infrastructure/docker/compose/production.yml:67` — `${CORS_ORIGINS:-}`). credentials:true допустим, т.к. wildcard запрещён кодом (пустая строка → ни один браузерный origin не пройдёт).
- change: Без изменений.
- reason: Q-002 закрыт: ни одного wildcard-производства; non-browser клиенты (webhooks, curl) работают через ветку `!origin`.
- risk: —
- verification: Существующие тесты `tests/integration/api/platform/app-security.test.ts:84-129`; добавить кейс «origin: https://evil.example → ответ без Access-Control-Allow-Origin».

## Q-003-a — CSRF: cookie-модель согласована, токен не нужен

- severity: low
- verdict: KEEP
- current: Все state-changing API требуют `Authorization: Bearer` (`lib/auth.ts:11-29`) — заголовок недоступен кросс-сайтовому атакующему. Cookie-авторизованные эндпоинты только /auth/refresh и /auth/logout (read-no-effect / собственная сессия, `auth.ts:298,403`). Refresh-cookie: HttpOnly, SameSite=lax по умолчанию (prod), Secure в production и при `none` (`lib/cookies.ts:29-43`; prod-значение `production.yml:68` `COOKIE_SAMESITE=lax`, dev cross-origin — `none` по документации `cookies.ts:13-21`). SameSite=lax блокирует кросс-сайтовую отправку cookie в POST; OAuth-callbacks защищены state-cookie (`auth.ts:896-905`). Ссылка SameSite=None только в dev-топологии (cross-origin :3000→:3001) — там CORS-allowlist ограничивает чтение.
- change: Без изменений. Опционально (DEFER): Origin/Referer-check на /auth/refresh для глубокой обороны.
- reason: Классический CSRF-вектор (cookie-авторизованный мутатор) в системе отсутствует.
- risk: —
- verification: Тест: кросс-сайтовый POST /auth/refresh (Origin: evil) с SameSite=lax — браузер не отправит cookie (ручная проверка в браузере).

## Q-003-b — oauth_state/link_user cookies без Secure; link_user несёт access-JWT

- severity: medium
- verdict: FIX
- current: `OAUTH_COOKIE_ATTRS = { httpOnly, sameSite: "lax", path, maxAge }` — атрибут `secure` отсутствует (`auth.ts:35-44`), в отличие от centralized-политики refresh-cookie (`lib/cookies.ts:34`), и dev-комментарий app.ts про `COOKIE_SAMESITE=none` не распространяется на эти cookie. При этом `LINK_USER_COOKIE` хранит ПОЛНЫЙ access-JWT (`auth.ts:746-750`, `auth.ts:827`, потребляется в `auth.ts:921-925` и `auth.ts:785-789` для telegram): bearer-токен в cookie без Secure передаётся и по http.
- change: Добавить `secure: process.env.NODE_ENV === "production"` (или переиспользовать `getRefreshCookieAttributes()`-логику) в OAUTH_COOKIE_ATTRS; в идеале — заменить access-JWT в link_user на короткий nonce, связанный с сессией в Redis/памяти.
- reason: Единая cookie-политика нарушена для auth-связанных cookie; утечка access-токена через http-редиректы/логи прокси становится возможной при mixed-content развертывании.
- risk: При включении secure убедиться, что dev-e2e по http://localhost продолжает работать (браузеры трактуют localhost как trustworthy — так же как в `cookies.ts:19-20`).
- verification: Интеграционный тест: set-cookie в production-режиме содержит `Secure`; grep: LINK_USER_COOKIE больше не содержит `generateAccessToken` (после nonce-рефакторинга).

## Q-004-a — Rate limits: классы разделены, fail-closed на security-critical

- severity: low
- verdict: KEEP
- current: Три класса с разными bucket'ами и окнами: auth 300/15мин IP (login/register/refresh/logout/identities/password; `lib/rateLimit.ts:83-88`, применён в `auth.ts:159,235,298,403,565,725,801,838,882`), standard 300/мин (`app.ts:138` глобально + admin-роуты), strict 10/мин fail-closed для DRM/upload (`rateLimit.ts:66-71`). Per-user action-бакеты: login 10/мин (`auth.ts:235`), refresh 30/мин (`auth.ts:298`). Redis-outage: auth/strict/per-account fail-closed (503), bulk fail-open (`rateLimit.ts:22-58`, `rateLimit.ts:90-135`); тестовая среда отключает per-user limiter явно (`rateLimit.ts:107-110`), значения по окружениям — `config/application/limits.yaml:7-27`, prod-дефолты pinned в compose (`production.yml:55-59`). nginx добавляет edge-зоны api 10r/s и auth 5r/s (`nginx.conf:29-30,114,132`). Пробелы — в отдельных находках: webhooks без лимита (Q-005-a), password-change только IP (I-001-c-родственный, LOW).
- change: Без изменений; следить, чтобы новые sensitive-роуты подключали отдельный bucket, а не global.
- reason: Требование «не один глобальный лимитер» выполнено архитектурно.
- risk: —
- verification: интеграционно: 11-й логин за минуту → 429; Redis-stop → /auth/login 503 (fail-closed), GET /resources проходит (fail-open).

## Q-005-a — Body limits: JSON 10MB глобально; webhooks без лимита и без rate-limit

- severity: medium
- verdict: FIX
- current: Глобальный `express.json({ limit: "10mb" })` c rawBody-stash для HMAC (`app.ts:106-113`). Мультers: media/avatar/screenshot 5MB с magic-byte сниффингом (`lib/media.ts:20`, `routes/upload.ts:33`, `upload.ts:24-34`), resource-архив 100MB (`.lua/.zip/.rar/.7z/...` filter, `lib/upload.ts:27-50`); nginx `client_max_body_size 100M` (`nginx.conf:103`) согласован. Webhook-роуты POST /payments/webhook и /payments/webhook/:provider (`routes/payments.ts:711-729`) не имеют ни rate-limiter, ни отдельного body-cap: до проверки подписи/IP (`payments.ts:341-361`) каждый запрос проходит полный JSON-parse 10MB; транспортная аутентификация провайдеров (YooKassa IP+basic, TBank HMAC, Crypto HMAC) закрывает фальсификацию, но не DoS-парсинг.
- change: На webhook-роуты поставить `strictRateLimit`-класс (или отдельный webhook-bucket 60/мин) и уменьшить cap тела: смонтировать `express.json({limit:"256kb"})` для /payments/webhook* до глобального парсера, либо per-router middleware с собственным лимитом.
- reason: Нелимитированный парсинг 10MB JSON на публичном неаутентифицированном эндпоинте — дешёвый amplification-DoS.
- risk: Проверить максимальный реальный размер webhook-пейлоадов провайдеров (YooKassa/TBank — единицы KB); 256KB с запасом.
- verification: Тест: POST /payments/webhook/yukassa телом 1MB → 413/429 без попытки верификации; легитимный webhook проходит.

## Q-006-a — Секреты: source/CI/env чистые; логгер редактирует чувствительные ключи

- severity: low
- verdict: KEEP
- current: Grep `sk_live|ghp_|AKIA|BEGIN.*PRIVATE KEY` и `password|secret|api_key`-паттернов по site/server/src, scripts/, .github/, module/ — реальных ключей нет; ключи только из env (`lib/artifact/signing.ts:27`, DRM — `lib/drm/service.ts:464`). `.env.example` — только плейсхолдеры (root:17 `your-secret-key-...`, server-версия с пустыми значениями `site/server/.env.example`); локальный `site/server/.env` с dev-секретами git-ignored (git check-ignore подтверждён, `git ls-files site/server/.env` пуст). Логи: `logs/*` содержит только .gitkeep; logger редактирует `access_token|refresh_token|password|secret|authorization|private_key|cookie|bearer` по ключам с глубиной 6 (`lib/logger.ts:22-46`); audit-снапшоты пишутся осознанно (`lib/audit.ts:19-26`), токены в audit не передаются. CI использует только GITHUB_TOKEN (`.github/workflows/ci.yml:83`, `release.yml:40`, `security.yml:22`), echo секретов нет; webhook-подписи считаются по rawBody (`payments.ts:372-375`), секреты провайдеров — только env (`lib/providers/payment-*.ts`). OAuth client secrets нигде не логируются: ошибки token-exchange логируются через redact-логгер (`auth.ts:930`, `logger.ts:29-31` — Error → name/message/stack).
- change: Без изменений. Мелочь (DEFER): root `.env.example:17` содержит подсказку-значение `JWT_SECRET=your-secret-key-min-32-chars-change-in-production` — заменить на пустое значение как в `site/server/.env.example`, чтобы не соблазнять «рабочим по умолчанию».
- reason: Q-006 по всем шести классам (password/token/private key/payment secret/OAuth credential/DRM key) чист; единственный риск — человеческий фактор с placeholder-значением.
- risk: —
- verification: Повторный grep-скрипт в CI (secrets-скан); `git log --diff-filter=A -- .env *.pem` пуст.

## Q-006-b — Telegram replay-guard в памяти процесса (мульти-instance/рестарт открывает окно)

- severity: low
- verdict: FIX (при масштабировании) / DEFER (сейчас single-container)
- current: Replay-кэш телеграм-логинов — module-level `Map` с TTL 24ч и капой 10k (`lib/providers/telegram.ts:20-41,169-183`). При >1 инстансе за балансировщиком один и тот же подписанный payload может аутентифицировать на разных инстансах; рестарт процесса чистит кэш. Деплой-топология сегодня — один backend-контейнер (зафиксировано в `lib/keyLock.ts:1-7`), окно свежести payload 24ч (`telegram.ts:18,109`) делает повтор после рестарта возможным в пределах суток.
- change: Перенести guard в Redis (`SETEX tg-replay:<providerId>:<auth_date>` с TTL 24ч) — Redis уже обязателен для rate-limit (`rateLimit.ts`), либо хранить last-auth_date на Account row.
- reason: Аутентичность подписи сохраняется, но защита от replay теряется при горизонтальном масштабировании/рестарте.
- risk: Добавляется Redis-зависимость в auth-путь — уже существует для login-limiter'а (fail-closed).
- verification: Тест: два логина одним payload на «двух» процессах → второй отклонён.

## I-001-f — Матрица аутентификации (сводная таблица, доказательства)

- severity: low
- verdict: KEEP
- current: 
  | Провайдер | isEnabled | Login | Linking | Unlink | Disabled-поведение | Email/verified |
  |---|---|---|---|---|---|---|
  | password | всегда | auth.ts:235-295 (status-check :267) | — | — | — | email unique |
  | Google | google.ts:44-46 | auth.ts:836-933 | auth.ts:722-757, 801-834, 936-995 | auth.ts:669-697 | 404 :842-845/:886-889/:729-732 | email_verified (google.ts:127) |
  | Yandex | yandex.ts:44-46 | там же | там же | там же | там же | всегда verified:false → синтетический `.local` (yandex.ts:121-126) |
  | VK | vk.ts:53-55 | там же | там же | там же | там же | email_verified (vk.ts:150), без PKCE (vk.ts:85-98) |
  | Telegram | telegram.ts:146-148 | POST auth.ts:766-798 (HMAC+freshness+replay, telegram.ts:49-183) | через LINK_USER_COOKIE (auth.ts:785-791) | там же | 404 :771-774 | нет email, verified:false (telegram.ts:121-126) |
  Discovery: GET /auth/providers — только enabled, без конфигов (auth.ts:704-715).
- change: Без изменений; дефекты вынесены в I-002-c/d, I-003-a/b, Q-003-b.
- reason: Матрица полная, «disabled provider» последовательно 404 на всех 5 поверхностях, синтетический `.local`-email (auth.ts:63-66,1056) не даёт таким аккаунтам участвовать в email-matching.
- risk: —
- verification: `tests/integration/api/auth/providers-discovery.test.ts`, `identity-providers.test.ts`, `identity-link.test.ts`.

## I-002-e — Сессии: выдача/ротация хранит только SHA-256, cookie-политика едина

- severity: low
- verdict: KEEP
- current: Refresh-токен в БД только хэшем (`auth.ts:121-131`, `auth.ts:1095-1102`); cookie HttpOnly+Secure(prod)+Lax, maxAge 7d синхронизирован с JWT_REFRESH_EXPIRY (`lib/cookies.ts:6-48`); access-токен не кладётся в cookie — фронт обменивает refresh-cookie на access через /auth/refresh и держит в памяти (`auth.ts:1104-1108`, `site/web/src/app/auth/callback/page.tsx:19-30`, `store/auth.ts:1-10`). Список сессий никогда не отдаёт токен-материал (`auth.ts:453-462`).
- change: Без изменений.
- reason: Требования A-001/D-006 плана выполнены; устройство листинга совпадает с SessionsCard.
- risk: —
- verification: grep: refresh_token появляется в `res.cookie` только через `setRefreshCookie`; фронтовых localStorage-хранилищ токенов нет (grep по site/web/src).

## J-001-c — Ownership в seller/resource-роутах: проверено на каждом мутационном эндпоинте

- severity: low
- verdict: KEEP
- current: Ресурсы: обновление/удаление/медиа/версии — `resource.sellerId !== req.user!.userId → 403` (`resources.ts:52,76,115,154,202,259,692,855,918`; дублирующая проверка 918-926 — мусор, см. ниже), создание — через `canCreateListings` (APPROVED SellerProfile, `resources.ts:809`, `lib/permissions.ts:33-39`); версии (`versions.ts:103,267`), seller-профиль только свой (`seller.ts:20,111,138`), выплаты — по балансу продавца (`sellerPayouts.ts` через `lib/payouts.ts` с userId-скоупом), сделки — `dealRole(room, userId)` (`routes/deals.ts:56,133,141,198,233`), серверы — owner/member-роли (`servers.ts:301-305,417,453,507`). Дублирование проверки владения в DELETE /resources/:slug (`resources.ts:918-926`) — мёртвый повтор.
- change: SIMPLIFY: удалить повтор resources.ts:923-926.
- reason: Гэпов в ownership не найдено; дубль — шум для читателя.
- risk: —
- verification: grep-инвентаризация всех `sellerId !==|ownerId !==|dealRole` в мутациях; негативный тест «чужой ресурс → 403».

## Сводная статистика

Итого 30 находок: **high 3, medium 5, low 22**; по вердиктам — KEEP 13 + комбинированных KEEP 4, FIX 8, MERGE 1, REMOVE 2, DEFER 1 (плюс 2 условных FIX/DEFER-гибрида).

| Severity | Находки |
|---|---|
| high (3) | I-002-c (refresh не перепроверяет status/role), I-002-d (OAuth-логин без status-check), J-003-c (легаси /admin/users/:id/status: без audit, SUPERADMIN не защищён, сессии не отзываются) |
| medium (5) | I-002-b (гонка ротации/reuse), J-001-b (adminOnly/requireRole ≠ матрице прав; SUPERADMIN получает 403), J-004-a (audit-дыры легаси admin.ts), Q-003-b (oauth-cookies без Secure, access-JWT в link_user), Q-005-a (webhooks: нет rate-limit/body-cap) |
| low (22) | I-001-a..f, I-002-a, I-002-e, I-003-a, I-003-b, I-004-a, J-001-c, J-002-a, J-003-a, J-003-b, Q-001-a, Q-002-a, Q-003-a, Q-004-a, Q-006-a, Q-006-b |

Критических нет; три high объединены одной причиной: **status/role аккаунта не является источником истины** для refresh-сессий (I-002-c), OAuth-входа (I-002-d) и легаси-роута бана (J-003-c). Их совместный FIX закрывает обход бана полностью.