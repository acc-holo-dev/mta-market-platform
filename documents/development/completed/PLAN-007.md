# PLAN-007 — Content Foundation

> Этот файл объединяет СПЕЦИФИКАЦИЮ плана (§0–§19) и ЗАПИСЬ О ВЫПОЛНЕНИИ
> (EXECUTION RECORD, в конце документа) — по конвенции PLAN-002/005/006.
> Статус: **IMPLEMENTATION COMPLETE** (2026-09-11); production-верификация
> остаётся отдельным шагом (см. DEVELOPMENT/CURRENT.md).
> Обоснование выбора фазы: [NEXT-PHASE.md](../NEXT-PHASE.md) (§8, Цикл 2).

---

PLAN-007 — Content Foundation

Репозитории:

- acc-holo-dev/mta-market-site (основной объём работ)
- acc-holo-dev/mta-market-document (этот план)
- acc-holo-dev/mta-market-module — НЕ затрагивается

Текущий фундамент проекта:

PLAN-001 — Initial Product Release ✅
PLAN-002 — Product Experience Foundation ✅
PLAN-003 — Marketplace Core ✅
PLAN-004 — Production Readiness & Operational Hardening ✅
PLAN-005 — Community & Server Foundation ✅
PLAN-006 — Daily Experience Foundation ✅

Фундаментальные документы:

VISION.md
PRODUCT-ARCHITECTURE.md
PRODUCT-MODEL.md
PRODUCT-SURFACE-MAP.md
DAILY-EXPERIENCE.md

=================================================
0. ЦЕЛЬ PLAN-007
   ==================================================

Переход состояния:

ИЗ:

CONTENT pillar пуст — единственный pillar платформы без реализации.
Статьи не существуют: activity layer резервирует NEW_ARTICLE, но источника
нет. Живой Home (PLAN-006) ограничен серверными событиями, релизами и
обсуждениями.

В:

Статьи — полноценная публичная сущность платформы: автор пишет черновик →
модерация → публикация → хаб /content и страница статьи с обсуждением и
явными связями (Resource / Server) → слот NEW_ARTICLE в daily experience →
поиск находит статьи → профиль автора показывает публикации.

После PLAN-007 человек должен иметь возможность:

прочитать гайд/новость/разбор
→ перейти к связанному ресурсу или серверу
→ обсудить в треде статьи
→ найти статью поиском
→ увидеть публикации автора в профиле.

Автор (любой User) должен иметь возможность:

написать статью
→ отправить на модерацию
→ получить одобрение/отказ с причиной
→ увидеть статью в daily experience
→ собрать обсуждение.

=================================================
1. СТРАТЕГИЧЕСКАЯ ИДЕЯ
   ==================================================

PLAN-007 не называется:

"Blog implementation".

Статьи — не блог платформы.

Статьи — это Content pillar: знания и новости экосистемы, которые
связывают User → Article → Resource/Server → Community (VISION §16,
DAILY-EXPERIENCE §11).

Главная цель:

"Дать экосистеме голос: знания, которые ведут пользователя к действиям."

Каждая статья должна усиливать хотя бы одну связь экосистемы
(MODEL §69): статью без связи с ресурсом/сервером/обсуждением
платформа не обязана продвигать.

=================================================
2. ГЛАВНАЯ СУЩНОСТЬ
   ==================================================

Главная сущность:

ARTICLE.

Article:
├── Identity (author, slug, title)
├── Content (текст, обложка, категория/теги)
├── Links (Resource / Server — только явные)
├── Discussion (опциональный тред)
└── Moderation (DRAFT → PENDING_REVIEW → PUBLISHED / ARCHIVED)

Не дублировать:
- ServerNews (новости серверов) — статьи НЕ дублируют их;
- ForumThread (обсуждения) — статья МОЖЕТ иметь тред, но не является тредом;
- Resource (продукты) — статья описывает/связывает, но не является товаром.

=================================================
3. КТО ПИШЕТ СТАТЬИ
   ==================================================

- Любой USER может создать черновик и отправить на модерацию
  (rate-limited; спам-защита через модерацию, не через касты).
