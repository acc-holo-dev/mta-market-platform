# MTA Market — PLAN-016 Execution Prompt

## Role

You are implementing **PLAN-016 — Identity Expansion, Multi-Provider Payments & Platform Debt Closure**.

Repository:

```text
acc-holo-dev/mta-market-platform
```

Current project is in a technically mature state (PLAN-014/PLAN-015 выполнены,
E2E 59/59, unit 392/392). Do NOT assume the repository is empty, broken, or
needs a rewrite.

Your task is to:

1. **Расширить вход** — несколько способов входа: Telegram, Google, VK
   (Yandex уже реализован на бэкенде, но скрыт), плюс discovery/identity-UI;
2. **Расширить приём платежей** — не только ЮKassa: криптовалюта и второй
   фиат-провайдер «как ЮKassa» на нейтральном реестре провайдеров;
3. **Закрыть задокументированный долг** — баги, недоделки и process-debt,
   накопленные записями PLAN-001…015 (полный список ниже, каждый пункт с
   источником в документации).

Do not treat this plan as a licence to rewrite working domains. Backend
changes only where the new functionality requires them, following the
INSPECT → MAP → VERIFY → REUSE → DESIGN → IMPLEMENT → TEST → DOCUMENT cycle.

---

# 0. NON-NEGOTIABLE RULES

Do not start by changing code.

First:

```text
INSPECT
→ MAP
→ VERIFY
→ REUSE
→ DESIGN
→ IMPLEMENT
→ TEST
→ DOCUMENT
```

Hard constraints (нарушение = провал плана):

1. **Деньги**: webhook-only completion в production; провайдеру всегда уходит
   FINAL total из иммутабельного снапшота OrderItem (INV-004, A-011); никогда
   не доверять телу вебхука — только re-fetch (`getPayment`) + сверка
   суммы/валюты/привязки (D-004, SECURITY.md §Платёжный webhook).
2. **Exactly-once** поверх существующих механизмов (не обходя их):
   `IdempotencyRecord`, CAS-переходы через `updateAndCount`, partial unique
   captured-payment, `PaymentProviderEvent @@unique([provider, providerEventId,
   eventType])`, ledger unique `[transactionId, accountId, direction]`
   (PLAN-012 §6).
3. **Деньги — целые копейки RUB** (DATA.md): мультивалютность в план не
   входит; крипто-инвойсы фиксируются в RUB-эквиваленте на стороне
   провайдера («fiat-locked»), иначе план считается проваленным.
4. **Никаких fake data**: провайдер недоступен без env → endpoint честно
   отвечает 404/отключён; discovery отдаёт только реально сконфигурированных
   провайдеров; simulate не должен попасть в production (компилируется
   только при `NODE_ENV !== "production"`).
5. **Ничего не ломаем**: тексты/роли E2E-селекторов (tests/e2e, 59/59) и
   доменную логику (servers, reviews, disputes, ledger) сохраняем; расширения
   контрактов — аддитивные.
6. Не помечать ничего выполненным без прогона тестов и браузерной проверки.

---

# 1. Read the Product Context First

Before implementation, inspect and understand:

```text
documents/api/AUTH.md               — OAuth-реестр, identity-модель, состояние
documents/api/COMMERCE.md           — checkout/payments/refunds/ledger/скидки
documents/architecture/SECURITY.md  — webhook-верификация, oauth_state
documents/architecture/DATA.md      — инварианты денег, контрактный ORM
documents/architecture/TESTING.md   — гейты, объёмы, env-ловушки
documents/architecture/DEPENDENCY-POLICY.md — HOLD/DEFER-линии
documents/development/CURRENT.md    — состояние + «Следующий план»
documents/development/NEXT-PHASE.md — циклы решений
documents/development/completed/PLAN-015.md §3/§4 — honesty/ограничения
documents/ideas/MARKETPLACE.md §6   — «несколько платёжных провайдеров
                                      (интерфейс провайдера уже нейтральный)»,
                                      «Пополнение баланса»
documents/ideas/TRUST.md            — будущие trust-домены (не в этом плане)
```

Ключевые понятия, которые нельзя нарушать: Purchase ≠ Payment ≠ License;
settlement `platformFee + sellerRevenue == finalPrice`; INV-013 (рефанд ≤
captured, advisory lock); K-004 (ревокация лицензии только при полном
подтверждённом рефанде); email-матч OAuth только для `verified` провайдеров
(анти-takeover, SECURITY.md); синтетические `.local`-email не дают матч.

