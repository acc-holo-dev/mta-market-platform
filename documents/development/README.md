# Development Plan System

## Основной принцип

Development Plan — это не просто список задач.

**Каждый Plan переводит проект из одного рабочего состояния в другое.**

План описывает:

- цель (какое состояние нужно получить);
- исходное состояние (где проект находится сейчас);
- workstreams (направления работ);
- критерии завершения (когда план считается выполненным — по фактической
  проверке продукта, а не по «код компилируется»);
- итоговую запись о выполнении.

Планы живут в:

- `DEVELOPMENT/ACTIVE/` — активный план (один за раз);
- `DEVELOPMENT/COMPLETED/` — завершённые планы с итоговой записью
  (цель, что сделано, тесты, приёмка, ограничения, дата).

Текущее состояние всегда отражено в [CURRENT.md](CURRENT.md).

Выбор того, какой фазой станет следующий план, фиксируется отдельным
решением владельца (сопоставительный анализ foundational-документов —
[NEXT-PHASE.md](NEXT-PHASE.md), исторический пример).

## История планов

| План | Статус | Суть |
|---|---|---|
| [PLAN-001](COMPLETED/PLAN-001.md) | COMPLETED (2026-09-10) | Initial Product Release: довести MTA Market до первого цельного рабочего продукта (auth → marketplace → seller → модерация → покупка → лицензия), проверенного реальным browser flow. |
| [PLAN-002](COMPLETED/PLAN-002.md) | COMPLETED (2026-09-10) | Product Experience Foundation. |
| [PLAN-003](COMPLETED/PLAN-003.md) | COMPLETED (2026-09-10) | Marketplace Core. |
| [PLAN-004](COMPLETED/PLAN-004.md) | IMPLEMENTATION COMPLETE (2026-09-10) | Production Readiness & Operational Hardening. |
| [PLAN-005](COMPLETED/PLAN-005.md) | IMPLEMENTATION COMPLETE (2026-09-10) | Community & Server Foundation: сущность SERVER (регистрация, верификация владения через токен интеграции, публичные страницы, мониторинг ONLINE/OFFLINE/UNKNOWN), глобальный форум, server news/updates, верифицированные отзывы (одноразовые токены), follow + уведомления, публичные профили с бейджами, модерация и репорты, privacy-by-default на backend-уровне. |
| [PLAN-006](COMPLETED/PLAN-006.md) | IMPLEMENTATION COMPLETE (2026-09-11) | Daily Experience Foundation: живой Home («Что происходит в MTA прямо сейчас?»), глобальные LIVE-агрегаты из реальных heartbeat-сэмплов, derived activity read-layer (9 типов, окно 7 дней, детерминированный ranking, без новой доменной сущности), блоки «Популярное» на реальных метриках, сводка «Сейчас / За ночь» в dashboard, инвалидация кэша на высокоценных мутациях. |
| [PLAN-007](COMPLETED/PLAN-007.md) | IMPLEMENTATION COMPLETE (2026-09-11) | Content Foundation: CONTENT pillar (статьи с модерацией, хаб /content, страницы статей с явными связями Resource/Server и тредами обсуждения, «Мои статьи», админ-очередь), NEW_ARTICLE в daily experience, Articles в поиске, статьи в профиле автора; заодно построена отсутствовавшая страница /search. |
| [PLAN-008](COMPLETED/PLAN-008.md) | IMPLEMENTATION COMPLETE (2026-09-11) | Follow Expansion (Creator + Resource): подписки на создателя и ресурс (§16 до шага Resource), уведомления CREATOR_RESOURCE / CREATOR_ARTICLE / RESOURCE_UPDATE, покупатель уведомляется об обновлении купленного (§26), Market Loop починен на шаге Update (версия → re-moderation → release), агрегаты без раскрытия социального графа (§42). |
| [PLAN-009](COMPLETED/PLAN-009.md) | IMPLEMENTATION COMPLETE (2026-09-11) | Thread Follow: шаг Follow в Community Loop (§10) — подписка на любое обсуждение, FORUM_REPLY доставляется подписчикам (dedup с автором и участниками), агрегат «N следят» на странице темы, ряд «Отслеживаемые обсуждения» в сводке; Community-follow отложен до появления сущности «сообщество». |
| [PLAN-010](COMPLETED/PLAN-010.md) | IMPLEMENTATION COMPLETE (2026-09-11) | Creator Analytics Foundation: честный счётчик просмотров страниц ресурсов (агрегат ресурс×день, без идентичностей зрителей), блок «Аналитика» в кабинете продавца (просмотры/покупки/конверсия за 30 дней); просмотры — приватные данные продавца. |
| [PLAN-011](COMPLETED/PLAN-011.md) | COMPLETED (2026-09-11) | Production Readiness (see record). |
| [PLAN-012](COMPLETED/PLAN-012.md) | IMPLEMENTATION COMPLETE (2026-09-12) | Transactional correctness core: DB-инварианты (checkout exactly-once, atomic ledger, Idempotency-Key, CAS dispute transitions) + спецификация PLAN-012-spec.md. |
| PLAN-013 | IMPLEMENTATION COMPLETE (2026-09-11) | Visual System & UX Redesign: токены, ui-kit, все поверхности (см. DESIGN-SYSTEM.md; запись восстановлена пост-хок в PLAN-016; спека: PLAN-013-spec.md). |
| PLAN-014 | IMPLEMENTATION COMPLETE (2026-09-12) | Dependency/toolchain modernization (см. completed/PLAN-014.md; спека: PLAN-014-spec.md). |
| [PLAN-015](COMPLETED/PLAN-015.md) | IMPLEMENTATION COMPLETE (2026-09-12) | Experience Architecture & Visual System: единый AppShell (Sidebar expanded/collapsed + Topbar), две первоклассные темы (light/dark) с одним переключателем, глобальный поиск-дропдаун над /search, context-aware create, trust-бейджи, placement-архитектура, Home как Discover-поверхность, Маркет с вкладками Ресурсы/Услуги, My MTA + /me/following, кабинет продавца с ?tab=. E2E 59/59, unit 392/392. |
| PLAN-016 | IMPLEMENTATION COMPLETE (2026-09-12) | Identity Expansion, Multi-Provider Payments & Platform Debt Closure: вход через VK/Google/Yandex/Telegram (discovery + динамические кнопки), /account/identities, шифрование OAuth-токенов, смена пароля; provider-neutral платежи (dispatch, webhook/:provider, T-Bank, crypto RUB-locked, checkout UI, dev-заглушка TEST); долг D-002..D-014 (фокус-трапы, search react-query, admin-валидация, error-страницы, 7d/30d, api-ext модули, E2E-гигиена). E2E 68/68, unit 440/440 (см. completed/PLAN-016.md; спека: PLAN-016-spec.md). |