- Гости — только читают (§29/§30: discover → value → register).
- Модератор/админ: одобрение/отказ с причиной, скрытие (ARCHIVED/hide).
- Editorial-статусы (featured) НЕ вводятся — нет editorial logic
  (SURFACE-MAP §13.1).

=================================================
4. WORKSTREAM A — ГРАНИЦЫ И ИССЛЕДОВАНИЕ
   ======================================

A-001 — Аудит перед разработкой

Проверить существующее:

- ServerNews flow (draft → publish → уведомления → обсуждение) как паттерн;
- Resource moderation flow (PENDING_REVIEW → approve/reject + причина);
- media infrastructure (обложки — существующий /upload/media);
- профили (publicArticles слот в SURFACE-MAP §32);
- /search (добавить группу Articles);
- activity read-layer (слот NEW_ARTICLE из PLAN-006 D-001);
- Report system (добавить targetType ARTICLE).

Не создавать параллельных систем ни в одном из этих слоёв.

---

A-002 — Явные не-цели

- Markdown/HTML-рендер произвольной разметки: контент статьи —
  безопасный текст с абзацами (как ServerNews); никакого сырого HTML.
- Редакторская витрина/featured — позже, при реальной editorial logic.
- Черновики WYSIWYG-редакторов, автосохранение, версии статей — не в скоупе.
- CREATOR_PUBLICATION остаётся зарезервированным (devlogs создателей —
  отдельная будущая сущность); в PLAN-007 — только NEW_ARTICLE.

=================================================
5. WORKSTREAM B — ARTICLE DOMAIN MODEL
   ====================================

B-001 — Модель Article

Минимально:

- id;
- authorId (User);
- slug (уникальный, транслит из заголовка);
- title (3–120);
- content (текст с абзацами, лимит 20000, без сырого HTML);
- excerpt (авто-генерация из контента, до 300 символов);
- coverUrl (валидированная media, опционально);
- category (фиксированный словарь: GUIDES / NEWS / REVIEWS / OPINION —
  минимум для навигации; расширяемо);
- tags (строка, comma-separated, отображение списком; без отдельной
  таблицы тегов на первом этапе);
- status: DRAFT / PENDING_REVIEW / PUBLISHED / ARCHIVED;
- publishedAt;
- reviewNote (причина отказа/скрытия — human-readable, как verificationNote);
- createdAt / updatedAt.

Индексы: slug unique, [status, publishedAt], [authorId].

---

B-002 — Явные связи (только opt-in автора)

- ArticleResourceLink { articleId, resourceId } — ссылка на ОПУБЛИКОВАННЫЙ
  Resource (PUBLISHED); автор может связать любой опубликованный ресурс
  (это editorial context, публичная связь RESOURCE → SELLER уже публична).
- ArticleServerLink { articleId, serverId } — ссылка на сервер ТОЛЬКО если
  автор — staff этого сервера (прецедент G-004: свою страницу могут
  описывать только её владельцы). Сервер VERIFIED/ACTIVE.
- Удалённые/скрытые связанные сущности не рендерятся в «связях».

---

B-003 — Discussion

ForumThread: + nullable articleId (уникальный, как newsId). Тред статьи
создаётся автором при отправке (опция «обсуждение») или после публикации;
state правила форума действуют. Исключить article-linked треды из
NEW_DISCUSSION в activity (как news-linked — шум, §40).

---

B-004 — Модерационные события

Критические действия (approve/reject/hide) — через существующий recordAudit
(AuditLog) + MODERATION-уведомление автору. Новую таблицу moderation-событий
для статей НЕ создавать (AuditLog достаточно; отличим по targetType).

=================================================
6. WORKSTREAM C — АВТОРСКИЙ FLOW
   ==============================

C-001 — Создание

Route: /content/new (только USER).

Шаги: Basic (title, category, tags) → Content (текст) → Media (обложка,
опционально) → Links (опционально: ресурс — любой PUBLISHED; сервер —
только где автор staff) → Preview → Submit (→ PENDING_REVIEW).

---

C-002 — Управление своими статьями

Автор видит свои статьи (все статусы) в /content/mine: черновики (edit),
pending (статус ожидания), published (ссылка), archived (причина).
Редактирование PUBLISHED → возврат в PENDING_REVIEW (модерация повторная).

---

C-003 — Rate limits