---

# 2. Phase A — Audit (обязательный старт)

Перед кодом проверить факты (аудит 2026-09-12 зафиксировал их; перепроверить
по коду):

**Auth (site/server):**
- Реестр `IIdentityProvider` (`src/lib/identityProvider.ts`), side-effect
  саморегистрация в `routes/auth.ts:20-22`; реализованы
  `providers/discord.ts`, `providers/yandex.ts`, `providers/google.ts`.
- Generic-флоу: `GET /auth/:provider` (cookie `oauth_state`, 10 мин) →
  `GET /auth/:provider/callback` (строгая сверка state) → identity-upsert;
  link-режим через cookie `link_user` / `GET /auth/:provider/link`;
  `GET /auth/identities` (токены никогда не отдаются),
  `DELETE /auth/identities/:id` (409 на отвязку последнего метода входа).
- Web: `/auth/callback` провайдер-агностичен; login-страница показывает
  ТОЛЬКО Discord-кнопку; страница `/account/identities` НЕ существует, хотя
  серверный link-callback редиректит на неё (мёртвый redirect → 404);
  вкладка «Подключения» `/account` только читает список, link/unlink
  кнопок нет.
- Env: `YANDEX_*`/`GOOGLE_*` используются кодом, но отсутствуют в
  `.env.example` (site/server и корневой).

**Payments (site/server):**
- `IPaymentProvider` + `PaymentProviderRegistry` (`src/lib/paymentProvider.ts`,
  capabilities: `payment.create | payment.verification | payment.cancel |
  refund.create`); комментарий E-010 прямо называет готовность к
  «T-Bank/Alfa/crypto».
- ЮKassa: `providers/payment-yookassa.ts` + `lib/yookassa.ts` (redirect
  confirmation, Idempotence-Key randomUUID на вызов), webhook-верификация
  через IP-allowlist + Basic auth (`lib/yookassaWebhook.ts`), БЕЗ HMAC.
- Жёсткие хардкоды `"YUKASSA"`: `routes/payments.ts` (create/webhook/cancel/
  simulate, ~7 мест), `jobs/reconciliation.ts:80-114`,
  `tests/tools/helpers/db-reset.ts:74`.
- `POST /payments/webhook` парсит тело под YooKassa-форму; raw-body
  middleware отсутствует (глобальный `express.json`) — HMAC-провайдерам
  нужен per-route raw capture; `verifyWebhook` возвращает только
  reason `"ip" | "auth"`.
- `Payment.provider` — enum `PaymentProvider { YUKASSA, STRIPE, TEST }`
  (contract.prisma:413); новый провайдер = миграция enum.
- simulate (`POST /payments/:id/simulate`) не компилируется в prod
  (app-security.test.ts); `YOOKASSA_ENABLED=false` в тестах.

**Debt (полный список — §9; источник каждого пункта указан там).**

---

# 3. Core Product Direction

> MTA Market принимает платежи так, как удобно сообществу MTA, и входит
> тем способом, которым пользователь реально пользуется — без потери
> транзакционной строгости и без новых денежных инвариантов «на боку».

Визуальный язык, shell, домены — не менять (PLAN-015 только что зафиксировал
систему). Все новые UI-элементы — на токенах DESIGN-SYSTEM, в существующем
AppShell.

---

# 4. Workstream A — Identity Expansion (вход через Telegram / Google / VK)

## A-001. Discovery endpoint

- `GET /auth/providers` (публичный): список enabled-провайдеров
  `{provider, displayName, mode: "redirect" | "direct"}` из реестра
  (`isEnabled()`); без env провайдер в списке отсутствует (не «доступен,
  но сломан»).
- Не раскрывает конфигурацию (никаких redirect_uri наружу).

## A-002. Google — включение

- Код готов (`GoogleProvider`). Нужно: env-документация
  (`GOOGLE_CLIENT_ID/SECRET/REDIRECT_URI`) в обоих `.env.example`, кнопка на
  login-странице, provider-neutral тексты ошибок, сверка
  `contracts/api/authentication.yaml`.

## A-003. Yandex — surfaced

