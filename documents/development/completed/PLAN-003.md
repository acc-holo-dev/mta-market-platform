PLAN-003 — Marketplace Core

Контекст проекта:
- acc-holo-dev/mta-market-site
- acc-holo-dev/mta-market-module
- acc-holo-dev/mta-market-document

PLAN-001 (Initial Product Release) и PLAN-002 (Product Experience Foundation)
завершены и зафиксированы. Продукт имел: аутентификацию, Discord, профиль,
баланс, Marketplace, seller flow, artifact upload, модерацию, Admin Panel,
покупки, лицензии, платежи, отзывы, версии, DRM, единый design system,
отзывчивую навигацию и browser E2E.

Зафиксированный gap после PLAN-002: ресурсы выглядели как записи из БД —
без обложек и скриншотов, без настоящего поиска/фильтров/сортировки на
сервере, без витрины продавца, без полноценной модерации товара.

Цель PLAN-003:

Превратить существующий работающий Marketplace в настоящий магазин ресурсов
вокруг главной сущности — Resource. Resource должен перестать выглядеть как
запись из БД и начать выглядеть как полноценный товар.

==================================================
ЧТО СДЕЛАНО (фактическое состояние)
==================================================

WORKSTREAM A — RESOURCE MEDIA FOUNDATION

- A-001: исследована модель Resource (contract.prisma), routes (resources.ts,
  upload.ts), существующая загрузка/валидация/авторизация. Минимальное
  изменение выбрано вместо media-платформы.
- A-002 Cover: добавлено поле `Resource.coverUrl` (nullable — существующие
  ресурсы без media продолжают работать, типографический fallback сохранён).
- A-003 Screenshots: новая модель `ResourceMedia` (kind="SCREENSHOT",
  position, onDelete: Cascade). Максимум 8 на ресурс.
- A-004 Media lifecycle: upload → attach → replace → delete с удалением
  файла из storage; удаление ресурса чистит cover + media-файлы (best-effort).
- A-005 Media security: lib/media.ts — magic-byte sniffing (PNG/JPEG/WebP/GIF),
  согласованность extension/declared mime/фактического формата, лимит 5 МБ,
  opaque имена `media-<64hex>.<ext>`, публичная раздача только через
  GET /media/:name (артефакты с plain-именами недостижимы), проверка
  isOwnMediaUrl на attach (запрет произвольных URL).
- A-006 Compatibility: coverUrl nullable; карточки без медиа используют
  типографический fallback (ResourceCover). Никаких fake stock images.

WORKSTREAM B — SELLER MEDIA UX

- B-001: в wizard добавлен шаг «Оформление» (5 шагов вместо 4) с обложкой
  и скриншотами (MediaManager).
- B-002: состояния uploading/uploaded/failed/removing; для скриншотов —
  локальный preview до загрузки, прогресс-состояния.
- B-003: человекочитаемые ошибки (формат, размер, mismatch, upload failed)
  — без raw backend exceptions (friendlyUploadError).
- B-004: порядок скриншотов через простые move-контроли (←/→) + PUT order.
- B-005: шаг «Проверка» показывает реальную ResourceCard-превью товара
  (обложка, название, описание, цена, тип, продавец) + метаданные.
- B-006: в кабинете продавца — раскрытый редактор «Оформление» для
  DRAFT/PENDING_REVIEW (GET /resources/:slug/media, owner-only);
  для PUBLISHED сервер отклоняет изменения (409) с понятным сообщением.

WORKSTREAM C — RESOURCE CARD V2

- ResourceCard эволюционировал (не ResourceCard2): реальная обложка через
  общий ResourceCover, seller identity, тип, цена, рейтинг. Полностью
  кликабельная (один Link), keyboard focus ring, hover, без nested
  interactive элементов (C-005).

WORKSTREAM D — RESOURCE DETAIL V2

- D-001: hero с типом, версией (v-бейдж), названием, описанием, seller
  identity (с аватаром), рейтингом, датой.