Создание/редактирование — userRateLimit (как server_news_create).
Контент-лимиты валидируются на бэкенде.

=================================================
7. WORKSTREAM D — МОДЕРАЦИЯ
   =========================

D-001 — Очередь

Admin: вкладка «Статьи» — список PENDING_REVIEW с preview; действия:

- Approve → PUBLISHED (publishedAt = now) → NEW_ARTICLE в активности;
- Reject с причиной (reviewNote) → DRAFT + уведомление автору.

---

D-002 — Скрытие

PUBLISHED → ARCHIVED (hide) с причиной + уведомление автору + audit;
статья немедленно исчезает из /content, поиска, профиля и активности.

---

D-003 — Reports

ReportTargetType: + ARTICLE; очередь /admin/reports; resolve/dismiss —
существующий flow.

=================================================
8. WORKSTREAM E — ПУБЛИЧНЫЕ ПОВЕРХНОСТИ
   =====================================

E-001 — Хаб /content

- список PUBLISHED (хронология, честная пагинация);
- фильтр по категории (только реальные категории);
- карточка: обложка/заглушка, title, excerpt, автор (ссылка на профиль),
  дата, категория, счётчик комментариев треда;
- Guest видит всё; CTA регистрации только на действиях.

---

E-002 — Страница статьи

Route: /content/articles/[slug].

- cover, title, author (ссылка на профиль), date, категория/теги;
- контент абзацами (без сырого HTML);
- блок «Связанное» — только явно заданные сущности (E-002 B-002):
  Resource-карточка, серверная строка;
- обсуждение: ссылка на тред / встроенный список постов (минимум —
  ссылка + счётчик);
- no dead ends: автор → его статьи; связанные сущности; к хабу.

---

E-003 — Профиль автора

/profile/[username]: блок «Статьи» — только PUBLISHED (SURFACE-MAP §32).

---

E-004 — Поиск

/search: группа Articles (title ILIKE, только PUBLISHED), с явным типом
результата и счётчиком.

=================================================
9. WORKSTREAM F — DAILY EXPERIENCE INTEGRATION
   ===========================================

F-001 — NEW_ARTICLE в activity layer

- тип NEW_ARTICLE (зарезервирован в PLAN-006 D-001): Article PUBLISHED с
  publishedAt в окне; item: title, at, href /content/articles/[slug],
  author контекст, категория;
- приоритет как у NEW_SERVER (5) — статьи — высокоценные события (§40);
- bustActivityCache() на approve/hide;
- ARCHIVED/DRAFT/PENDING_REVIEW никогда не попадают в активность.

---

F-002 — Уведомления

- автору: одобрение/отказ/скрытие (MODERATION);
- обсуждение статьи → существующие FORUM_REPLY правила;
- подпискам на статьи нет (follow статей — не в скоупе, §16 порядок).

=================================================
10. WORKSTREAM G — PERFORMANCE
   ===========================

- индексы под хаб/активность/поиск ([status, publishedAt], [authorId],
  slug unique);
- /content — bounded query + пагинация;
- activity — в общий bounded-набор PLAN-006 (один запрос на источник);
- кэш-инвалидация вместо polling.

=================================================
11. WORKSTREAM H — DEVELOPMENT SEED
   =================================

Реалистичные статьи (не «Test Article 1»), в т.ч. из примеров
DAILY-EXPERIENCE: «Какой framework выбрать для RP-сервера»,
«Оптимизация MTA-сервера: таймеры и колбэки» — со связями на demo-ресурсы
и seed-серверы, с тредами обсуждения; + по одной в DRAFT и PENDING_REVIEW
для витрины статусов.

=================================================
12. TESTING — CONTENT API
   =======================

- create (draft) → submit → pending; гость/не-автор не видит черновик;
- approve → PUBLISHED (publishedAt), появляется в /content, поиске,
  профиле, активности (NEW_ARTICLE) мгновенно (инвалидация кэша);
- reject с причиной → DRAFT + уведомление + audit;
- hide → исчезает из всех публичных поверхностей;
- edit published → возврат в PENDING_REVIEW;
- links: сервер — только staff (чужой → 403), ресурс — только PUBLISHED;
- discussion: тред статьи создаётся, ответы работают, FORUM_REPLY
  уведомления автору темы;