- Провайдер реализован (`yandex.ts`, `verified: false` всегда → синтетический
  email — задокументировано в AUTH.md). Кнопка + env-доки. Не «чинить»
  verified (ограничение Yandex API) — честно документировать.

## A-004. VK ID — новый провайдер

- `src/lib/providers/vk.ts` по образцу `google.ts`: OAuth2 code-flow
  id.vk.com (authorize/token/userinfo), env `VK_CLIENT_ID/SECRET/REDIRECT_URI`,
  side-effect импорт в `routes/auth.ts`.
- Verified-email политика VK — сопоставить по фактическому ответу userinfo;
  при отсутствии флага — синтетический email (правило unchanged).
- State/CSRF, identity-upsert, link-режим, сессии — переиспользуются as-is.

## A-005. Telegram Login Widget — direct-login расширение

- Widget не отдаёт `code`/`state` → интерфейс расширяется: опциональный
  `mode: "direct"` + `verifyDirectLogin(payload) → { user: ProviderUser }`
  (или union-тип `CallbackRequest`), `ProviderTokens` → optional.
- Новый `POST /auth/telegram/callback` (вне generic-роутов): верификация
  data-check-string HMAC-SHA256 с ключом SHA256(bot_token), freshness
  `auth_date` (≤ 24h), rate-limit, replay-защита (запрет повторной
  обработки той же пары id+auth_date — через короткий кэш/уник-запись),
  запись идентичности с nullable-токенами.
- Generic redirect-роуты Telegram не трогают (нет oauth_state-cookie).
- Env `TELEGRAM_BOT_TOKEN` (+ необязательный `TELEGRAM_BOT_NAME` для
  виджета), документация установки виджета на login-страницу.

## A-006. Identity UI (закрыть мёртвый redirect)

- Страница `/account/identities`: список привязок, кнопки «Привязать»
  (link-режим → `GET /auth/:provider/link`), «Отвязать» (DELETE с
  объяснением правила последнего метода входа), отображение `/account/
  identities?linked=1` результата.
- Кнопки link/unlink на вкладке «Подключения» `/account` → ссылки на новую
  страницу; тексты/ARIA стабильны для E2E.

## A-007. Login page: динамические кнопки

- Рендер из `GET /auth/providers` (не хардкод Discord); provider-neutral
  копия ошибок («Не удалось войти через {provider}»); Suspense/SSR — кнопки
  после гидрации; для гостей кнопки Telegram-виджета монтируются
  лениво (скрипт widget не блокирует отрисовку).

## A-008. Смена пароля (аутентифицированная)

- `PATCH /auth/password` (`{currentPassword, newPassword}`): проверка
  текущего пароля (bcrypt), валидация ≥8, инвалидация ВСЕХ сессий кроме
  текущей (tokenFamily — по правилам tokenSecurity), audit.
- UI на `/account` (Профиль). **Reset по email — вне scope** (см. §15).

## A-009. Шифрование OAuth-токенов в покое (PLAN-004 §6)

- `Account.accessToken/refreshToken/idToken` шифруются AES-256-GCM ключом
  `OAUTH_TOKEN_ENCRYPTION_KEY` (32 байта base64); миграция перешифровки
  существующих строк (если есть) идемпотентна; расшифровка только в
  refresh-пути провайдера; ключ обязателен в production при наличии
  OAuth-провайдеров.

## A-009a. Env / validation матрица

- `.env.example` (site/server + корень): `YANDEX_*`, `GOOGLE_*`, `VK_*`,
  `TELEGRAM_BOT_TOKEN/BOT_NAME`, `OAUTH_TOKEN_ENCRYPTION_KEY`.
- `lib/startupValidation.ts`: FATAL только на провайдеров, объявленных
  обязательными владельцем (по умолчанию ни один OAuth не обязателен в
  production — провайдер без env просто отключён); задокументировать.

---

# 5. Workstream P — Multi-Provider Payments

## P-001. Provider-neutral dispatch (вынести хардкоды)

- `POST /payments/create` принимает опциональный `provider`; валидация:
  провайдер есть в реестре, `isEnabled()`, поддерживает `payment.create`.
  Default — env `PAYMENTS_DEFAULT_PROVIDER` (fallback: единственный enabled).
- Снять хардкоды `"YUKASSA"`: `routes/payments.ts` (create/webhook/cancel/
  simulate), `jobs/reconciliation.ts`, `tests/tools/helpers/db-reset.ts`.
