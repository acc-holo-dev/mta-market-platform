# PLAN-020 — T-001/T-002/T-003 + A-004: Simplification Audit (dead code / duplicates / moving parts)

Audit-only pass over the whole repository (site/server, site/web, site/shared, module, tests/, scripts/, config/, contracts/, infrastructure/, startup.py, root tooling). Every claim carries a file:line proof or a verbatim grep. Node_modules/.git/dist/build excluded from all searches.

Counts: **0 critical / 3 high / 8 medium / 25 low** — 36 находок, из них 9 чистых KEEP-подтверждений (проверено — проблемы нет) и 4 KEEP с косметическим FIX.

---

## T-001.01 — Фантомная зависимость `@prisma/client` 7.10.0 в site/server
- severity: high
- verdict: REMOVE
- current: `site/server/package.json:25` объявляет `"@prisma/client": "7.10.0"`, но: (а) ни один TS-файл его не импортирует — `grep -rn "@prisma/client" site/server/src site/server/scripts tests site/web/src` → 0 совпадений; (б) рантайм использует ORM-адаптер — `site/server/src/prisma/db.ts:2` `import postgres from "@prisma/orm-postgres/runtime"`; (в) записи нет в `pnpm-lock.yaml` (grep `7.10.0` и `@prisma/client` → 0) и в `node_modules/.pnpm`/`site/server/node_modules/@prisma/` (только `cli-engine`, `orm-postgres`). Т.е. package.json и lockfile разсинхронизированы.
- change: удалить строку `"@prisma/client": "7.10.0"` из site/server/package.json (зависимость фактически не установлена).
- reason: смешанный мажор (client 7.x vs prisma CLI 8.0.0-rc.13) создаёт ложную видимость стека B-001; расхождение package.json↔lockfile — риск падения `pnpm install --frozen-lockfile` в CI (.github/workflows/*.yml используют frozen-lockfile).
- risk: практически нулевой — пакет не установлен и не импортируется.
- verification: после удаления `pnpm install --frozen-lockfile` проходит; `pnpm exec vitest run tests/unit` зелёный; `grep -rn "@prisma/client" site/server/src` остаётся пустым.

## T-001.02 — lib/prisma.ts: мёртвый wrapper над db.orm.public
- severity: low
- verdict: REMOVE
- current: `site/server/src/lib/prisma.ts` — алиас `export const prisma = db.orm.public` с комментарием «Do not hand-list models here». Импортёров нет: `grep -rn '"./prisma.js"' site/server/src/lib`, `grep -rn '"../lib/prisma.js"|"@server/lib/prisma"' site/server/src tests` → 0; все потребители используют `prisma/db.js` (`site/server/src/app.ts:11`, `src/index.ts:6`).
- change: удалить файл `site/server/src/lib/prisma.ts`.
- reason: чистый forwarding-wrapper (A-003/T-001) без владельца и потребителей.
- risk: нет — файл не достигает ни одного импорта.
- verification: `grep -rn "lib/prisma\"" site/server/src tests --include='*.ts'` → пусто; `pnpm --filter @mta-market/server type-check` зелёный.

## T-001.03 — Динамический sandbox — сквозной мок + осиротевший Docker-тулинг
- severity: high
- verdict: REMOVE (мок-фазу и тулинг), FIX (честный статус в SandboxRun)
- current: (1) `site/server/src/lib/sandbox/runner.ts:118-133` — `createContainer` с комментарием «Mock implementation … Use dockerode» возвращает фантомный id; `startContainer`/`executeInContainer` аналогично; (2) `runner.ts:257-263` `isDockerAvailable()` всегда `true` («sandbox_mock_docker_available»); (3) следствие: `lib/sandbox/service.ts:71-100` на каждом аплоаде создаёт `SandboxRun` со status RUNNING и «выполняет» несуществующий контейнер — админ видит фейковые прогоны (`routes/admin.ts:147,339 getSandboxRun`); (4) тулинг `site/server/sandbox/Dockerfile` + `validate.sh` (образ `mta-sandbox:latest`) не упоминается нигде: `grep -rn "sandbox/Dockerfile|sandbox/validate" .` → только сами файлы; runner.ts:43 ожидает `image: 'mta-sandbox:latest'`, но ничего его не собирает; зависимости dockerode нет (site/server/package.json). Реальная защита — статическая валидация `lib/sandbox/static.ts` (используется `routes/versions.ts:10 validateArtifact`).
- change: удалить динамическую фазу из `validateArtifact` (оставить static-валидацию + честную запись `PENDING` с формулировкой «sandbox execution не настроен — ручная проверка»), удалить `runner.ts` и `site/server/sandbox/{Dockerfile,validate.sh}`, убрать sandbox-кнопку/ран из admin UI; SECURITY.md:119-122 переформулировать («static-only, Docker-исполнение не реализовано»).
- reason: система, которая LOOKS like sandbox-execution, но не выполняет ничего и записывает ложные артефакты в БД; тулинг не подключён ни к одному сборочному пути.
- risk: исчезнут SandboxRun-строки RUNNING/COMPLETED (сейчас они фейковые); админ-поверхность теряет «песочницу» — но честность важнее: сегодня UI демонстрирует прогоны, которых не было.
- verification: `pnpm exec vitest run tests/unit/site/sandbox-static.test.ts tests/integration/api/marketplace/publication-pipeline.test.ts` зелёные; после паблиша в SandboxRun появляются только PENDING-честные записи; `grep -rn "mta-sandbox:latest\|sandbox_mock" site/server/src` → пусто.

## T-001.04 — scripts/builds/{all,site,module}.sh — обёртки-сироты
- severity: low
- verdict: REMOVE
- current: три файла дублируют `pnpm build` / `python startup.py build|module` (site.sh — literally `exec pnpm build "$@"`; module.sh — те же cmake-пресеты, что `startup.py:1046-1066 cmd_module`). Ссылок нет: `grep -rn "builds/site.sh|builds/module.sh|builds/all.sh" documents .github startup.py package.json module` → только перекрёстные ссылки внутри самих файлов.
- change: удалить каталог scripts/builds/ (validate.yml парсит только `scripts/**/*.sh` через bash -n — удаления безопасны).
- reason: третий дублирующий вход в одну и ту же операцию; канонические входы — `pnpm build` и `python startup.py build/module`.
- risk: нет — потребителей не существует.
- verification: `grep -rn "scripts/builds" .` (без node_modules) → пусто после удаления; CI зелёный.

## T-001.05 — scripts/tests/*.sh (6 файлов) — обёртки-сироты
- severity: low
- verdict: REMOVE
- current: unit.sh/integration.sh/contract.sh/e2e.sh/security.sh/all.sh повторяют уровни `python startup.py test <tier>` (startup.py:954-1007: unit/integration/e2e/smoke) и CI-шаги (tests.yml запускает `pnpm exec vitest run`; contracts.yml — `scripts/maintenance/verify-contracts.sh`; security.yml — `scripts/maintenance/audit.sh` напрямую). Ссылок извне нет: `grep -rn "scripts/tests" documents .github startup.py` → единственное упоминание — исключающий regex в validate.yml:42.
- change: удалить scripts/tests/ целиком; в validate.yml:42 оставить regex (защита от возврата) либо почистить.
- reason: пятый дублирующий путь запуска тестов; реальный запуск идёт через startup.py test и CI-workflows.
- risk: нет — CI не вызывает эти скрипты.
- verification: `bash -n` в validate.yml зелёный; `grep -rn "scripts/tests" .github` — только строка-исключение.

## T-001.06 — scripts/maintenance/cleanup.sh — дубликат `startup.py clean`
- severity: low
- verdict: REMOVE
- current: cleanup.sh удаляет те же артефакты, что и `cmd_clean` (startup.py:1149-1201: .next, dist, module/build, .turbo, test-results, playwright-report, *.tsbuildinfo, __pycache__). Ссылок нет: `grep -rn "cleanup.sh" .` → только сам файл; в документации зафиксирован `python startup.py clean` (documents/operations/DEVELOPMENT.md:109-110, PLAN-017.md:328).
- change: удалить scripts/maintenance/cleanup.sh.
- reason: два канала одной операции с уже разной полнотой (startup.py clean также чистит temp/).
- risk: нет.
- verification: grep по репо → пусто; `python startup.py clean` работает.

## T-001.07 — scripts/deployments/{healthcheck,rollback}.sh — не подключены
- severity: low
- verdict: REMOVE
- current: healthcheck.sh (curl /health /live /ready) дублирует `run_smoke` (startup.py:1010-1021); rollback.sh повторяет откат через `IMAGE_TAG=<tag> docker compose up` (deploy.sh уже хранит предыдущий тег и делает rollback — documents/operations/DEPLOYMENT.md:113, PRODUCTION.md:116). Ссылок нет: `grep -rn "rollback.sh|healthcheck.sh" documents .github` → только documents/history/MIGRATION.md:27 (историческая запись о создании).
- change: удалить оба файла; если rollback-команда нужна как отдельный вход — сделать подкоманду deploy.sh (MERGE), а не параллельный скрипт.
- reason: недокументированные параллельные входы; канонический путь — deploy.sh/startup.py.
- risk: операторы, привыкшие к ручному вызову, потеряют скрипт — но он нигде не задокументирован (PRODUCTION.md:116 описывает откат через deploy.sh).
- verification: `grep -rn "rollback.sh|healthcheck.sh" documents/operations` → пусто и после удаления; deploy-пайплайн не меняется.

## T-001.08 — scripts/development/seed.py — дубликат `startup.py db seed`
- severity: low
- verdict: REMOVE
- current: seed.py запускает те же tsx-скрипты (dev-admin/seed-plan003/seed-plan005/seed-services/dev-heartbeat), что и `SEED_SCRIPTS` в startup.py:770-791; единственная связь с CI — `python3 -m py_compile startup.py scripts/development/*.py` (validate.yml:47). Ссылок на сам скрипт нет (`grep -rn "seed.py" .` → сам файл + его docstring).
- change: удалить scripts/development/seed.py; сузить glob в validate.yml до `startup.py`.
- reason: два канала сиддинга с расходящимися значениями (seed.py: `admin@dev.local/dev-password-123` vs startup.py: pnpm test:e2e:admin) — источник «а какой seed правильный?».
- risk: нет; dev-серфинг через `python startup.py db seed` сохраняется.
- verification: `python startup.py db seed admin` работает; `grep -rn "seed.py" .` → пусто.

## T-001.09 — Мёртвые экспорты config/loader.ts
- severity: medium
- verdict: REMOVE
- current: из loader.ts реального потребителя имеют только `loadApplication`+`featureFlags` (site/server/src/lib/featureFlags.ts:57, site/server/src/routes/config.ts:13). Мертвы: `loadEnvironment()` (loader.ts:277 — `grep -rn "loadEnvironment" .` → только определение), тип `EnvironmentConfig` (loader.ts:24 — внешних использований нет), `rateLimitsFor()` (loader.ts:357 — 0 потребителей; сервер берёт лимиты из env, инжектируемых startup.py:413-414, а rateLimit.ts читает process.env напрямую, rateLimit.ts:68/75/85). Также `parseYamlSubset`/`validateAgainstSchema` экспортированы, но используются только внутри модуля.
- change: удалить loadEnvironment/EnvironmentConfig/rateLimitsFor; снять `export` с parseYamlSubset/validateAgainstSchema (или оставить экспорт для будущего теста паритета — см. T-002.06).
- reason: мёртвая половина «канонического загрузчика»: env-конфиг читает только startup.py, loader.ts обслуживает лишь feature-flags.
- risk: нет; при появлении env-конфига в рантайме функция восстанавливается из git.
- verification: `pnpm --filter @mta-market/server type-check` зелёный; `grep -rn "rateLimitsFor|loadEnvironment" site/server/src` → пусто.

## T-001.10 — config-ключ windowsMs: загружается, никем не потребляется
- severity: low
- verdict: SIMPLIFY
- current: `config/application/limits.yaml:35-40` объявляет windowsMs; `config/schemas/application.schema.json:30` его валидирует; `site/server/src/config/loader.ts:335` загружает в ApplicationConfig.windowsMs — но ни один потребитель не читает это поле (`grep -rn "windowsMs" site/server/src` → только loader.ts), а rateLimit.ts:29/68/75/85 хардкодит windowMs-пресеты; startup.py load_limits (startup.py:322-338) windowsMs тоже игнорирует. Комментарий в limits.yaml признаёт: «documented intent; the server keeps its presets».
- change: либо (а) пробросить windowsMs в rateLimit-фабрики и убрать хардкод, либо (б) удалить windowsMs из limits.yaml+schema+loader и перенести значения в комментарий. Вариант (а) предпочтителен — тогда config реально «one source of truth».
- reason: третий вид мёртвой конфигурации: валидируемый, загружаемый, неиспользуемый.
- risk: при варианте (а) — изменение окна лимитов, если значения в yaml расходятся с хардкодом (сейчас совпадают: 900000/60000).
- verification: `grep -rn "windowsMs" site/server/src/lib/rateLimit.ts` после (а) показывает чтение из config; integration-тесты rate-limit зелёные.

## T-001.11 — Плейсхолдер-каталоги без потребителей: logs/{audits,builds,deployments,security}, temp/{build,generated,reports,screenshots,work,test}
- severity: low
- verdict: REMOVE
- current: в `logs/` живёт только `logs/development` (startup.py:56,622,638); `logs/{audits,builds,deployments,security}/` содержат лишь .gitkeep и не упоминаются кодом (`grep -rn "logs/audits|logs/builds|logs/deployments|logs/security" .` → 0). Из temp/ используется `temp/runtime` (startup.py:55) и temp/ целиком в cmd_clean; `temp/{build,generated,reports,screenshots,work,test}/` не упомянуты нигде (playwright пишет в корневые playwright-report/test-results — playwright.config.ts, cmd_clean startup.py:1157-1158).
- change: удалить пустые каталоги (или сократить до реально используемых), поправив соответствующие .gitkeep.
- reason: фантомная структура наводит на мысль о процессах (аудиты/билды/деплой-логи), которых нет.
- risk: нет; validate.yml требует существование `logs/` (не подкаталогов).
- verification: validate.yml «Logs policy» и «No duplicate structure roots» зелёные.

## T-001.12 — Корневой CMake-суперпроект не используется
- severity: low
- verdict: REMOVE
- current: `CMakeLists.txt` (корень) только forwarding `add_subdirectory(module)`; `CMakePresets.json` (корень) — дублирует пресеты. Все каналы сборки работают в module/: CI `cmake --preset linux-gcc` с working-directory: module (module.yml) и `cmake --preset linux-gcc -S module` (release.yml:60), startup.py cmd_module делает cwd=module (startup.py:1058), docs тоже (`documents/module/BUILD.md:14`). module/tools/mta/cli.py:163 читает module/CMakePresets.json (root = module root, cli.py:36 SDK_ROOT), не корневой.
- change: удалить корневые CMakeLists.txt и CMakePresets.json (упоминание в documents/history — архив, не потребитель).
- reason: второй, неиспользуемый вход в сборку модуля; `python startup.py build` и CI его не трогают.
- risk: нет; модуль собирается автономно (cd module).
- verification: `python startup.py build` и module.yml зелёные; `grep -rn "CMakePresets" module/tools/mta/cli.py` указывает на module/-путь.

## T-001.13 — scripts/development/repair-cyrillic.cjs: документирован как CI-гейт, но в CI не подключён
- severity: medium
- verdict: FIX
- current: скрипт имеет `--check` режим с пометкой «CI-usable» и в documents/architecture/TESTING.md:127 заявлен как CI-гейт («node scripts/development/repair-cyrillic.cjs --check (CI-гейт)»), но ни один workflow его не вызывает (`grep -rn "repair-cyrillic" .github` → 0; только CURRENT.md:79 и PLAN-014.md как исторические).
- change: либо добавить шаг в validate.yml (`node scripts/development/repair-cyrillic.cjs --check`), либо убрать обещание из TESTING.md. Скрипт одноразовый по природе — если повторная порча CP1251 невозможна, честнее перенести в documents/history-описание и удалить скрипт.
- reason: расхождение документ↔код (U-004): заявленный гейт не существует.
- risk: минимальный (добавление шага может вскрыть现存 mojibake — тогда это находка, а не риск).
- verification: при добавлении — шаг в validate.yml зелёный; `grep -rn "repair-cyrillic" documents/architecture/TESTING.md` согласован с наличием/отсутствием шага.

## T-001.14 — Типы в runtime-зависимостях сервера
- severity: low
- verdict: FIX
- current: `@types/multer` (site/server/package.json:27) и `@types/nodemailer` (:28) лежат в `dependencies`, хотя это compile-time-only типы (рантайм-импорты: multer — lib/upload.ts, routes/upload.ts; nodemailer — lib/email.ts).
- change: перенести обе записи в devDependencies.
- reason: корректная семантика зависимостей; влияет на `pnpm audit --prod` и размер prod-образа.
- risk: нет.
- verification: `pnpm install --frozen-lockfile` + `pnpm --filter @mta-market/server type-check` зелёные.

## T-001.15 — supertest/@types/supertest/vitest в devDeps сервера — дубли root
- severity: low
- verdict: REMOVE
- current: все тесты живут в корневом tests/ (PLAN-010 Rule 002, vitest.config.ts:4-9) и импортируют supertest из корневых node_modules; внутри site/server/src и site/server/scripts supertest/vitest не импортируются (`grep -rn "supertest|vitest" site/server/src site/server/scripts` → только комментарии). Root package.json:30-33 уже содержит supertest, @types/supertest, vitest.
- change: убрать `supertest`, `@types/supertest`, `vitest` из site/server devDependencies (проверить, что tsc --noEmit не подтягивает их типы; vitest-типов в src нет).
- reason: дубли между workspace-девДепами; одна копия на корень достаточна.
- risk: низкий — если server tsconfig внезапно требует vitest/supertest types, type-check подсветит.
- verification: `pnpm --filter @mta-market/server type-check` и `pnpm exec vitest run tests/unit` зелёные после удаления.

## T-001.16 — Подтверждённо ЖИВЫЕ системы (проверено, не трогать)
- severity: low
- verdict: KEEP
- current/evidence:
  - `module/tools/*`: docgen.cpp — module/CMakeLists.txt:324 (`sdk_docgen`) + cli.py:469-486; spike_luac.cpp — CMakeLists.txt:297-307 (фикстура protected.luac); mock-server — cli.py:385,728-804; cli.py — .github/workflows/module.yml (CLI smoke, integration); tests/module/test_harness.py исполняется через `python3 -m unittest discover -s tests/module` (module.yml «Python harness unit tests»).
  - демо-функции модуля (functions/basics|async|bench…) — саморегистрация + все имена sample_* покрыты lua-тестами (tests/module/runtime/scripts, 9-1 упоминаний на функцию) и documents/module/EXAMPLE.md:54-502.
  - `site/server/scripts/*`: dev-admin (root package.json:20 test:e2e:admin; e2e.yml), seed-plan003/005 (e2e.yml; startup.py SEED_SCRIPTS), seed-services + lib/png.ts (startup.py:770-776; seed-plan003.ts:20), dev-heartbeat (e2e.yml; startup.py), generate-drm-vectors.ts — прovenance-генератор committed `contracts/drm/v2/vectors.json:3`, его выход проверяет tests/unit/site/drm-vectors.test.ts.
  - `scripts/maintenance/{audit,verify-contracts}.sh` — CI (security.yml:audit, contracts.yml:verify); `scripts/database/*` и `scripts/deployments/deploy.sh` — задокументированы (documents/operations/DEPLOYMENT.md:30-56, BACKUP-RESTORE.md:4-26).
  - `site/server/src/cli/drm.ts` — package.json scripts drm:* (site/server/package.json:15-18); console.* в нём — допустимо для CLI.
- change: ничего.
- reason: поиск сирот для этих зон дал 0 результатов при полном grep.
- risk: —.
- verification: —.

---

## T-002.01 — Канонические ошибки: модуль есть, внедрения нет (46/48 роутов ad-hoc)
- severity: high
- verdict: FIX (внедрить), иначе REMOVE
- current: `site/server/src/lib/errors.ts` (PLAN-019 E-004/E-005: ApiError, toErrorPayload, canonicalCodeForStatus) имеет НОЛЬ потребителей: `grep -rn "lib/errors|ApiError|toErrorPayload" site/server/src tests --include='*.ts'` → только сам файл. При этом 46 из 48 route-файлов отвечают ad-hoc `res.status(N).json({ error: <string|object> })` (grep `res\.status\([0-9]+\)\.json\(\{ error` → 46 файлов), включая глобальный обработчик app.ts:272 `{ error: "Internal server error" }` без code/requestId, т.е. D-003 не выполнен, хотя модуль канона существует. Сопутствующие: `dbErrors.ts` (isUniqueViolation — 9+ потребителей) и `paymentErrors.ts` (PaymentStateError/PaymentRefundError — refunds.ts/paymentStateMachine.ts/routes/payments.ts/2 теста) — не дубликаты ApiError, а доменные классификаторы; `site/shared/src/errors.ts getErrorMessage` понимает оба формата конверта (errors.ts:8-9) — веб-сторона готова к канону.
- change: в глобальном error-handler (app.ts:262-275) и JSON-404 (app.ts:279-281) отдавать `toErrorPayload(error, requestIdOf(req))`; новые/трогаемые роуты кидать ApiError; ad-hoc `res.status().json({error})` мигрировать постепенно, но заголовок «error: {code,message,requestId}» становится единым для всего API.
- reason: мёртвый канонический модуль + 46 файлов с тремя разными форматами ошибок — прямое нарушение D-003/E-004; делать заново не нужно, нужно внедрить.
- risk: клиенты, сравнивающие `error === "строка"`, увидят объект; mitigacja — shared getErrorMessage уже поддерживает обе формы (errors.ts:23-31), e2e/integration проверяют статус-коды, не тела.
- verification: grep `res\.status\(\)?\.json\(\{ error:` в routes убывает; `tests/integration/api/platform/app-security.test.ts` + новый тест на {code,message,requestId} в 404/500 зелёные.

## T-002.02 — Пагинация: schema есть, применена в 1 файле из 9
- severity: medium
- verdict: MERGE
- current: `site/server/src/lib/validation.ts:65-68 paginationSchema` (page≥1, limit 1..100, default 20) используется только `routes/resources.ts:482`. Ещё 8+ файлов парсят page/limit вручную с РАЗНЫМИ дефолтами: serverNews.ts:90-91 (10/50), serverNews.ts:392-393 (10/50), adminCommunity.ts:32-33 (20/100), sellerPayouts.ts:90-92 (20/…), news.ts:14-15 (12/50), search.ts:104 (5/20), serverReviews.ts:27 и др. (`grep -rln "req.query.page" site/server/src/routes | wc -l` → 8). На вебе то же: `Pagination/Paginated` из @mta-market/shared (shared/src/types.ts:34-41) — единые, но `normalizeListPage`+`NormalizedPage`+`asObject`/`asArray`+`isFeatureDisabledError` продублированы дословно в `lib/api/advertising.ts:24-77` и `lib/api/finance.ts:17-70`.
- change: сервер — применять paginationSchema через validate(...,"query") во всех листингах (дефолты/капы выровнять на 20/100); веб — вынести normalizeListPage/isFeatureDisabledError/asObject/asArray в `lib/api/shared.ts` (или api-ext), реэкспортировать из advertising/finance для сохранения импортов.
- reason: один контракт пагинации (D-004); расползающиеся дефолты уже дают несогласованный UX (12 против 10 против 20).
- risk: смена дефолтов limit в нескольких листингах; проверяется integration-тестами листингов; веб-хелперы — чистый рефакторинг без изменения подписей.
- verification: `grep -rn "parseInt((req.query.page" site/server/src/routes | wc -l` → 0; тесты листингов (server-news, admin-community, payouts, news) зелёные.

## T-002.03 — Логирование: одна система (подтверждение), стальное место — комментарий redis.ts
- severity: low
- verdict: KEEP (+FIX комментария)
- current: единый structured logger `lib/logger.ts` (json/pretty, redaction); маршруты логируют через `reqLog(req)` — 47/47 route-файлов (grep `reqLog` → 47); worker и jobs используют `logger` (worker/index.ts:21, jobs/*). Прямой console.* остался только в CLI (`cli/drm.ts`, 61 вхождение — CLI-вывод, это нормально) и в pre-logger startup-валидации (`lib/startupValidation.ts:212-233` — выполняется до того, как LOG_FORMAT/LOG_LEVEL гарантированно осмысленны; осознанно). Отдельный DB-слой `lib/systemLog.ts` — admin-поверхность (§44), не дубликат логгера (пишет в БД, mirrored из error-handler app.ts:270). Worker пишет и в logger, и в systemLog (worker/index.ts:11-16) — два канала с разными потребителями, не дубликат.
- change: ничего структурного; исправить заголовочный комментарий `lib/redis.ts:1` «(rate limiting, sessions)» → «rate limiting + activity cache» (сессии в PostgreSQL — lib/auth.ts, Redis сессий не касается).
- reason: T-002 запрашивал «логирование vs console vs worker logging» — дубликата нет; ложный след в комментарии.
- risk: нет.
- verification: `grep -rn "console\.(log|error|warn)" site/server/src --include='*.ts' | grep -v logger.ts` → только cli/drm.ts и startupValidation.ts.

## T-002.04 — Конфигурация: два парсера YAML/schema (startup.py ↔ loader.ts)
- severity: medium
- verdict: SIMPLIFY
- current: startup.py:94-244 содержит собственный YAML-subset-парсер и JSON-Schema-валидатор с пометкой «same semantics as site/server/src/config/loader.ts», а loader.ts:74-243 — второй экземпляр той же логики (TS). Установка «stdlib only» (startup.py:33) объясняет, почему startup.py не может импортировать TS, но семантическая синхронность не проверяется ничем — и уже расходится в деталях: bare-элемент списка `- foo` TS-парсер молча пропускает (loader.ts:99 `if (noComment.trim() === "-") return;`), а Python падает с ValueError (startup.py:147-149 «expected key: value»). Итого: невалидный конфиг отклоняется startup.py, но принимается серверным загрузчиком (деградация в defaults + warning).
- change: минимальный вариант — parity-тест: unit-тест в tests/unit, который кормит один и тот же набор конфиг-сэмплов (валидные + намеренно сломанные) в Python-парсер (spawn) и в parseYamlSubset, сверяя результат/ошибку; зафиксировать правило «bare list items → reject» в обоих. Полный вариант (одна реализация через node) противоречит stdlib-требованию doctor до установки node — не навязывать.
- reason: два нефтестируемых против друг друга парсера канонической конфигурации — типичный источник «config работает локально, падает в проде».
- risk: низкий; тест только фиксирует текущее поведение, а не меняет его.
- verification: новый тест зелёный; `python startup.py doctor` и /config/features дают одинаковый verdict на испорченном конфиге.

## T-002.05 — Деньги: одна формат-функция, сервер в minor units (без дублей)
- severity: low
- verdict: KEEP (+SIMPLIFY опционально)
- current: единственный форматтер — `formatRub` в site/shared/src/domain.ts:67 (веб-шим `lib/domain.ts` его реэкспортирует); сервер хранит integer minor units повсеместно (amountMinor/priceMinor: subscriptions.ts:91,103; adsBilling.ts:95; payouts.ts:115; reconciliation). На сервере нет дубля-модуля, но 10+ мест вручную пишут `(amount / 100).toFixed(2)` при формировании сообщений (providers/payment-crypto.ts:161, payment-tbank.ts:97, payment-yookassa.ts:117, tbank.ts/yookassa.ts:83, email.ts:161, priceAlerts.ts:122,218).
- change: опционально — серверный хелпер `formatMinorRub(amountMinor)` в lib/ (или в shared) и заменить инлайны. Не блокер: расчёты везде в minor units (C-005 соблюдён), дублируется только отображение.
- reason: T-002 «money» — реального дублирования расчётов нет; отображение — косметика.
- risk: нет.
- verification: grep `toFixed(2)` в server/lib сокращается; тесты payments/providers зелёные.

## T-002.06 — Хранилище/авторизация/события: дубликатов нет (подтверждение)
- severity: low
- verdict: KEEP
- current/evidence:
  - storage: `lib/s3.ts` (S3-клиент, 3 потребителя), `lib/upload.ts` (локальный режим + multer), `lib/storage.ts` (артефактный лоадер поверх s3/local — routes/leak.ts, routes/versions.ts), `lib/media.ts` (медиа-хелперы, 6 потребителей) — слои, а не копии.
  - authorization: `lib/auth.ts requireRole` (40 импортёров) — HTTP-мидлварь; `lib/permissions.ts` (7) — actor-policy; `lib/serverAccess.ts` (7) — роли персонала сервера (OWNER/ADMIN/MODERATOR). Разные домены, совпадений имён только смысловые.
  - events: `lib/events.ts` — единственная реализация domain events + transactional outbox (claimBatch/completeEvent/failEvent/backoff/dead-letter, events.ts:57,233); consumers: lib/commerce.ts (emit), worker/index.ts (drain), routes/admin.ts (dead-letter view). Второго outbox нет; contracts/events/*.yaml — документальный перечень продюсеров.
  - idempotency: DB-backed (lib/idempotency.ts:1-8), keyLock.ts — in-process keyed mutex (4 потребителя) — дополняют друг друга, не дублируют.
- change: ничего.
- reason: пункт T-002 перечисляет эти зоны; проверка показала одну реализацию на систему.
- risk: —.
- verification: —.

## T-002.07 — Легаси-админ-роутер: непродуктивные хендлеры пользователей
- severity: medium
- verdict: REMOVE
- current: app.ts:209-210 монтирует adminPlatformRoutes ПЕРЕД adminRoutes, т.к. оба объявляют GET /admin/users и PATCH /admin/users/:id/role (adminPlatform.ts:203,702; admin.ts:39,483). Следствие: хендлеры `routes/admin.ts:39 GET /users` и `:484 PATCH /users/:id/role` недостижимы (Express матчит первый смонтированный). Дополнительно `PATCH /admin/users/:id/status` (admin.ts:433) никем не вызывается: web использует suspend/restore платформенного роутера (site/web/src/lib/api/admin.ts:139,148), тесты — тоже (tests/integration/api/admin/admin-platform.test.ts:142-384). Остальной admin.ts жив (consumers: /admin/stats — site/web/src/lib/api/resources.ts:448 + e2e journey.spec.ts:337; /admin/resources|versions|reviews|moderation-events — api/resources.ts:413+).
- change: удалить из routes/admin.ts только три хендлера (GET /users, PATCH /users/:id/role, PATCH /users/:id/status) и сопутствующие хелперы, если останутся сиротами; комментарий-предупреждение о порядке монтирования в app.ts:203-208 упростить (перекрытие исчезает).
- reason: «двухканальный» admin API — источник расхождений форм ответа; недостижимые хендлеры — мёртвый код, который выглядит живым.
- risk: внешний клиент, вызывающий legacy PATCH /admin/users/:id/status, начнёт получать 404 — потребителей не найдено (grep по site/web/src, tests, tests/e2e — 0); поведение /admin/users меняется только для тех, кто попадал в платформенный роутер и так.
- verification: integration-тест admin-platform.test.ts зелёный; e2e auth/journey.spec.ts (использует /admin/stats) зелёный; `grep -rn "users/:id/status" tests site/web/src` → пусто и после.

---

## A-004.01 — DRM v1: живые legacy-эндпоинты без потребителей
- severity: medium
- verdict: REMOVE (my-licenses, revoke/:licenseId), KEEP (410-заглушки)
- current: `routes/drm.ts` (v1): POST /activate и /verify — 410-заглушки (drm.ts:20-37; проверяются тестом как «must be blocked» tests/integration/api/licenses/drm-v2.test.ts:273-277) — осмысленные tombstone-ответы legacy-клиентам, KEEP. Но GET /drm/my-licenses (drm.ts:41-88) и DELETE /drm/revoke/:licenseId (drm.ts:92+) — полноценные legacy-хендлеры: веб лицензии берёт из /purchases/my (site/web/src/app/account/page.tsx:91; lib/api/commerce.ts:114 `/purchases/my`), модуль использует только /drm/v2/* (module/src/drm/license_client.cpp:251), ревокация в v2 — сервисная `revokeInstallation` (tests/integration/api/licenses/drm-hardening.test.ts:402-404; routes/drm/v2.ts — нет revoke-роута). Потребителей нет: `grep -rn "my-licenses|/drm/revoke" site/web/src module/src tests` → 0 (только documents/api/DRM.md:164).
- change: удалить оба хендлера из routes/drm.ts; DRM.md:164 обновить («управление лицензиями — через /purchases/my и /drm/v2»); 410-заглушки и их тест оставить.
- reason: unconsumed legacy-поверхность с живой DB-логикой (N+1 цикл по покупкам) — дороже в поддержке, чем стоит.
- risk: внешний «старый клиент», которого нет в репозитории, получил бы 404; протокол v2 для модуля не затрагивается.
- verification: integration tests (drm-v2, drm-hardening) зелёные; `grep -rn "my-licenses" site/web/src module/src` остаётся пустым.

## A-004.02 — Route alias GET /drm/v2/public-key (единственное число)
- severity: low
- verdict: REMOVE
- current: routes/drm/v2.ts:90 `/v2/public-key` — «исторический маршрут; канонический — plural» (documents/api/DRM.md:46). Канонический `/v2/public-keys` (v2.ts:377) использует модуль (license_client.cpp:251) и тесты. Потребителей единственного числа нет: `grep -rn "v2/public-key\b" tests module/src site/web/src contracts` → 0.
- change: удалить роут :90-107 и строку из DRM.md (или пометить «removed»).
- reason: классический route-alias из A-004 без потребителей.
- risk: нет (никто не дергает).
- verification: tests/integration/api/licenses/drm-v2.test.ts + drm-hardening.test.ts зелёные; `grep -rn "public-key'" tests module/src` → пусто.

## A-004.03 — Compat-шимы api-ext.ts и lib/domain.ts: живые, задокументированные
- severity: low
- verdict: KEEP (с миграцией-кандидатом на отложенный фронти-волн)
- current: `site/web/src/lib/api-ext.ts` — чистый re-export barrel над lib/api/{identity,payments,resources,servers,community,content,commerce} (+shared типы); импортируют ~70 файлов (`grep -rln "api-ext" site/web/src | wc -l` ≈ 70; app/, components/, features/). `site/web/src/lib/domain.ts` — реэкспорт @mta-market/shared для прежнего пути импорта (5+ страниц). Оба шима без логики; домен-модули импортируют транспорт из lib/api.ts (канонический fetch-клиент, E-003); циклов нет (api/admin.ts:11 «api-ext does not import this module»).
- change: ничего сейчас. Когда-нибудь — механическая миграция импортёров на `@/lib/api/*` и удаление шимов; ценность низкая (шим не содержит дублирования), риск — 70+ файлов.
- reason: A-004 требует удалять только НЕ потребляемые shim'ы; эти потребляются массово.
- risk: —.
- verification: `grep -rln "api-ext" site/web/src | wc -l` стабилен; tsc зелёный.

## A-004.04 — contracts/compatibility/*.yaml: аттестационные записи, не машинный слой
- severity: low
- verdict: KEEP (+FIX комментария)
- current: contracts/compatibility/{api,drm,module}.yaml и contracts/data/compatibility.yaml — «verified compatibility» записи (last_verified, evidence, changePolicy). Машинных потребителей нет (только синтакс-проверка всех contracts/ в scripts/maintenance/verify-contracts.sh); они дублируют смысл документов, но машиночитаемы и версионированы. Устаревшая деталь: compatibility/api.yaml:7 «web … axios client» — axios удалён (lib/api.ts:1-3 fetch-клиент).
- change: обновить строку на «fetch client (lib/api.ts)»; остальное не трогать (изменение policy-файлов — не задача упрощения).
- reason: это документированная совместимость (задача A-004 — отделить реальные compat-слои от шума); записи малы и актуальны по сути.
- risk: нет.
- verification: `bash scripts/maintenance/verify-contracts.sh` зелёный.

## A-004.05 — Архивные документы old_*/history — намеренный архив
- severity: low
- verdict: KEEP
- current: documents/history/{LEGACY,MIGRATION,ARCHITECTURE-HISTORY,V1-TO-V2-MIGRATION}.md и documents/development/reference/old_*.md — архив прошлых планов, на них ссылается validate.yml «Markdown policy» (исключений нет — всё в documents/). Потребители-кода не требуется.
- change: ничего.
- reason: история удалять нельзя (U-004 требует проверяемости прошлых утверждений).
- risk: —.
- verification: —.

## A-004.06 — ENV-дрейф: переменные, читаемые кодом, но отсутствующие в .env.example
- severity: low
- verdict: FIX
- current: diff `process.env.*` (site/server/src) против .env.example: код читает WORKER_KEY (routes/alerts.ts:37 — server-to-server CRON-аутентификация), ACTIVITY_WINDOW_DAYS (activity.ts:26), DEMO_MAX_ACTIVE, DEMO_SWEEP_ENABLED, PRICE_ALERT_SWEEP_ENABLED (worker/index.ts), CRYPTO_API_URL, CRYPTO_WEBHOOK_URL, TBANK_API_URL, PLATFORM_CONFIG_DIR, REDIS_CONNECT_TIMEOUT/MAX_RETRIES_PER_REQUEST — и ни одна не описана в .env.example (WORKER_KEY — единственная security-релевантная). Обратный дрейф отсутствует: BASE_URL/POSTGRES_*/IMAGE_TAG/GITHUB_REPOSITORY/NEXT_PUBLIC_API_URL читаются compose/web — это не «мёртвые» ключи.
- change: дополнить .env.example секцией «Worker/optional knobs»: WORKER_KEY (secret), DEMO_SWEEP_ENABLED, DEMO_MAX_ACTIVE, PRICE_ALERT_SWEEP_ENABLED, ACTIVITY_WINDOW_DAYS, PLATFORM_CONFIG_DIR; пороговые URL провайдеров (TBANK_API_URL и др.) — с пометкой «необязательно, дефолты в коде».
- reason: секрет/ключ аутентификации, не отражённый в матрице окружений, — дыра в операционной документации (U-004).
- risk: нет.
- verification: comm -23 (code-envs, envexample) после правки содержит только системные PORT/DATABASE_URL/REDIS_URL.

---

## T-003.01 — Redis: один мувинг-парт с двумя узкими ролями
- severity: medium
- verdict: KEEP (+FIX комментария)
- current: Redis используется ровно в двух местах: (1) rate-limit счётчики `redis.incr/pexpire` (lib/rateLimit.ts:30-33,118-120; fail-closed для security-лимитов, fail-open для bulk — rateLimit.ts:9-22); (2) TTL-кэш 45с агрегатов activity (lib/activity.ts:122-144, bustActivityCache из 6 роутов). Не используется для: сессий (DB — lib/auth.ts), идемпотентности (DB — idempotency.ts:1-8), outbox (DB — events.ts), кэша доменов. Комментарий в redis.ts:1 «rate limiting, sessions» ложен. Замена на PostgreSQL возможна, но per-request счётчики и 45-секундный TTL-кэш на БД — антипаттерн под нагрузкой; вынос Redis сломал бы fail-closed политику лимитеров (M-002) и потребовал бы переписать кэш с инвалидацией.
- change: оставить Redis (redis:7-alpine уже в dev/tests/staging/prod compose); исправить комментарий redis.ts:1 на «rate limiting + activity cache».
- reason: задача T-003 требует обосновать, а не удалить; обоснование есть — но «sessions» в комментарии вводит в заблуждение аудиты.
- risk: —
- verification: `grep -rn "redis\." site/server/src --include='*.ts'` → только rateLimit.ts/activity.ts/index.ts/worker/index.ts (disconnect); doctor/status показывают REDIS контейнер.

## T-003.02 — S3: оправдан для прода, но release-репетиция нечестна к нему
- severity: medium
- verdict: FIX (локальный release) / KEEP (зависимость)
- current: @aws-sdk/client-s3 + s3-request-presigner используются s3.ts (uploads/media/versions) — приватный бакет + подписанные URL (s3.ts:1-20) — для платных артефактов это обоснованный минимум. Но: (а) compose production.yml НЕ содержит MinIO/S3-реализацию — ожидается настоящий S3/R2 (S3_ENDPOINT); (б) `python startup.py release` (startup.py:880-886) ставит S3_ENABLED=true с фейковыми кредами (`S3_ACCESS_KEY="local-release"`, bucket mta-market-local-release) → при репетиции любые аплоады/подписи падают, а smoke это не проверяет (run_smoke — только health/ready/metrics, startup.py:1010-1021).
- change: в cmd_release ставить S3_ENABLED=false (локальный режим uploads) ЛИБО добавить minio-сервис в compose для release-профиля и smoke-шаг «upload+download». Минимум — первое.
- reason: release-репетиция, которая декларирует S3 и не может им пользоваться, — ложное движение U-002.
- risk: при S3_ENABLED=false release проверяет локальный режим — это соответствует dev-реальности; prod по-прежнему требует настоящий S3 (startupValidation не пропустит прод без ключей).
- verification: `python startup.py release` зелёный; в логе release нет S3 FATAL; smoke проходит.

## T-003.03 — Worker: обоснован
- severity: low
- verdict: KEEP
- current: src/worker/index.ts — единственный владелец outbox-consumer и всех шедулеров (reconciliation, serverMonitoring, demo/price-alert sweeps; worker/index.ts:1-33); API их не запускает (index.ts:30-33 «schedulers moved to the dedicated worker runtime»); compose production.yml:149-158 содержит worker-сервис. Без него: dead-letter/ретраи событий перестают обрабатываться, мониторинг серверов и reconciliation останавливаются.
- change: ничего.
- reason: отдельный процесс даёт независимое масштабирование и краш-изоляцию фоновых задач (S-001/H-003).
- risk: —
- verification: `python startup.py dev worker` поднимает worker; tests/integration/api/platform/outbox.test.ts зелёный.

## T-003.04 — turbo: 3 workspace'а, скромная ценность
- severity: low
- verdict: DEFER
- current: turbo оркестрирует build/lint/dev/type-check трёх пакетов (turbo.json; site/web, site/server, site/shared), корневые скрипты завязаны (package.json:7-15). Для трёх пакетов `pnpm -r --filter` покрывает топологию без зависимости turbo (^2.3.3); кэш turbo даёт немного (next build, tsc).
- change: сейчас ничего; кандидат на удаление при следующей ревизии тулчейна (заменить на pnpm -r скрипты). Удаление сейчас трогает корневые скрипты и CI-профиль без прямой выгоды.
- reason: работает, не добавляет инфраструктуры в рантайм; вопрос чисто перф/тулчейн.
- risk: удаление меняет команды dev/build в документации (TOOLCHAIN.md) — синхронизировать.
- verification: (при удалении) `pnpm -r build && pnpm type-check` зелёные, CI site.yml проходит.

## T-003.05 — Playwright: обоснован
- severity: low
- verdict: KEEP
- current: browser E2E — приёмочный уровень плана (PLAN-001 L, playwright.config.ts:1-5; tests/e2e/*, CI e2e.yml с реальным Chromium). Без него теряется единственная проверка реальных journeys (U-003).
- change: ничего.
- reason: требование плана, реальная ценность подтверждена спеками journey/catalog/discovery.
- risk: —
- verification: pnpm test:e2e зелёный в CI.

## T-003.06 — Root devDependencies: все заняты
- severity: low
- verdict: KEEP
- current/evidence: @playwright/test (tests/e2e, playwright.config.ts), vitest (vitest.config.ts, tests/**), supertest (tests/tools/helpers/*.ts, tests/concurrency/*), pg+@types/pg (tests/tools/playwright/helpers.ts:8 — FK-safe teardown, PLAN-017 §32), @types/node, typescript, prettier (format:check), turbo (см. T-003.04).
- change: ничего (turbo — отдельно).
- reason: каждый пакет имеет точку использования.
- risk: —
- verification: —.

## T-003.07 — Тяжёлые runtime-зависимости сервера: все с потребителем
- severity: low
- verdict: KEEP
- current/evidence: express (60 файлов), ioredis (T-003.01), @aws-sdk/* (s3.ts), nodemailer (lib/email.ts; EMAIL_ENABLED флаг), multer (upload), unzipper (sandbox/static.ts, artifact/metadata.ts — парсинг ZIP entry names), zod (12 файлов — middleware/validate, validation schemas), jsonwebtoken/bcryptjs/cookie-parser/cors/dotenv — по точке входа каждый. Единственный кандидат на удаление — @prisma/client (см. T-001.01).
- change: ничего.
- reason: повторный sweep не нашёл мёртвых runtime-пакетов.
- risk: —
- verification: —.

## T-003.08 — PostgreSQL уже решает: сессии, идемпотентность, outbox, блокировки
- severity: low
- verdict: KEEP (текущее распределение)
- current: сессии/refresh-токены — DB (lib/auth.ts, lib/tokenSecurity.ts хэши в БД); идемпотентность платежей — DB-таблица (lib/idempotency.ts:1-8 «durable, database-backed»); outbox — DB (events.ts); keyed-мьютекс — in-process (keyLock.ts, честно задокументирован для single-container топологии, keyLock.ts:1-8). Единственные нагрузки, оставленные Redis — счётчики rate-limit и activity-кэш (T-003.01).
- change: ничего.
- reason: принцип «Postgres/Redis уже умеют» соблюдён; не заводим новые хранилища (нет очередей-брокеров, нет отдельного кэш-слоя, нет Elasticsearch для search — routes/search.ts уходит в БД).
- risk: —
- verification: —.

---

## Сводка вердиктов

| ID | Находка | Вердикт | Severity |
|---|---|---|---|
| T-001.01 | @prisma/client фантом | REMOVE | high |
| T-001.02 | lib/prisma.ts wrapper | REMOVE | low |
| T-001.03 | sandbox mock + Docker-тулинг | REMOVE/FIX | high |
| T-001.04 | scripts/builds/*.sh | REMOVE | low |
| T-001.05 | scripts/tests/*.sh | REMOVE | low |
| T-001.06 | maintenance/cleanup.sh | REMOVE | low |
| T-001.07 | deployments/healthcheck+rollback | REMOVE | low |
| T-001.08 | development/seed.py | REMOVE | low |
| T-001.09 | loader.ts dead exports | REMOVE | medium |
| T-001.10 | windowsMs мёртвый ключ | SIMPLIFY | low |
| T-001.11 | плейсхолдер-каталоги logs/temp | REMOVE | low |
| T-001.12 | корневой CMake-суперпроект | REMOVE | low |
| T-001.13 | repair-cyrillic CI-гейт не подключён | FIX | medium |
| T-001.14 | @types/* в dependencies | FIX | low |
| T-001.15 | supertest/vitest в server devDeps | REMOVE | low |
| T-001.16 | module/tools + демо-функции | KEEP | low |
| T-002.01 | канонические ошибки не внедрены | FIX | high |
| T-002.02 | пагинация: schema vs 8 ручных | MERGE | medium |
| T-002.03 | normalizeListPage/isFeatureDisabledError x2 | MERGE | medium |
| T-002.04 | логирование | KEEP (+FIX comment) | low |
| T-002.05 | money | KEEP (+опц. SIMPLIFY) | low |
| T-002.06 | storage/authz/events | KEEP | low |
| T-002.07 | легаси-хендлеры admin.ts (users) | REMOVE | medium |
| A-004.01 | /drm my-licenses + revoke | REMOVE | medium |
| A-004.02 | /drm/v2/public-key alias | REMOVE | low |
| A-004.03 | api-ext + domain shims | KEEP | low |
| A-004.04 | contracts/compatibility attestation | KEEP (+FIX comment) | low |
| A-004.05 | архив old_*/history | KEEP | low |
| A-004.06 | ENV-дрейф (.env.example) | FIX | low |
| T-003.01 | Redis | KEEP (+FIX comment) | medium |
| T-003.02 | S3/MinIO release-репетиция | FIX (release) / KEEP (dep) | medium |
| T-003.03 | worker | KEEP | low |
| T-003.04 | turbo | DEFER | low |
| T-003.05 | playwright | KEEP | low |
| T-003.06 | root devDeps | KEEP | low |
| T-003.07 | runtime-зависимости | KEEP | low |
| T-003.08 | Postgres/Redis покрытие | KEEP | low |

**Итого: 0 critical, 3 high, 8 medium, 25 low (из них 9 — KEEP-подтверждения отсутствия проблемы, 4 — KEEP с косметическим FIX).**