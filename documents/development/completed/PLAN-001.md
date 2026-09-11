# PLAN-001 — Initial Product Assembly & Completion

**Status:** COMPLETED
**Дата завершения:** 2026-09-10
**Репозитории:** `acc-holo-dev/mta-market-site`, `acc-holo-dev/mta-market-module`, `acc-holo-dev/mta-market-document`

---

## 1. Цель

Довести MTA Market до первой цельной рабочей версии (Initial Product Release):

1. регистрация и вход (username/email + пароль; Discord OAuth);
2. рабочий Marketplace с бесплатными и платными ресурсами;
3. профиль и реальный персистентный баланс;
4. seller flow: заявка → одобрение → создание ресурса → заполнение данных →
   загрузка artifact → «Готово» → `PENDING_REVIEW`;
5. admin flow: Admin Panel → очередь модерации → approve/reject → `PUBLISHED`;
6. buyer flow: бесплатное получение или покупка → purchase/license;
7. весь цикл проходит без ручного вмешательства разработчика.

Ключевое условие приёмки: **реальный frontend/browser flow**. Backend integration
tests и typecheck сами по себе недостаточны.

## 2. Исходное состояние (на момент старта плана)

- `mta-market-site`: зрелый backend (OAuth-аутентификация, каталог, commerce,
  ledger, DRM v2 сервер, песочница артефактов, подпись) и frontend с OAuth-входом;
  парольной аутентификации не было; пользовательского баланса не было; flow создания
  ресурса продавцом и модерации не был собран в цельный продукт; «полный E2E» был
  только на уровне HTTP (supertest), реального браузерного прогона не существовало.
- `mta-market-module`: зрелый SDK + DRM client subsystem протокола v2, юнит-тесты
  проходят; против живого сервера не проверен (вне скоупа плана).
- `mta-market-document`: структура каталогов 01–09 с roadmap и отчётами; заменяется
  Development Plan system.

## 3. Target state

Пользователь может: зарегистрироваться → войти → видеть профиль/баланс → Marketplace →
карточку ресурса; продавец — создать ресурс, загрузить artifact, отправить на модерацию;
админ — смодерировать и опубликовать; покупатель — получить/купить ресурс и получить
лицензию; всё это проверяется сквозным браузерным сценарием.

## 4. Workstreams и фактически выполненное

| Workstream | Результат |
|---|---|
| A. Authentication | `POST /auth/register` (bcrypt, роль USER, уникальность username/email), `POST /auth/login` (username или email), сессии на существующем JWT/cookie-слое, refresh-ротация сохранена; страницы `/auth/register`, `/auth/login`. |
| B. Account / Profile | Страница `/account`: профиль, связанные аккаунты, баланс, покупки; редактирование ограничено `displayName`/`avatar`; навигация Marketplace/Профиль/Покупки/Продавец/Админ (условная). |
| C. Balance | Модель `UserBalance` (userId PK, available в копейках, RUB), создание при регистрации и при `/auth/me`; баланс виден в шапке и в профиле; пополнение не реализовано (по плану). |
| D. Marketplace | `/resources` — основная поверхность: список PUBLISHED, фильтры free/paid и тип, карточка ресурса; draft/pending недоступны публично (404 API + отсутствие в каталоге). |
| E. Seller | `/seller` (apply → PENDING → APPROVED), кабинет с ресурсами/услугами; мастер `/seller/new`: 4 шага, создание DRAFT на шаге 2, реальная загрузка artifact + версия, финальная кнопка «Завершить» → `PENDING_REVIEW`. |
| F. Moderation | Очередь PENDING_REVIEW в Admin Panel с метаданными; approve → `PUBLISHED` (с гейтом подписи/валидации версий); reject → `SUSPENDED` с причиной; `moderationEvent` + audit сохраняются. |
| G. Admin | Роль-гейт UI и API (403 для USER); «Админ» в навигации только для ADMIN/MODERATOR; dev-скрипт `scripts/dev-admin.ts` для воспроизводимого ADMIN-аккаунта (без hidden backdoor). |
| H. Commerce | Бесплатное получение — атомарное завершение без payment-записи (INV-002); платная покупка — checkout → payment → завершение → license; ownership виден покупателю. |
| I. DRM / Artifact | DRM v2 не переписывался; связь published resource → version → artifact → signature → purchase/license сохранена; artifact-пайплайн подключён к мастеру создания. |
| J. Frontend Completion | Единая навигация, состояния loading/empty/error, нет placeholder-заглушек в обязательном flow. |
| K. Product Consistency | Единая русская терминология статусов (`StatusBadge`),backend-машина состояний — единственный источник переходов. |
| L. Testing | Backend: 254 теста; browser E2E: новый Playwright-набор (12 сценариев) — главный тест плана. |
| M. Cleanup | Удалены误导ные placeholder-элементы обязательного flow; исправлены реальные дефекты (см. §7). |
| N. Release Readiness | Воспроизводимый dev-сетап документирован ([README](../../README.md)); admin bootstrap; build/typecheck/tests зелёные. |
| O. Documentation | Репозиторий документации приведён к структуре PROJECT/IDEAS/DEVELOPMENT. |