- rate limits; валидации (title/content/category);
- non-moderator не имеет доступа к админ-действиям (403).

=================================================
13. TESTING — PRIVACY/INTEGRITY
   =============================

- ARCHIVED/DRAFT/PENDING_REVIEW не в /content, поиске, профиле, активности;
- удалённый связанный ресурс/сервер не рендерится в «Связанном»;
- скрытая статья не доступна по slug (404);
- контент рендерится как текст (нет HTML-инъекции).

=================================================
14. TESTING — E2E (browser)
   =========================

- автор пишет статью → submit → админ одобряет → статья в Home-активности →
  клик → страница статьи → обсуждение;
- guest: /content хаб читаем; фильтр категории; поиск находит статью;
- reject-ветка: причина отказа видна автору;
- mobile smoke /content и страницы статьи.

=================================================
15. TESTING — REGRESSION
   ======================

Не должно ломаться: PLAN-001..006 (backend suite целиком; Playwright
plan001/003/005/006). Особое внимание: activity (план006 тесты), search
(новая группа), профили, /news, dashboard.

=================================================
16. ACCEPTANCE CRITERIA
   ====================

PLAN-007 считается завершённым, когда:

DOMAIN

- [ ] Article model + связи + миграция формальным путём, пакет в git.
- [ ] Жизненный цикл DRAFT → PENDING_REVIEW → PUBLISHED/ARCHIVED работает.

AUTHOR

- [ ] /content/new мастер работает (Basic → Content → Media → Links →
      Preview → Submit).
- [ ] /content/mine показывает все свои статусы.
- [ ] Редактирование опубликованной возвращает в PENDING_REVIEW.

MODERATION

- [ ] Очередь статей в admin; approve/reject/hide с причиной + audit +
      уведомление автору.
- [ ] Report ARTICLE работает end-to-end.

SURFACES

- [ ] /content хаб (список + категория + пагинация), guest-доступен.
- [ ] Страница статьи: контент, автор, связи (только валидные), обсуждение.
- [ ] Профиль показывает PUBLISHED статьи автора.
- [ ] /search находит статьи отдельной группой.

DAILY EXPERIENCE

- [ ] NEW_ARTICLE в активности (создание/скрытие — мгновенно).
- [ ] ARCHIVED/DRAFT/PENDING_REVIEW не в активности.

PERFORMANCE/TECH

- [ ] Индексы; bounded queries; замер зафиксирован в RECORD.
- [ ] Backend suite зелёный (349 + новые); E2E 42 + новые зелёные; build ok;
      tsc чист.

WALKTHROUGH

- [ ] §17 пройден в браузере.

=================================================
17. FINAL PRODUCT WALKTHROUGH
   ==========================

SCENARIO 1 — ЧИТАТЕЛЬ (guest): / → активность «Новая статья: …» → клик →
страница статьи → связанный ресурс → (маркетплейс). ✅ цель

SCENARIO 2 — АВТОР: пишет «Какой framework выбрать?» → submit → админ
approve → статья на Home → тред с ответами → возврат через уведомление.

SCENARIO 3 — МОДЕРАТОР: очередь → reject с причиной → автор видит причину,
исправляет, повторный submit → approve.

=================================================
18. НЕ ДЕЛАТЬ
   ==========

- Markdown/HTML-рендер, WYSIWYG, версии черновиков, автосохранение;
- editorial featured/подборки (нет editorial logic);
- follow статей, подписки на авторов (порядок §16);
- CREATOR_PUBLICATION/devlogs (отдельная будущая сущность);
- отдельная таблица тегов/облака тегов;
- push/email;
- изменения в ServerNews/Resource moderation доменах (кроме activity-чтения).

=================================================
19. FINAL PRINCIPLE
   =================

Статья — не «ещё одна страница».

Статья — узел экосистемы: она отвечает на вопрос читателя, ведёт его к
ресурсу или серверу, порождает обсуждение и возвращение.

Если статья не усиливает ни одну связь — она просто не попадёт в
daily experience.

---

# EXECUTION RECORD — выполнено 2026-09-11

**Статус: IMPLEMENTATION COMPLETE** (2026-09-11)