- `Payment.provider` — enum расширяется миграцией (`TBANK`, `CRYPTO` —
  имена зафиксировать в плане реализации по фактическому выбору адаптеров).

## P-002. Per-provider webhooks

- `POST /payments/webhook/:provider` — dispatch по реестру; legacy
  `POST /payments/webhook` сохраняется как алиас default-провайдера
  (обратная совместимость настроек ЮKassa).
- Per-provider парсер тела + `verifyWebhook`; reason расширяется:
  `"ip" | "auth" | "signature"`.
- Raw-body capture per-route (`express.raw({ type: 'application/json' })`
  на webhook-маршрутах; payloadHash считать от raw bytes, а не
  ре-сериализации — фикс заодно для YooKassa-лога).
- Общий конвейер неизменен: persist event → verify → re-fetch → сверка
  (amount === finalPrice, currency === RUB, привязка к заказу) → quarantine
  409 → CAS-переходы → completion (`completeResourceOrderItem` /
  `markServicePurchasePaid`) → ledger. Никаких параллельных путей
  завершения.

## P-003. Фиат-провайдер №2 (адаптер)

- Референс-адаптер **T-Bank EACQ** (redirect-confirmation + notification
  Token по SHA-256 отсортированных параметров); при решении владельца —
  замена на CloudPayments/Robokassa без изменения интерфейса.
- Capabilities: `payment.create`, `payment.verification`, `payment.cancel`,
  `refund.create` (если PSP поддерживает — иначе гейт честно отключает
  refund-кнопку).
- Статус-маппер в файле провайдера (убрать `fromYooKassaStatus` из
  нейтрального `paymentStateMachine.ts` — оставить только нейтральные
  состояния).
- Детерминированные Idempotence-ключи на стороне провайдера
  (`providerPaymentId + attempt`), не randomUUID.

## P-004. Crypto-провайдер

- Референс-адаптер крипто-эквайринга (Cryptomus-класс: invoice API +
  HMAC-SHA256 webhook + status API). Конкретный сервис — бизнес-решение
  владельца; адаптер обязан быть настраиваемым через env и тестируемым
  моком транспорта (как YooKassa в vitest).
- **RUB-locked инвойсы**: инвойс создаётся на RUB-сумму FINAL total,
  конверсия — на стороне провайдера; схема БД НЕ меняется на
  мультивалютность (INV-сверка `currency === "RUB"` сохраняется).
- Подтверждение — не redirect: расширение контракта
  `confirmation: { type: "redirect" | "crypto_invoice" }` +
  invoice-поля (`address?`, `memo?`, `expiresAt?`, `payUrl?`);
  capability `payment.poll` для подтверждения опросом.
- Политика расхождений (per-provider, внутри его webhook-обработчика):
  переплата ≥ порога → accept (полная сумма услуги, разница — вне платформы,
  честно документировано); недоплата → invoice FAILED/истёк (никогда не
  «частично завершённая покупка»); TTL инвойса → cancel.
- Refunds: `refund.create` НЕ заявляется (crypto-возвраты вне API провайдера)
  — capability-гейт уже корректно скрывает кнопку.

## P-005. Checkout UI (web)

- Выбор способа оплаты на карточке ресурса (радио из
  `GET /payments/providers`): ЮKassa / T-Bank / Крипта (enabled only).
- Состояние ожидания: redirect-провайдеры — как сейчас («перенаправление…»);
  invoice-провайдеры — блок с суммой (RUB), адресом/memo (copy-кнопка),
  QR, TTL-каундауном и «Проверить оплату» (polling статуса покупки;
  механизм — refetchInterval по существующему `GET /purchases/my`,
  без фейковой индикации).
- Никаких frontend-расчётов итога: сумма инвойса = FINAL из ответа checkout
  (INV-004).

## P-006. Reconciliation и refunds

- `lib/reconciliation/service.ts` — provider-agnostic fetch (через реестр,
  `payment.verification`); при отсутствии provider-side доступа — честный
  режим «provider side unavailable» (существующий механизм internalCount).
- Refund-сервис уже провайдер-агностичен (`resolveProvider`) — покрыть
  тестами для нового фиат-провайдера; crypto — не advertise.

## P-007. Simulate/dev-режим