- D-002: Gallery — cover + screenshots с лайтбоксом (fixed overlay),
  keyboard support (Esc, ←/→), счётчик, честные alt-тексты. Без тяжёлых
  image-viewer фреймворков.
- D-003: описание сохранено, улучшена presentation (line-clamp в hero).
- D-005: Seller block в сайдбаре с avatar и ссылкой на витрину.
- D-006: purchase sidebar сохранён без изменений логики.
- D-007: отзывы сохранены.

WORKSTREAM E — SELLER STOREFRONT

- E-001: GET /sellers/:username — публичная product-oriented витрина:
  avatar, displayName, supportInfo (для APPROVED), memberSince, resourceCount.
- E-002: только PUBLISHED-ресурсы отдаются витриной; непубличные — никогда.
- E-003: структура Seller → Profile → Resources (страница /sellers/[username]).
- E-004: Resource Detail → seller → витрина → обратно в Resource Detail.
  Витрина отсутствует (404 «Витрина не найдена»), если нет APPROVED-профиля
  и опубликованных ресурсов.

WORKSTREAM F — MARKETPLACE SEARCH

- F-001/F-002: поиск реализован на сервере: q по title, description и
  имени продавца (ILIKE-ветки, объединённые по id). Сортировка и pagination
  сохранены.
- F-003: search UI на Маркетплейсе с очисткой.
- F-004: запрос сохраняется в URL (?q=...) — shareable, history, refresh.
- F-005: состояния loading/empty/error/no-match честные.
- F-006: no fake search — каждый параметр реально влияет на данные.

WORKSTREAM G — CATEGORIES

- G-001: ResourceType enum подтверждён (SCRIPT/MAP/MODEL/TEXTURE/SOUND/GAMEMODE).
- G-002: навигация по категориям (chips) на Маркетплейсе.
- G-003: /resources?type=MAP — категория в URL.
- G-004: предсказуемая навигация без отдельных физических роутов.

WORKSTREAM H — FILTERS

- H-001: price=free|paid на сервере.
- H-002: type фильтр по реальным enum-значениям.
- H-003: структура фильтров расширяемая (compatibility/version/platform/
  seller позже — без данных сейчас не реализованы).
- H-004: фильтры синхронизированы с URL.
- H-005: «Сбросить всё» очищает все фильтры и сортировку.

WORKSTREAM I — SORTING

- I-001: newest — createdAt desc (БД).
- I-002: rating — средний рейтинг отзывов (агрегат, in-memory, fallback по дате).
- I-003: price_asc / price_desc (БД, tie-break по дате).
- I-004: popular — число COMPLETED покупок (настоящий signal, groupBy aggregate);
  без покупок — деградация в рейтинг отзывов. Никакого fake popularity.
- I-005/I-006: /resources?sort=popular и др.; сортировка сохраняется при
  переходе между страницами (в URL).

WORKSTREAM J — HOMEPAGE DISCOVERY

- J-001: секция «Новинки» — реальный createdAt (сервер).
- J-002: секция «Популярное» — реальные завершённые покупки; fallback —
  реальный рейтинг отзывов.
- J-003: секция «Бесплатные ресурсы» — реальные free.
- J-004: Featured не добавлен (нет business rule).
- J-005: каждая секция имеет «Смотреть всё» → /resources?sort=newest|popular
  или ?price=free.
- J-006: агрегированный GET /resources/homepage — один запрос вместо трёх.

WORKSTREAM K — PRODUCT QUALITY

- K-001: карточки — товары, не «таблица в Card».
- K-002: seller identity единообразен (Card / Detail / Storefront).
- K-003: цена через общий Price component.
- K-004: рейтинг через общий Rating component.
- K-005: typeLabel везде (Скрипт/Карта/...) — raw enum не показывается.

WORKSTREAM L — RESOURCE CONTENT MODEL

- cover + screenshots реализованы; requirements/compatibility/features —
  остаются как будущие поля ( CompatibilityReport существует на уровне
  версий, на UI показывается только реальный validation status в модерации).

WORKSTREAM M — MODERATION V2