## 5. Изменения по репозиториям

**mta-market-site** (ключевые коммиты периода плана):

- Password auth (A-001..A-004): регистрация/вход по username/email поверх существующей
  сессии/cookie-инфраструктуры; OAuth сохранён.
- User balance (C-001..C-004): модель `userBalance`, инициализация 0, показ в UI.
- Сборка продукт-циклов: seller-гейт на создание листингов, мастер создания ресурса,
  модерационная очередь, approve/reject, marketplace-видимость.
- Commerce: free acquisition без фиктивного платежа; paid purchase с dev-completion.
- Финальная приёмка (2026-09-10): исправлены контрактные дефекты frontend/backend
  (см. §7), добавлен browser E2E (Playwright) — `e2e/plan001.spec.ts` + `helpers.ts`,
  `playwright.config.ts`, npm-скрипты `test:e2e`, `test:e2e:admin`;
  `/purchases/my` обогащён состоянием лицензии; admin rate-limits настраиваются env.
- Вcommitted-состояние: `git log` репозитория (последний: "fix(plan-001): frontend/backend contract repairs + browser E2E acceptance").

**mta-market-module**: изменений в рамках финальной приёмки не требовалось;
DRM client subsystem остался как есть (юнит-тесты проходят).

**mta-market-document**: полная реструктуризация (см. §9).

## 6. Tests

| Набор | Результат | Дата |
|---|---|---|
| Backend vitest (чистое окружение) | **254/254, 24 файла** | 2026-09-10 |
| Typecheck (`tsc --noEmit` server + web CI) | **2/2 задач успешно** | 2026-09-10 |
| Web production build (`next build`) | **успешно, 15 маршрутов** | 2026-09-10 |
| Browser E2E (Playwright/Chromium) | **12/12** | 2026-09-10 |
| Module DRM unit tests (Linux x64) | **ALL TESTS PASSED** | 2026-09-10 |

Примечание: тест `startup-policy` требует отсутствия локального `.env` с `JWT_SECRET`
(проверяет отказ старта без секрета) — в репозитории он зелёный; локальный прогон с
заполненным `.env` исключает его по определению.

## 7. Дефекты, найденные и исправленные в ходе приёмки

Frontend → backend расхождения (реальный браузерный flow падал, хотя код компилировался):

1. `adminSetResourceStatus` вызывал `POST /admin/resources/:id/status`, backend регистрирует
   только `PATCH` → модерация из UI не работала. Исправлено на `PATCH`.
2. Очередь одобрения продавцов: frontend звал несуществующий `GET /admin/sellers` и
   `POST /admin/sellers/:id/approve|reject`; backend: `GET /seller/list`,
   `POST /seller/:userId/approve|reject`. Исправлено.
3. Список споров в Admin Panel: frontend звал `GET /admin/disputes`; backend:
   `GET /disputes/admin/all`. Исправлено.
4. `fetchSellerProfile` не разворачивал конверт `{ profile }` → кабинет продавца
   всегда считал профиль отсутствующим. Исправлено.
5. Dashboard («Покупки») ожидал `{data: [...]}` от `/purchases/my` (сервер отдаёт массив)
   и падал на nullable resource. Исправлено.
6. `fetchResourceVersions` ожидал `{data}` (сервер отдаёт массив) → версии ресурса
   не показывались. Исправлено.
7. **Admin Panel не восстанавливала сессию** при прямом заходе `/admin` (access token
   в памяти умирает при reload) — админ видел «Доступ запрещён» (G-001/G-002). Исправлено:
   `bootstrapSession()` до проверки роли.