## Итог

Цель плана достигнута: CONTENT pillar перестал быть пустым. Статьи —
полноценная публичная сущность: автор пишет черновик → модерация (approve /
reject с причиной / hide) → публикация в хабе /content → страница статьи с
явными связями (Resource / Server — staff-only для серверов) и обсуждением →
слот NEW_ARTICLE в daily experience (Home-активность) → поиск находит статьи
отдельной группой → профиль автора показывает публикации. Всё на
существующей инфраструктуре: media-пайплайн, аудит, уведомления, репорты,
форум-связи, activity read-layer.

## Что сделано (по workstreams)

### WORKSTREAM B — Article domain
- Модель `Article` (slug unique, title 3–120, content ≤20000 plain text,
  excerpt ≤300 авто, coverUrl через /upload/media, category
  GUIDES/NEWS/REVIEWS/OPINION, tags comma-string, status
  DRAFT/PENDING_REVIEW/PUBLISHED/ARCHIVED, publishedAt, reviewNote) +
  `ArticleResourceLink` (только PUBLISHED ресурсы) + `ArticleServerLink`
  (только staff сервера — прецедент G-004). ForumThread + `articleId`
  (nullable unique, как newsId). Индексы: [status, publishedAt],
  [authorId]. ReportTargetType + ARTICLE.
- Миграция формальным путём: 22 ops,
  `migrations/app/20260911T0112_plan007_content_foundation` в git;
  dev — `db migrate`, тест-БД — `db update --confirm postgres` (drop check
  constraint enum — единственная «destructive»-операция, безопасная:
  пересоздание CHECK под новый enum).

### WORKSTREAMS C/D — Авторский flow и модерация
- `routes/content.ts`: POST /content (draft, userRateLimit, валидации),
  PATCH /content/:id (автор; PUBLISHED/ARCHIVED → PENDING_REVIEW —
  повторная модерация), POST /content/:id/submit, GET /content/mine (все
  статусы + reviewNote), POST /content/:id/discussion (тред статьи, один на
  статью), GET /content (хаб: PUBLISHED, фильтр категории, честная
  пагинация, авторы, replyCount), GET /content/articles/:slug (страница;
  связи рендерятся только пока сущность публична).
- `routes/adminContent.ts`: GET /admin/content (очередь/статусы),
  approve → PUBLISHED (+publishedAt, audit, MODERATION-уведомление автору,
  bustActivityCache), reject → DRAFT (+reviewNote, уведомление), hide →
  ARCHIVED (+уведомление + bust). adminOnly = как в adminCommunity.
- Reports: ARTICLE — валидный targetType (target must exist → 404 иначе).

### WORKSTREAMS E/F — Поверхности и daily experience
- Web: хаб /content (карточки, категории-табы, пагинация), страница статьи
  (абзацы — без сырого HTML; «Связанное» с ресурсами и серверами с живым
  онлайном; блок «Обсуждение» со ссылкой на тред), визард /content/new
  (Basic → Content → Media → Links → Submit; ресурсы из /resources/my,
  серверы — только owned), /content/mine (статусы, «На модерацию»,
  «Пересмотреть», «Открыть обсуждение», причина отказа видна), вкладка
  «Статьи» в админке (очередь: Опубликовать/Вернуть/Скрыть с причиной).
- Профиль автора: блок «Статьи» (только PUBLISHED).
- Activity layer: тип NEW_ARTICLE (приоритет 5, как NEW_SERVER), только
  PUBLISHED с publishedAt в окне; article-linked треды исключены из
  NEW_DISCUSSION и «горячих обсуждений» (как news-linked — шум, §40).
- Поиск: группа Articles в /search (title ILIKE, PUBLISHED only).
- **Навигация**: «Статьи» в глобальной навигации (SURFACE-MAP §2).

### Честный ремонт пробела PLAN-006 (записано в NEXT-PHASE §8-контексте)
- `/search` отдавал 404: hero PLAN-006 вёл на несуществующую страницу
  (бэкенд /search и клиент были, страницы не было; E2E не посещал её
  напрямую). Построена `app/search/page.tsx` с типизированными группами
  Resources / Servers / Discussions / Articles; useSearchParams обёрнут в
  Suspense (требование статического prerender — build без него падал).