- GET /admin/resources/:id — полная карточка: cover, screenshots, seller,
  цена, тип, версии с artifact/validation статусами (signed, validation
  status). M-001: admin видит почти ту же product presentation, что и buyer
  (блок «Товар так, как его увидит покупатель» + Gallery). M-002: медиа
  видно админу. M-003: state machine PENDING_REVIEW → PUBLISHED не менялась.

WORKSTREAM N — NAVIGATION

- N-001: breadcrumbs Главная / Маркетплейс / Категория / Ресурс.
- N-002: history предсказуема (debounced search — replace, клики — push).
- N-003: pagination сохраняет все фильтры/сортировку.

WORKSTREAM O — MOBILE

- Одна колонка, drawer для фильтров, крупные touch targets, product CTA
  остаётся доступным. Проверено E2E (R-008).

WORKSTREAM P — ACCESSIBILITY

- aria-label/aria-pressed/role=searchbox, keyboard Esc/←/→ в лайтбоксе,
  focus-visible ring на карточках и фильтрах, честные alt-тексты.

WORKSTREAM Q — SEED DATA

- scripts/seed-plan003.ts + scripts/lib/png.ts (PNG-энкодер на Node built-ins):
  4 продавца + 5 покупателей, 16 PUBLISHED ресурсов всех типов с настоящими
  обложками/скриншотами (сгенерированные абстрактные PNG — без stock photos),
  реальными ZIP-артефактами версий, отзывами и COMPLETED покупками
  (popularity signal). 1 DRAFT ресурс для кабинета продавца.
- Идемпотентен по slug; PENDING_REVIEW не создаёт (очередь остаётся чистой
  между E2E прогонами).

WORKSTREAM R — TESTING

- R-001: существующие 12 E2E PLAN-001 проходят (обновлены под 5-шаговый
  wizard и K-005 human-readable labels; strict-mode фиксы).
- R-002..R-005: новый e2e/plan003.spec.ts — 13 тестов: search → detail,
  empty state, price/category фильтры + URL, сортировки (price_asc,
  price_desc, popular), reset, detail с cover/gallery/seller, лайтбокс
  (Esc), storefront (включая честную 404), homepage view-all, mobile drawer,
  media upload через wizard (cover + 2 скриншота + preview + submit +
  DB-проверка + cleanup).
- Итого 25/25 browser E2E проходят.

WORKSTREAM S — PERFORMANCE

- S-002: карточки грузятся пакетно (include seller + reviews aggregate
  в одном запросе), без N+1 enrichment; homepage — один агрегированный
  запрос вместо трёх frontend-вызовов.
- S-003: pagination сохранена; rating/popular капнуты 1000 записей.
- S-004: медиа ограничено 5 МБ + multer limits.

WORKSTREAM T/U — BACKEND CONTRACT

- Единый GET /resources?q=&type=&price=&sort=&page=&limit= (не создавались
  /search, /catalog, /popular, /new, /free). U-002/U-003: без параметров
  поведение прежнее (newest), существующие consumers работают.
- Query contract документирован в validation.ts и api-ext.ts (ResourceQuery).

WORKSTREAM V — REPOSITORY SCOPE

- mta-market-site: основной объём. Backend — только media support,
  discovery query contract, sellers storefront, admin resource detail.
- mta-market-module: НЕ изменялся (не потребовалось).
- mta-market-document: этот файл + CURRENT.md.

WORKSTREAM W/X — CODE QUALITY / PRODUCT LANGUAGE

- Компоненты эволюционировали (ResourceCard, Rating, Price, Avatar),
  новые — общие (ResourceCover, Gallery, MediaManager, MediaEditorButton).
- Единая терминология (Маркетплейс / Ресурс / Продавец / Витрина).

==================================================
ПРИЁМКА (2026-09-10)
==================================================

- Playwright browser E2E: **25/25** (PLAN-001: 12, PLAN-003: 13) на живых
  dev-серверах (Next.js :3000 + Express :3001 + PostgreSQL/Redis в Docker).