| PLAN-017 | COMPLETED (2026-09-13) | Architecture consolidation wave: единый конфиг (config/environments + application), канонический startup.py (dev/release/test/db/...), worker runtime (outbox consumer + schedulers), housekeeping. Исполнение: коммит `07bb748` (см. completed/EXECUTION-MAP-017-018-019.md). |
| PLAN-018 | COMPLETED (2026-09-13) | Productization wave: admin-секции (users/servers/finance/premium/advertising), deals, subscriptions, notifications. Исполнение: `07bb748`. |
| PLAN-019 | COMPLETED (2026-09-13) | Architecture 2.0: worker outbox + schedulers, productization foundation (см. completed/PLAN-019.md; исполнение — `07bb748`). |
| [PLAN-020](COMPLETED/PLAN-020-AUDIT.md) | COMPLETED (2026-09-13) | Architecture Deep Audit & Stabilization: 9 аудитов A–T (192 находки), 26 исправлений + follow-up (scheduler lock, notification dedup, webhook dispatch платформенных заказов, refund completion, atomic ledger postings, CI cache/filters). Тесты 693/693 (74 файла); отчёт: completed/PLAN-020-AUDIT.md. |

## Правила работы с планами

1. Новый цикл разработки = новый план (`PLAN-002`, ...). Один активный план за раз.
2. План фиксирует переход состояний, а не список желаемых фич: «из состояния A в состояние B».
3. Всё, что не требуется для цели плана, уходит в [IDEAS](../ideas/README.md), а не в план.
4. План считается завершённым только после проверки пользовательского/продуктового
   результата (для продуктовых фич — реальный browser flow, а не только компиляция и
   модульные тесты).
5. После завершения план переносится в `COMPLETED/` с фактическим итогом, без будущих идей.

## Воспроизведение среды разработки и проверки

Канонический раннер — `startup.py` (см. [../operations/DEVELOPMENT.md](../operations/DEVELOPMENT.md)):

```sh
python3 startup.py doctor            # диагностика окружения
python3 startup.py dev               # infra -> schema -> backend + worker + web
python3 startup.py db seed           # dev-датасет: admin + план003 (товары) + план005 (серверы/контент) + услуги
python3 startup.py db seed admin     # dev-админ (дефолт admin@mtamarket.dev / dev-password-123)
python3 startup.py test unit         # unit-тесты
python3 startup.py test integration  # integration + concurrency (тестовая БД поднимается и сносится сама)
python3 startup.py status            # таблица сервисов
python3 startup.py logs backend      # логи; stop — остановить всё; clean --destructive --yes — снести дев-БД
```

Модуль (Linux x64): `python3 startup.py module` (cmake --preset linux-gcc + ctest 3/3;
см. [../module/BUILD.md](../module/BUILD.md)).

Переменные окружения: `site/server/.env.example` (корневой `.env.example` — полная матрица)
(обязательны `DATABASE_URL`, `JWT_SECRET`; `ARTIFACT_SIGNING_PRIVATE_KEY` — Ed25519 PKCS8 base64
для подписи артефактов; `YOOKASSA_*` опциональны — иначе dev-completion
`POST /payments/:id/simulate`).