8. `GET /purchases/my` не возвращал лицензию → страница аккаунта показывала «Лицензия
   не выдана» для завершённых покупок (H-004). Исправлено на сервере.
9. `next build`: экспорт `slugify` из page-файла Next.js запрещён — production build
   падал. Исправлено (функция больше не экспортируется).
10. Rate limits: per-account лимиты login/refresh (10/30 в минуту) были захардкожены
    и рвали длительные браузерные сессии — вынесены в env
    (`LOGIN_RATE_LIMIT_MAX`, `REFRESH_RATE_LIMIT_MAX`; дефолты не изменены).

## 8. Browser E2E verification (главная проверка плана)

Инструменты: Playwright + Chromium (headless), реальные dev-серверы (Next.js :3000,
Express :3001), PostgreSQL/Redis в Docker; DB-ассерты — прямые SQL-запросы.
Запуск: `pnpm test:e2e:admin && pnpm test:e2e` (при запущенных серверах).

| # | Сценарий | Проверяет |
|---|---|---|
| 1 | register → profile → balance 0 → edit profile → session survives reload | A-001/A-003, B-001/B-002, C-001..C-004, N-003 (реальная строка в `userBalance`) |
| 2 | logout → login по username → login по email | A-002 |
| 3 | дубликат username → человекочитаемая ошибка | A-001 acceptance |
| 4 | seller apply → admin одобряет в Admin Panel → seller area | E-001/E-002, G-003 |
| 5 | мастер: данные + реальная загрузка artifact → «Завершить» → `PENDING_REVIEW` | E-003..E-006 |
| 6 | seller не может self-publish (403); draft не виден публично (UI 404 + API 404) | A-008, D-004, K-003 |
| 7 | admin: очередь → approve → `PUBLISHED` → ресурс в Marketplace, карточка с версией и ценой | F-001..F-003, D-003 |
| 8 | admin: reject с причиной → не публикуется, статус `SUSPENDED`, продавец видит | F-004 |
| 9 | USER: Admin Panel закрыта (UI + API 403); ADMIN: доступ есть | G-001/K-003 |
| 10 | buyer: бесплатное получение → лицензия, **0 записей payment** | H-001, INV-002 |
| 11 | buyer: платная покупка → dev-completion → purchase `COMPLETED` + license `ACTIVE` в аккаунте и в БД | H-002/H-004 |
| 12 | dashboard покупателя: обе покупки видны; отклонённый ресурс отсутствует | B-003, H-004 |

Итог: **12 passed (49s)**, 1 worker, serial.

## 9. Documentation state

`mta-market-document` приведён к структуре:

```
README.md            — карта репозитория
PROJECT.md           — продукт и общая структура
IDEAS/               — идеи на будущее (не обязательства)
DEVELOPMENT/
  README.md          — назначение Development Plan system + воспроизводимость
  CURRENT.md         — текущее состояние
  ACTIVE/            — активный план (пусто)
  REFERENCE/         — замороженные контракты (DRM v2, контракт репозиториев, совместимость)
  COMPLETED/PLAN-001.md — этот документ
```

Старые каталоги (00-INDEX, 01-project … 09-legacy, 99 документов) классифицированы и
выведены: IMPLEMENTED — отражён в PROJECT.md; PLAN-001 — этот файл; IDEA — перенесён
в `IDEAS/IDEAS.md`; DISCARD/SUPERSEDED — удалены (доступны в git-истории).

## 10. Known limitations

- ЮKassa: боевой webhook на реальных деньгах не прогонялся (dev-completion покрывает логику).
- DRM client: E2E против живого license-сервера и Windows — вне приёмки (юнит-уровень).
- Пополнение баланса не реализовано; баланс персистентный и реальный.
- Restore drill, алертинг, полный прод-observability — не выполнялись.
- Discord OAuth проверен кодом и тестами; в acceptance-контуре Discord-креды dev-заглушки.

## 11. Final acceptance

Условия завершения (§12 задания) выполнены:

- [x] browser/product flow реально проходит — Playwright 12/12;
- [x] критический backend flow проходит — 254/254;
- [x] frontend typecheck/build проходят — tsc 2/2, `next build` ок;
- [x] существующие тесты проходят — 254/254 + module ALL TESTS PASSED;
- [x] нет критического blocker в основном пользовательском сценарии — нет;
- [x] documentation state соответствует реальному состоянию кода — эта структура.

**PLAN-001 = COMPLETED (2026-09-10).**