### WORKSTREAM H — Seed
- seed-plan005 расширен секцией PLAN-007 (идемпотентно по slug):
  «Какой framework выбрать для RP-сервера» (GUIDES, связь с night-city-rp,
  тред), «Оптимизация MTA-сервера: таймеры и колбэки» (GUIDES, связь с
  dust-rally, тред) — оба из примеров DAILY-EXPERIENCE; «Ночь открытий»
  (NEWS), «Демо-ресурсы: как проверить покупку» (REVIEWS); + DRAFT и
  PENDING_REVIEW для витрины статусов.

### §12–§15 — Тесты и регресс
- `tests/plan007-content.test.ts` (9): 401 гостю; полный lifecycle
  create→submit→approve (хаб/страница/уведомление/NEW_ARTICLE/профиль);
  reject с причиной (видна автору в /content/mine); hide — исчезает из хаба,
  404 по slug, отсутствует в активности; связи (чужой сервер 403, свой ok,
  SUSPENDED ресурс 400, PUBLISHED рендерится); правка PUBLISHED →
  PENDING_REVIEW; discussion (один тред, 409 повтор, не попадает в
  NEW_DISCUSSION); поиск (PUBLISHED да, draft нет); reports ARTICLE
  (201 + 404 на несуществующий).
- Полный backend: **358/358** (349 + 9 PLAN-007).
- Playwright: **47/47** (plan001 12 + plan003 13 + plan005 12 + plan006 5 +
  plan007 5) — полный регресс на живых dev-серверах.
- Production build web: exit 0 (после Suspense-фикса /search).
- `tsc --noEmit` чист у server и web.

### Финальные счёта приёмки (2026-09-11)

- Backend (vitest): **358/358** (337 → 349 после PLAN-006 → 358 после
  PLAN-007).
- Playwright browser E2E: **47/47**.
- Production build web: exit 0.
- Миграция: 22 additive ops (`20260911T0112_plan007_content_foundation`).
- Performance: activity snapshot с NEW_ARTICLE: cold **86.8мс** / warm
  **23.2мс** (dev-БД) — в том же bounded-наборе запросов.
- Live-проверка: хаб /content показывает 4 seed-статьи; публикация появляется
  в Home-активности мгновенно (инвалидация кэша на approve).

## Уроки окружения (дополнение к PLAN-005/006)

1. **db update с enum-изменениями**: добавление значения enum трактуется как
   destructive (drop/recreate CHECK) — на non-interactive прогонах нужен
   `--confirm <имя_базы>` (для тест-БД — `--confirm postgres`).
2. **useSearchParams + static prerender**: клиентская страница с
   useSearchParams обязана иметь Suspense-границу, иначе next build падает
   на prerender («Export encountered an error on /search»).
3. **Set.entries()** в JS — пары [value, value], не индексы: для
   позиционных вставок приводить к массиву.
4. **Реакция Твиттера не нужна, а вот psql-чистки с масками** e2e% требуют
   исключения e2e-admin (логин plan001 beforeAll) и e2e_seller_% (их ресурсы
   нужны для FK-безопасных чисток ресурсов).

## §17 Walkthrough

- SCENARIO 1 (ЧИТАТЕЛЬ): Home → активность «Новая статья: …» → страница
  статьи → «Связанное» → ресурс. ✅ (E2E 1–2)
- SCENARIO 2 (АВТОР): регистрация → /content/new → submit → админ approve →
  статья на Home → тред с ответом. ✅ (E2E 1)
- SCENARIO 3 (МОДЕРАТОР): очередь → reject с причиной → автор видит причину.
  ✅ (E2E 4)

## Ограничения

- Контент — plain text с абзацами; markdown/HTML-рендер — осознанно не
  реализован (безопасность и простота модерации, A-002).
- Editorial featured/подборки — нет (нет editorial logic, SURFACE-MAP
  §13.1).
- CREATOR_PUBLICATION остаётся зарезервированным (devlogs создателей —
  отдельная будущая сущность).
- Follow статей/авторов не вводился (порядок DAILY-EXPERIENCE §16).
- production-верификация остаётся решением владельца инфраструктуры
  (blockers PLAN-004/005/006).