- simulate работает для любого настроенного провайдера в dev (403 при
  активном боевом провайдере — существующее правило; в prod 404).
- `PaymentProvider.TEST` переиспользуется тестовым раннером; db-reset чистит
  события по всем провайдерам тест-ранов.

---

# 6. Workstream D — Debt Closure (задокументированные недоделки)

Каждый пункт — с источником. Формат: файл → действие → проверка.

## D-001. plan-015 browser coverage (E2E)

- PLAN-015 §51 требовал `test(ui): add plan-015 browser coverage` — коммит не
  создан (git: только feat(ui)/* + docs). Создать `tests/e2e/plan016/` спеку:
  shell (sidebar collapse persistence, theme toggle persistence, AccountMenu,
  баланс виден, поиск-дропдаун открывается/пустое состояние, «/»-хоткей),
  login-страница с динамическими кнопками провайдеров (по discovery),
  payment-method выбор + invoice-блок (через dev-заглушку/TEST-провайдер),
  `/account/identities` link-flow (link-режим можно проверить только
  integration; E2E — наличие страницы и copy UI), 7d/30d-переключатель
  статистики сервера.
- E2E suite остаётся зелёным: все прежние 59 проходят.

## D-002. Admin UX: raw-ID формы

- `app/admin/page.tsx`: placeholder «ID версии» (:671), «ID отзыва» (:1273),
  «ID темы» (:1308), «ID новости» (:1346), raw `s.userId` (:486-488).
  Заменить на выбор из существующих списков (у админа уже есть данные:
  версии ресурса, отзывы, треды, новости — через существующие admin
  endpoints) или на минимум: paste-ID с немедленной валидацией и показом
  сущности перед действием. Список продавцов — displayName/username вместо
  сырого userId.

## D-003. Disputes RU labels

- `app/disputes/page.tsx:55` — рендер сырого EN `targetType` в русском UI;
  ввести словарь `PURCHASE → Покупка`, `SERVICE_PURCHASE → Услуга`
  (админ-вкладка уже переводит — переиспользовать маппинг).

## D-004. Фокус-трапы модалок (a11y)

- DESIGN-SYSTEM §10/§6 обещает «Esc + focus trap» для Modal/ConfirmDialog/
  ReportDialog; фактически только Esc. Реализовать лёгкий общий focus-trap
  хелпер (Tab-цикл + возврат фокуса), применить к ConfirmDialog,
  ReportDialog, DisputeDialog (модалка), Gallery-лайтбоксу, mobile-drawer
  сайдбара, mobile-листу фильтров каталога, AccountMenu/ContextCreate
  dropdowns (минимум: закрытие по Tab-out + возврат фокуса на триггер).
- Gallery: добавить стрелки ←/→ в фокусе, `role="dialog"` уже есть.

## D-005. Search page → react-query

- `app/search/page.tsx` на useState/useEffect → `useQuery` с URL-sync как
  на /resources (debounce, URL единственный источник истины); сохранить
  тексты/локаторы E2E (plan007 E-004: pill «Статьи <n>»).

## D-006. Auth-FOUC (bootstrap-flash)

- `bootstrapSession()` вызывается поточечно на каждой странице; первый
  paint рисует гостевое состояние. Поднять один warm-up вызов в AppShell
  (client, on mount) — существующие поточечные вызовы остаются (идемпотентны);
  auth-required страницы продолжают редиректить при `!ok`.

## D-007. Server statistics 7d/30d (UI)

- API готов (`routes/servers.ts` range 24h/7d/30d, CURRENT.md «Следующий
  шаг»); на `/servers/[slug]` Live-вкладке добавить переключатель 24H/7D/30D
  + Peak/Average/Uptime сводка для выбранного окна (Trend — только если
  даёт реальный API, без выдумок).

## D-008. api-ext.ts hygiene

- Удалить dead exports (usage-проверить перед удалением): `archiveServer`,
  `deleteServerReview`, `fetchForumCategories`, `fetchMyServers`,
  `patchReview`, `updateServerNews`.
- Разбить на доменные модули (`lib/api/resources.ts`, `servers.ts`,
  `community.ts`, `content.ts`, `payments.ts`, …) с реэкспортом из
  `api-ext.ts` — импорты по всему app не ломаются (类型-check + E2E как гейт).

## D-009. Route-level error/loading/not-found

- Добавить `app/error.tsx` (ru, role=alert, retry), `app/not-found.tsx`
  (честное «Страница не найдена» + навигация), `app/loading.tsx` (минимум —
  skeleton-shell на токенах). Не менять существующие постраничные состояния.

## D-010. Footer claims (PLAN-013 §58)

- «Безопасная оплата · DRM-лицензии · Покупки защищены политикой возвратов»
  без страниц политик → привести к факту: «Оплата через платёжных
  провайдеров · DRM-лицензии · Возвраты через споры и модерацию» + ссылки на
  реальные разделы (disputes/marketing без обещаний). Убрать дублирование
  `/news` в двух колонках.

## D-011. OAuth-токены шифрование

- См. A-009 (входит в auth workstream, здесь учёт).

## D-012. Housekeeping документации

- `documents/development/active/`: спеки выполненных планов
  PLAN-012/014/015 (+PLAN-015-IMPLEMENTATION-MAP.md) переместить в
  `completed/` (спека PLAN-013 остаётся рядом с новой пост-хок записью).
- Создать `completed/PLAN-013.md` — пост-хок запись по фактам: git-история
  (0d04531, 95075e0), DESIGN-SYSTEM.md как артефакт, E2E-регрессия
  и её закрытие PLAN-014 §3, remaining visual debt (фокус-трапы — как раз
  D-004). Явно пометить «запись восстановлена пост-хок в PLAN-016».
- README.md история: добавить строки PLAN-011..014; чинить битую ссылку
  `../IDEAS/IDEAS.md` → `../ideas/README.md`.
- TESTING.md: исправить «Каталог workflows пуст» (ложь с PLAN-011), обновить
  счётчики тестов (392/392 → факт на момент приёмки PLAN-016), синхронизировать
  E2E-требования окружения.
- CURRENT.md: убрать дубль-заголовок PLAN-014, обновить устаревший
  «Blockers»-блок, починить ссылку на PROJECT.md; PROJECT.md — ревизия даты
  и «Что ещё НЕ реализовано» (после PLAN-016: отметить auth-провайдеров и
  мульти-провайдерные платежи).
- NEXT-PHASE.md: добавить Цикл 6 (краткий анализ выбора Identity+Payments
  фазы и почему не deals/email/push/7d-графики).

## D-013. E2E-гигиена

- plan001.spec.ts: afterAll-чистка созданных `p1-*`/`e2e-*` сущностей
  (PLAN-006 §17-18 «отдельная техническая задолженность»), не задевая
  `e2e-admin`.

## D-014. ESLint legacy warnings

- Убрать unused imports/vars в тронутых планом файлах; полное обнуление
  legacy-warnings вне скоупа (только «без новых»).

---

# 7. Контракты и схема

- Миграции только формальным путём: правка `site/server/src/prisma/
  contract.prisma` → `prisma contract emit` → `prisma migration plan` →
  пакет в `site/server/migrations/app/` (DATA.md).
- Ожидаемые schema-изменения: `PaymentProvider` enum + `TBANK`/`CRYPTO`;
  НИКАКИХ мультивалютных полей; Account-токены — шифрование на уровне
  приложения (без смены формы колонок, кроме опциональной длины).
- Обновить `contracts/api/authentication.yaml` (providers, direct-mode,
  identities UI endpoints) и `contracts/api/commerce.yaml` (provider в
  create, webhook/:provider, confirmation types, capabilities).

---

# 8. Security requirements (SECURITY.md согласованность)

1. Webhook-верификация у каждого провайдера своя (IP/Basic/HMAC) + всегда
   re-fetch + сверка суммы/валюты(RUB)/привязки → quarantine при нарушении
   (D-004 provider truth wins).
2. Telegram: подпись widget'а — единственный транспортный факт; защита от
   replay: freshness auth_date + дедуп (id, auth_date) + rate-limit;
   никогда не доверять неподписанным полям.
3. oauth_state CSRF для redirect-провайдеров — не ослаблять; VK/Google
   наследуют существующую проверку.
4. `link_user`-режим: только для аутентифицированного пользователя; 409 на
   конфликт (existing).
5. Ключи шифрования токенов — только из env, не в репо; утечка ключа = ротация
   всех токенов провайдеров (документировать процедуру).
6. simulate остаётся dev-only; никакой «валидации оплаты» на клиенте.

---

# 9. Testing

- **Unit/integration** (vitest, ≥ 392, зелёные):
  - `identity.test.ts` паттерн расширяется: VK (authorize/token/userinfo
    stub через `vi.stubGlobal("fetch")`), Telegram (valid/invalid
    data-check-string, stale auth_date, replay), discovery endpoint,
    link/unlink правила (последний метод), шифрование токенов
    (encrypt→store→read→decrypt round-trip, nullable).
  - Новые payments-тесты по образцу `payments-webhook.test.ts`:
    per-provider webhook (signature valid/invalid → 401/403/400),
    replay-идемпотентность, out-of-order (canceled→succeeded), quarantine
    при чужом orderId, underpay → quarantine/expired, overpay-порог →
    accept, provider selection (unknown provider → 400; disabled → 409),
    reconciliation provider-agnostic fetch, refunds для нового фиата
    (INV-013 потолок), db-reset generalization.
  - Concurrency: duplicate webhook двух провайдеров, parallel refund.
- **Playwright E2E** (все 59 прежних + новые plan016):
  - shell/theme/search-дропдаун/sidebar (закрытие D-001 долга PLAN-015 §51);
  - auth: динамические кнопки по discovery (в E2E-окружении включены
    TEST/заглушка-провайдер — реальный OAuth в браузере не гоняется);
  - payments: выбор способа оплаты, invoice-блок (TEST-провайдер),
    simulate-completion дым.
- **Гейты**: `pnpm type-check`, `pnpm test` (unit), web `build`, полный E2E.
- E2E-окружение: те же серверы (:3000/:3001 или управляемый :3002), seed
  план-003/005 + heartbeat; test-admin через `test:e2e:admin`.

---

# 10. Performance

- Без новых N+1: discovery-эндпоинты — константные реестры;
  provider-выбор — один env/registry lookup; polling статуса покупки —
  не чаще 5с и только при активном PENDING.
- Raw-body только на webhook-роутах; лимит тела webhook не больше текущего
  global (10mb не ослаблять).

---

# 11. Implementation Order

```text
Phase A  Audit/verify фактов §2 (полдня, без кода)
Phase B  Identity: discovery + VK + Telegram + UI (login/identities)
         + env матрица + токен-шифрование
Phase C  Payments: provider dispatch/webhooks + T-Bank адаптер
         + crypto adapter + checkout UI + reconciliation
Phase D  Debt closure (D-001..D-012; порядок: D-002..D-009 UI-долг,
         затем D-012 docs)
Phase E  QA: unit + integration + полный E2E + браузерная верификация
         (light/dark, 1440/1920)
Phase F  Documentation sync + housekeeping + логические коммиты
```

---

# 12. Git Discipline

Логические коммиты (пример):

```text
feat(auth): provider discovery + dynamic login buttons
feat(auth): VK ID provider
feat(auth): telegram direct-login
feat(auth): identities management UI
feat(security): encrypt stored oauth tokens
feat(payments): provider-neutral dispatch + per-provider webhooks
feat(payments): T-Bank adapter
feat(payments): crypto invoice adapter
feat(ui): checkout payment method selection + invoice state
fix(ui): admin selectors, disputes labels, focus traps, search react-query
test(e2e): plan-015/016 browser coverage
docs(plan-016): records, contracts, env matrix, housekeeping
```

Никаких гигантских opaque-коммитов; каждый коммит проходит type-check.

---

# 13. Documentation Deliverables

- `documents/api/AUTH.md` — новые провайдеры, direct-mode, discovery,
  identities-page flow, шифрование токенов.
- `documents/api/COMMERCE.md` — provider-выбор, webhook/:provider,
  confirmation-контракт, capabilities матрица, underpay-политика.
- `documents/architecture/SECURITY.md` — telegram-верификация, HMAC
  raw-body, ключ шифрования.
- `documents/architecture/DATA.md` — если появятся новые таблицы (нет —
  только enum).
- `.env.example` (оба), `contracts/api/*.yaml`.
- Запись `documents/development/completed/PLAN-016.md` + обновления
  README/CURRENT (правила Development Plan system).
- PLAN-016 не заявляет Live Demo/3D/Leak Radar/bundles/etc реализованными.

---

# 14. Definition of Done

```text
[ ] GET /auth/providers discovery + динамические кнопки
[ ] Google включён (env-documented, кнопка)
[ ] Yandex surfaced (env-documented, кнопка)
[ ] VK ID provider + integration tests
[ ] Telegram direct-login + signature tests
[ ] /account/identities + link/unlink UI (мёртвый redirect закрыт)
[ ] OAuth-токены зашифрованы at rest
[ ] Смена пароля с инвалидацией сессий

[ ] Provider-neutral payment dispatch (хардкоды устранены)
[ ] POST /payments/webhook/:provider + raw-body + signature-verification
[ ] Фиат-адаптер №2 (референс) + integration tests
[ ] Crypto-адаптер (RUB-locked, underpay policy) + integration tests
[ ] Checkout: выбор способа оплаты + invoice-состояние
[ ] Reconciliation/refunds провайдер-агностичны

[ ] Admin raw-ID → выбор из реальных списков
[ ] Disputes targetType RU
[ ] Focus traps (модалки/лайтбокс/дровер)
[ ] Search → react-query
[ ] Auth-FOUC устранён
[ ] Server stats 7d/30d UI
[ ] error.tsx / not-found.tsx / loading.tsx
[ ] api-ext split + dead exports removed
[ ] Footer claims честны

[ ] Housekeeping: active/ cleanup, PLAN-013 record, README 011–014,
    TESTING.md/CURRENT.md/NEXT-PHASE синхронизированы
[ ] plan-015/016 E2E coverage (новая спека, 59 прежних зелёные)
[ ] type-check/build/lint/unit — зелёные
[ ] Полный E2E зелёный
[ ] Документация обновлена
[ ] Логические коммиты
```

---

# 15. Explicit Non-Goals (чтобы план не разросся)

- Мультивалютность (крипто — RUB-locked инвойсы, конверсия на стороне
  провайдера); изменения UserBalance/OrderItem снапшотов нет.
- Пополнение баланса (top-up) и payouts продавцам — владельческая
  платёжно-правовая модель (NEXT-PHASE циклы; MODEL §25 «не банк»).
- Password reset по email, email/push канал уведомлений — требуют
  боевого SMTP-решения владельца (PLAN-004 §6, CURRENT Blockers).
- Subscriptions, bundles, promocodes admin UI, wishlist, favorites,
  deals/guarantees, trust hub, blacklist, reputation page, events,
  Live Demo, 3D Studio, Leak Radar, community follow, creator devlogs,
  editorial featured, markdown-статьи, публичные просмотры, i18n-фреймворк,
  next/image-миграция, Tailwind 4 / Next 16 / Express 5 / TS 7 — каждый
  отдельным будущим планом.
- Production verification (домен, DNS, боевые ключи) — по-прежнему решение
  владельца; новые провайдеры тестируются моками + dev-simulate.

---

# 16. Final UX Test (перед объявлением завершения)

```text
1. На /auth/login я вижу все включённые способы входа и ни одной
   выключенной кнопки.
2. Я могу привязать/отвязать внешнюю идентичность и не потерять вход
   (последний метод защищён).
3. Я могу выбрать способ оплаты и понять, что происходит (redirect vs
   инвойс с адресом и таймером).
4. После оплаты через любой провайдер покупка/лицензия появляются по
   одним и тем же правилам, без ручных «кнопок админа».
5. Споры/возвраты работают как раньше (YooKassa-путь не сломан).
6. Админка читаема: ни одной сырой UUID-формы на критических действиях.
7. Страницы ошибок не выглядят как упавший Next.
8. Тёмная/светлая тема не деградировали ни на одной новой поверхности.
9. Все прежние 59 E2E зелёные; новые покрытия реально добавлены.
10. Документация не обещает того, чего нет.
```

Если любой ответ «нет» — продолжать итерацию.

---

# 17. Final Principle

Цель не «добавить кнопки» и не «переписать платежи», а:

> **довести точки входа и точки оплаты платформы до состояния
> «провайдер — это конфигурация, а не фича»**, закрыв при этом
> задокументированный долг так, чтобы ни один инвариант денег,
> приватности и честности продукта не был ослаблен.

Инерфейсы `IIdentityProvider` и `IPaymentProvider` уже нейтральны —
PLAN-016 превращает их из «готовности» в работающую реальность.