- Backend-тесты: **253/254**. Единственное падение — `startup-policy`
  acceptance (процессный таймаут в dev-окружении); воспроизводится на дереве
  до PLAN-003, не является регрессией (зафиксировано ещё в PLAN-002).
- `tsc --noEmit` чист у server и web; production build web и server проходит.
- Нет критических console/runtime ошибок на ключевых страницах
  (home, marketplace, detail, storefront, admin, discovery states).
- Схема БД: 5 additive операций (resource.coverUrl + resourceMedia) применены
  через `prisma db update` к dev- и test-БД; миграционный план не ломал
  существующие данные.

==================================================
DEFINITION OF DONE — СТАТУС
==================================================

MARKETPLACE
- [x] Marketplace визуально воспринимается как магазин.
- [x] Resource Card выглядит как товар.
- [x] Resource Detail выглядит как product page.
- [x] Resources имеют real cover.
- [x] Resources могут иметь screenshots.
- [x] Existing resources без media продолжают работать.
- [x] Search реально работает.
- [x] Categories реально работают.
- [x] Filters реально работают.
- [x] Sorting реально работает.
- [x] Popularity основана на реальных данных (COMPLETED purchases).
- [x] URL сохраняет discovery state.
- [x] Homepage использует реальные product sections.

RESOURCE
- [x] Cover отображается.
- [x] Gallery работает (с лайтбоксом).
- [x] Seller identity отображается и ведёт на витрину.
- [x] Rating отображается.
- [x] Reviews отображаются.
- [x] Versions отображаются (+ v-бейдж в hero).
- [x] Compatibility отображается только при наличии реальных данных
      (validation status — только в admin moderation).
- [x] Purchase/Get flow продолжает работать.

SELLER
- [x] Seller может добавить cover.
- [x] Seller может добавить screenshots.
- [x] Seller видит preview.
- [x] Seller storefront работает.
- [x] Seller видит свои resources.
- [x] Published resources доступны покупателям.

ADMIN
- [x] Admin видит полноценный product presentation.
- [x] Admin видит media.
- [x] Admin может approve/reject.
- [x] Existing moderation state machine не сломана.

UX
- [x] Desktop работает.
- [x] Mobile работает.
- [x] Search/filter/sort удобны.
- [x] Empty states понятны.
- [x] Loading states качественные.
- [x] Error states понятные.
- [x] Accessibility не регрессировала.
- [x] Navigation consistent.

TECHNICAL
- [x] Existing PLAN-001 E2E проходит.
- [x] Новые PLAN-003 E2E проходят.
- [x] Backend tests проходят (253/254; 1 pre-existing flake, не регрессия).
- [x] Web typecheck проходит.
- [x] Server typecheck проходит.
- [x] Production build проходит (web + server).
- [x] Нет критических console/runtime errors.
- [x] Нет fake functionality.
- [x] Нет глобального ненужного refactor.
- [x] Нет новых параллельных subsystem без необходимости.

==================================================
ИЗВЕСТНЫЕ ОГРАНИЧЕНИЯ (честные границы)
==================================================

- Медиа хранится локально в UPLOAD_DIR (S3-путь реализован в коде, но в
  dev-контуре выключен — S3_ENABLED=false).
- Замена cover старых ресурсов не выполнялась (миграция не требовалась:
  coverUrl nullable, типографический fallback работает).
- Compatibility/requirements/features на странице ресурса показываются
  только при наличии реальных данных — сейчас их нет, UI не придумывает.
- Rating/popular сортировки берут до 1000 ресурсов в память (dev-масштаб);
  для production потребуется SQL-агрегация.
- Rate limits dev-контура (.env) подняты для E2E прогонов
  (AUTH/STANDARD 2000, LOGIN 500, REFRESH 400) — для production значения
  должны быть пересмотрены.

==================================================
ПОСЛЕ PLAN-003
==================================================

Автоматически PLAN-004 не создаётся. Фактическое состояние зафиксировано
в PROJECT.md и CURRENT.md; следующий план определяется отдельно.
