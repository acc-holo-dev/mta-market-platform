# PLAN-020 — аудит 08: CI/CD (O-001..O-004), статическая производительность (R-001/R-003), отказоустойчивость (S-001..S-004)

Зона: `.github/workflows/*.yml` (9 файлов), `turbo.json`, `package.json` (root), `vitest.config.ts`, `playwright.config.ts`, `tests/` (unit/site — 10, integration/api — 52, concurrency — 7, e2e — 9 spec, tools — 7), инфраструктура образов (`infrastructure/docker/site/*.Dockerfile`), точки входа recovery (`site/server/src/worker/index.ts`, `lib/events.ts`, `lib/rateLimit.ts`, `lib/idempotency.ts`, `lib/yookassa.ts`).

Разделы плана: O-001..O-004 (`documents/development/active/PLAN-020.md:1041-1096`), R-001..R-003 (`:1233-1281`), S-001..S-004 (`:1283-1333`).

Метод: чтение всех 9 workflow и root-конфигов; grep-инвентаризация шагов (`pnpm install`, builds, schema apply, кэш, path-фильтры); чтение recovery-кода worker/outbox и ключевых тестов (outbox, payment-transitions, reconciliation, concurrency/*, payments-harness). Проверки, отмеченные «выполнено локально», реально исполнены в этом чекауте (результат и exit code приведены; созданный при проверке артефакт `module/Testing/` удалён, git status не изменён). Файлы репозитория (кроме этого отчёта) не модифицировались.

---

## Матрица workflow × job × шаги (инвентарь, O-001/O-002)

| Workflow | Job | Триггер | install | generate/schema | type-check | lint | build | tests | прочее |
|---|---|---|---|---|---|---|---|---|---|
| ci.yml | validate, contracts, security, tests, module, site, e2e (reusable calls) | push(main,develop), PR, workflow_call | — | — | — | — | — | — | orchestration; publish: docker build+push ×2 (`ci.yml:64-115`) |
| release.yml | gate → ci.yml; release | push tags `v*` | apt | — | — | — | docker build+push ×2 (`release.yml:41-56`) | ctest (см. O-004b) | cpack + attach (`:57-68`) |
| validate.yml | policy | workflow_call | — | — | — | — | — | — | структура/naming/логи/markdown/баш-скрипты (`validate.yml:17-73`) |
| contracts.yml | verify | workflow_call | pip pyyaml | parse contracts/ | — | — | — | — | `verify-contracts.sh` (`contracts.yml:21-22`) |
| security.yml | gitleaks; audit | workflow_call | install (audit) | — | — | — | — | — | gitleaks fetch-depth 0 (`:16-22`), `audit.sh` high/critical gate (`:33-34`) |
| tests.yml | vitest | workflow_call | install `:44` | contract emit + db update `:45-49` | — (комментарий «в site.yml», `:50`) | — | — | vitest run `:51-55` | postgres:5433 + redis сервисы `:15-37` |
| module.yml | linux (блокирующий); linux-clang, windows×2, integration-linux (continue-on-error) | workflow_call | apt | — | — | — | cmake×2 | ctest + DRM + unittest | CLI smoke, vendored-lua cmp `:19-24` |
| site.yml | build | workflow_call | install `:23` | — | pnpm type-check `:27` | pnpm lint `:25` | tsc server `:29`; next build web `:52-55` | — | dist fail-fast smoke `:30-51` |
| e2e.yml | playwright | workflow_call | install `:58` | contract emit + db update `:59-61` | — | — | next build web `:69-70` | playwright `:96` | seed, API через tsx dev `:73`, playwright install `:94` |

Дубли в одном прогоне на push в main: `pnpm install --frozen-lockfile` ×4 (tests/site/e2e/security) + 2 docker-deps-стадии = 6; `next build` web ×3 (site.yml, e2e.yml, docker); `tsc` server ×2 (site.yml, docker); schema apply ×2 (tests, e2e). Кэширование отсутствует полностью (grep `cache` по `.github/workflows/` — 0 совпадений).

---

## O-001 — Инвентарь workflow: единый вход, все компоненты reusable-only

- severity: low
- verdict: KEEP (7 × KEEP + 1 × MERGE см. O-001c; DELETE — нет; TRIGGER_ONLY — нет)
- current: Единая точка входа — ci.yml (push main/develop + PR + workflow_call, `ci.yml:8-12`); остальные 8 — только `on: workflow_call` (validate.yml:5-7, contracts.yml:5-7, security.yml:5-7, tests.yml:5-7, module.yml:5-7, site.yml:7-9, e2e.yml:5-7) либо tag-push (release.yml:7-10). Комментируемая архитектура «single blocking CI entry point» (`ci.yml:3-6`) реально выдержана: publish в ci.yml требует всех семи гейтов (`ci.yml:66`) и срабатывает только на push main (`ci.yml:67`); release.yml гоняет тот же гейт через workflow_call (`release.yml:20-28`). Двойной publish на теге исключён: в контексте workflow_call `github.ref` = `refs/tags/v*`, поэтому `if: github.ref == 'refs/heads/main'` (`ci.yml:67`) в publish не срабатывает. Все job'ы — `permissions: contents: read`, у publish/release/packages: write (`ci.yml:69-71`, `release.yml:30-32`); concurrency только в ci.yml (`ci.yml:17-19`).
- change: Оставить структуру как есть. Добавить `workflow_dispatch` к семи reusable-компонентам (переразовый запуск одного гейта для отладки невозможен сегодня — например, «прогнать только site» нельзя вообще, только через полный ci.yml). Зафиксировать в документации, что publish на теге неактивен по построению.
- reason: Инвентарь O-001 не выявляет мёртвых/лишних workflow; все 9 связаны в два сценария (PR/push — ci.yml; тег — release.yml → ci.yml). Единственная функциональная дыра — отсутствие ручного триггера у компонентов.
- risk: `workflow_dispatch` на reusable-файле — безобиден (job'ы самодостаточны); риск появления «двойного запуска» отсутствует, т.к. триггеры не пересекаются.
- verification: `grep -l "workflow_call" .github/workflows/*.yml | wc -l` = 7; `grep -rn "workflow_dispatch" .github/workflows/` до/после изменения; dry-run `gh workflow run`.

## O-002a — 6× pnpm install на один прогон, ни одного кэша

- severity: medium
- verdict: FIX
- current: На один прогон гейта `pnpm install --frozen-lockfile` выполняется 4 раза (tests.yml:44, site.yml:23, e2e.yml:58, security.yml:33) плюс 2 раза в docker-стадии deps (server.Dockerfile:24, web.Dockerfile:18). `actions/setup-node` вызывается без `cache:` (tests.yml:40-42, site.yml:19-22, e2e.yml:54-56, security.yml:29-31), grep `cache` по `.github/workflows/` — 0 совпадений. turbo (package.json:31, turbo.json) в CI не вызывается (grep `turbo` по workflows — 0), поэтому и его локальный кэш не задействован.
- change: (1) Во всех setup-node добавить `cache: 'pnpm'` (pnpm/action-setup@v6 уже стоит перед ним в каждом job). (2) Объединить install+schema-apply в один `setup`-job с `actions/upload-artifact` (node_modules + site/server/src/prisma/contract.json) и заменить в tests/site/e2e шаги install+schema на `download-artifact`. Минимальный вариант — только п.1: он не меняет логику гейтов.
- reason: Четыре холодных инсталла — крупнейшая статья времени CI (lock-файл ~325 КБ, полный воркспейс из 5 пакетов), и всё это повторяется на каждый PR-пуш.
- risk: Кэш pnpm требует стабильного `pnpm/action-setup` до setup-node (порядок шагов уже корректен во всех четырёх job'ах); artifact-вариант добавляет шаги upload/download и требует выверить ключ кэша по `pnpm-lock.yaml` hash, иначе можно закэшировать несовместимое подмножество.
- verification: Прогон PR: суммарное время шагов install в 4 job'ах до/после (в логах Actions); `grep -rn "cache:" .github/workflows/` — 4+ совпадения.

## O-002b — web `next build` ×3 и server tsc ×2 на один push в main

- severity: medium
- verdict: FIX
- current: Продакшн-сборка web выполняется в site.yml:52-55 (gate), затем повторно в e2e.yml:69-70 (gate), затем ещё раз внутри docker-сборки образа (ci.yml:108-115, `pnpm --filter @mta-market/web build` внутри web.Dockerfile:34; на теге — release.yml:49-56). Сервер собирается в site.yml:29 (`tsc`) и внутри server.Dockerfile:37 (`ci.yml:92-99`, на теге — release.yml:41-48). При этом e2e запускает API не из собранного dist, а через tsx dev (`e2e.yml:73`), т.е. третья сборка web и обе сборки образов — это не тот бинарь, который реально тестируется.
- change: site.yml после `next build` публиковать артефакт (`.next/standalone`+`.next/static`, ключ — commit sha), e2e.yml его скачивает вместо повторной сборки; publish/release продолжает собирать в Docker (образ обязан собираться из чистого контекста), но это уже единственная лишняя сборка вместо двух. Альтернатива дешевле: e2e получает артефакт, docker-сборки остаются как есть.
- reason: Повторный `next build` (Turbopack-сборка воркспейса) — минуты на прогон; артефакт заодно гарантирует, что E2E тестирует ровно тот бандл, который публикуется (сейчас тестируется только «этот же коммит, другая сборка»).
- risk: Артефакт между job'ами требует совпадения версии Node/флагов сборки (уже совпадают: node 22 в site.yml:21 и e2e.yml:56); standalone-выход включается только env `NEXT_OUTPUT_STANDALONE=true` (next.config.ts, web.Dockerfile:32) — артефакт нужно собирать с этим env или публиковать обычный `.next` + `next start`.
- verification: В логах PR шаг «Build web (production build)» отсутствует в job E2E; E2E стартует и проходит 9 spec'ов (tests/e2e/**).

## O-002c — prisma schema apply повторяется в двух job'ах

- severity: low
- verdict: MERGE
- current: `npx prisma contract emit && npx prisma db update --confirm …` выполняется и в tests.yml:45-49 (БД на :5433), и в e2e.yml:59-61 (БД на :5432). Это дублирование схемной работы в двух разных БД — допустимое следствие двух сервисов, но emit-часть (генерация contract.json) идентична.
- change: Слить с артефакт-подходом O-002a/O-002b: emit выполняется один раз в setup-job, `db update` остаётся в каждом job против своей БД (это неизбежно, БД разные).
- reason: Дублируется только дорого-детерминированная часть (emit); db update нельзя вынести, т.к. адресаты разные.
- risk: Артефакт contract.json должен попадать в правильный путь (`site/server/src/prisma/contract.json` — он tracked, `git ls-files` подтверждает); иначе vitest (db.ts:3-4 читает contract.json) подхватит устаревший файл.
- verification: В job'ах tests/e2e шаг emit отсутствует, db update остаётся; vitest run зелёный.

## O-001c — module.yml: блокирует только linux-gcc, 3 из 5 job'ов continue-on-error

- severity: low
- verdict: KEEP (зафиксировать решение)
- current: Блокирующий только job linux (module.yml:12-40): cmake build + ctest (preset linux-gcc, `:25-30`), standalone DRM tests (`:32`), CLI smoke (`:33-38`), unittest (`:39-40`). linux-clang (`:42-50`), windows mingw/msvc (`:52-88`), integration-linux (`:90-105`) — все `continue-on-error: true` (`:44,55,93`). Release-пакет собирается только linux-gcc (release.yml:57-63, files `module/build/linux-gcc/package/*.zip`, `:67`) — несоответствия «гейт шире артефакта» нет.
- change: Ничего не менять; в описании job'ов явно пометить report-only статус (частично уже есть: `name: … (report-only)` в module.yml:43, `best-effort` в `:91`). Если Windows/MSVC становятся обязательными — отдельное решение с апгрейдом матрицы до блокирующей.
- reason: Гейт соответствует тому, что реально поставляется (linux-gcc ZIP); остальные — телеметрия. «Тихая деградация» здесь честно помечена.
- risk: Держатели `continue-on-error` могут годами быть красными и никто не заметит (сигнал не обязателен) — снизить шум можно обязательной сводкой в шаге summary.
- verification: Пометка report-only в выводе job'а; периодическая ревизия красных report-only job'ов (например, еженедельный scheduled-прогон с алертом).

## O-001d — validate.yml: glob `scripts/**/*.sh` без globstar покрывает ровно 2 уровня

- severity: low
- verdict: FIX
- current: `for f in scripts/**/*.sh` (validate.yml:33) в bash без `shopt -s globstar` эквивалентен `scripts/*/*.sh`. Сегодня это работает: все 18 .sh лежат ровно на глубине 2 (find scripts −mindepth 2 −name '*.sh' → 18; −maxdepth 1 → 0), но будущий `scripts/foo.sh` молча выпадет из `bash -n`-проверки, а проверка продолжит считаться зелёной.
- change: В начале шага добавить `shopt -s globstar` либо заменить перебор на `git ls-files 'scripts/*.sh'` (как это уже сделано в соседних шагах validate.yml:40, 55, 68).
- reason: Политический гейт, который должен покрывать весь каталог, а не фиксированную глубину; сам файл validate.yml:29 уже использует `find module/src …` — паттерн в репозитории смешанный.
- risk: Минимальный: globstar в свежих bash включается локально для шага; git ls-files — требует, чтобы файлы были закоммичены (в CI так и есть).
- verification: Добавить временный `scripts/probe.sh` в ветке — шаг должен его подхватить; вернуть.

## O-001e — contracts.yml — отдельный workflow ради парсинга YAML/JSON

- severity: low
- verdict: MERGE
- current: contracts.yml — один job (`:13-22`): setup-python 3.12 + `pip install pyyaml` + `verify-contracts.sh`, который рекурсивно json.loads/safe_load каждый файл contracts/ (scripts/maintenance/verify-contracts.sh:6-26). Это и есть весь «гейт контрактов»; глубокая контрактная валидация живёт в тестах (tests/integration/api/platform/contracts.test.ts) и в schema apply (tests.yml:45-49, e2e.yml:59-61).
- change: Перенести шаг в validate.yml как ещё один step («contracts/ parse OK») — минус один job-level checkout/setup-python на прогон; скрипт уже ставит python-зависимость опционально (verify-contracts.sh:12-15 — при отсутствии yaml честно сообщает, что YAML не проверен), так что в validate.yml нужно сохранить установку pyyaml.
- reason: O-002 просит сливать повторяемую работу; standalone-воркфлоу ради `set -e` + двух парсеров — накладной оркестрации больше, чем проверки. Порог входа validate.yml (репозиторийная гигиена) концептуально тот же.
- risk: Пропадёт отдельная «зелёная галочка Contracts» в PR — заменить на явный step-name в validate;语义 гейта не меняется.
- verification: PR с битым contracts/**.yaml красит validate.yml (step fails), полный гейт не проходит.

## O-001f — Actions пиннуты по major-тегу, ни одной SHA-пинки

- severity: low
- verdict: FIX
- current: 34 ссылки на сторонние actions во всех workflow — все по тегу `@v3..@v7` (подсчёт по всем файлам: 23×@v7, 6×@v6, 4×@v4, 1×@v3; включая docker/*, gitleaks/gitleaks-action@v3, softprops/action-gh-release@v2 — release.yml:65), ни одной `@<sha>`. permissions в job'ах минимальны (`contents: read` везде, кроме publish/release), что снижает blast radius, но тег — изменяемая ссылка.
- change: Пиннуть по full-commit-SHA с комментарием версии (или dependabot уже настроен на это? .github/dependabot.yml:29-39 обновляет actions еженедельно — после SHA-пинки он продолжит открывать PR на смену пина). Приоритет: gitleaks-action, softprops/action-gh-release (contents: write), docker/* (packages: write).
- reason: Единственная зона с повышенными правами (release.yml:12-14 — contents: write + packages: write) защищена только неизменяемостью имени тега.
- risk: SHA-пинки устаревают — dependabot-PR'ы станут чаще; компромисс — пиннуть только write-контекстные actions.
- verification: `grep -rn "uses:" .github/workflows/ | grep -v "@[0-9a-f]\{40\}"` — 0 строк для write-периметра.

## O-003a — Нет path-фильтров и affected: все 7 гейтов на каждый push/PR

- severity: medium
- verdict: FIX
- current: grep `paths|paths-filter|affected|dorny` по `.github/workflows/` — 0 совпадений. ci.yml:8-12 запускает полный гейт (validate+contracts+security+tests+module+site+e2e, `ci.yml:22-62`) на любой push/PR; самый тяжёлый нерелевантный случай — правка documents/** запускает module.yml (apt-get + cmake configure+build + ctest + DRM + unittest, module.yml:17-40), e2e.yml (две БД-сервиса, next build, playwright install chromium, `:53-96`) и все остальные. turbo (turbo.json:4-19) умеет `dependsOn`-граф, но: (а) в CI не вызывается, (б) vitest/playwright в turbo-задачах отсутствуют.
- change: Двухуровневая схема без потери безопасности: (1) на **pull_request** — dorny/paths-filter в первом job + `needs`-условия: module.yml — только при изменении `module/**`, `tests/module/**`, `.github/workflows/module.yml`; e2e — только при изменении `site/**`, `tests/e2e/**`, `tests/tools/**`, workflows; validate/contracts/security — всегда (дёшевы). (2) на **push в main и на теги** — полный гейт безусловно (это финальный барьер перед publish/release, `ci.yml:66`, `release.yml:28`). Это соответствует требованию плана «where it does not reduce required safety» (PLAN-020.md:1081).
- reason: На PR, трогающем только документы, сейчас крутятся cmake и браузерные E2E — чистый потери времени; при этом safety не страдает, т.к. merge-барьер (push main) остаётся полным.
- risk: path-фильтр может скрыть реальную поломку, если списки путей неполные (например, module зависит от чего-то в site/shared — проверить: module/third_party/mta-sdk и т.п.). Смягчение: фильтровать только на PR, полный гейт на main; при сомнении — не фильтровать job.
- verification: PR с изменением только documents/ — jobs module/e2e в статусе skipped; push в main — все гейты отработали; release на тег — полный гейт.

## O-003b — Делить vitest/e2e по файлам небезопасно (общая БД, serial) — не делить

- severity: low
- verdict: DEFER
- current: vitest сознательно сериализован: `fileParallelism: false` + комментарий «Integration suites share one PostgreSQL: files must not run in parallel or they destroy each other's fixtures (resetTestEntities)» (vitest.config.ts:8-9,28); Playwright — `fullyParallel: false, workers: 1, retries: 0` (playwright.config.ts:15-17). Каждый интеграционный файл делает полный `resetTestEntities()` (например, payment-transitions.test.ts:59, reconciliation.test.ts:88) — файлы не изолированы друг от друга.
- change: Не вводить шардирование по файлам до изоляции fixtures. Возможная дорога (отдельное решение): per-file схема/база в testcontainers, затем vitest `--shard` на 2-4 раннера. Пока экономия — только кэш/артефакты (O-002a/b).
- reason: O-003 явно требует «not reduce required safety»; шардирование общей БД напрямую ломает инвариант, заявленный в конфиге.
- risk: Шардирование «сейчас» даст флапающие гонки фикстур, которые хуже медленного прогона.
- verification: Если когда-нибудь шардировать — прогон двух шардов дважды подряд без кросс-влияния (ключ фикстур SUFFIX уже по времени — tests/integration/api/commerce/payment-transitions.test.ts:43, этого недостаточно для параллельных файлов).

## O-004a — Release-gate: пять гейтов есть, image validation отсутствует

- severity: high
- verdict: FIX
- current: release.yml требует полный гейт (`needs: gate`, `release.yml:28` → ci.yml:22-62), т.е. build (site.yml:28-29,52-55), contract validation (contracts.yml:21-22 + schema apply), security (gitleaks + audit high/critical, security.yml:16-34), critical tests (полный vitest включая concurrency, tests.yml:51-55 + vitest.config.ts:21-25), smoke — есть, но только против локального dist (site.yml:30-51: `node dist/index.js` обязан fail-fast без секретов). E2E прогоняет API через tsx dev (e2e.yml:73), web — `next start` (`:74`). **Собранный образ не валидируется нигде**: ci.yml:92-115 и release.yml:41-56 — `build-push-action` с `push: true`, дальше ничего; ни тривиального `docker run`-smoke, ни скана (trivy/grype), ни health-пробы. При этом класс отказа «образ не стартует» уже случался и задокументирован в самом Dockerfile: «PLAN-014 caught that the previous flat layout … every ESM import from dist/ resolved to a dangling symlink (ERR_MODULE_NOT_FOUND 'dotenv' at container start)» (server.Dockerfile:43-46) — именно такой инцидент сегодня проскочил бы до publish.
- change: В release.yml (и в publish ci.yml) между build и push добавить три шага: (1) `docker create`/`docker run` образа с отсутствующими секретами — ожидание fail-fast с ненулевым exit (зеркало site.yml:30-51 в контейнере); (2) `docker run` с тестовыми env + curl `/health` (эндпоинт уже используется в e2e.yml:76-80); (3) опционально trivy scan с порогом HIGH/CRITICAL (паритет с audit.sh:10). Push — только после этого (`push: false` → отдельный push-шаг).
- reason: O-004 перечисляет image validation как обязательный gate; сейчас publish физически не может поймать невалидный образ — он проверяет только то, что Dockerfile собрался.
- risk: Появится минута-две на прогон release; запуск контейнера с health-check требует поднять только API без БД — `/health` может требовать БД; тогда smoke ограничить fail-fast-проверкой старта с отсутствующими секретами (детерминирован, БД не нужен).
- verification: Внести в Dockerfile временную ошибку (битый импорт) — release должен пасть на шаге image smoke до push; логи шага содержат вывод контейнера.

## O-004b — release.yml: шаг «тесты модуля» не запускает ни одного теста и всегда зелёный

- severity: high
- verdict: FIX
- current: release.yml:57-63: configure+build (`cmake --preset linux-gcc -S module`, `cmake --build --preset linux-gcc -S module`) и `ctest --preset linux-gcc --test-dir module --output-on-failure`. Флаг `--test-dir module` перекрывает binaryDir пресета: ctest сканирует `module/` (где нет CTestTestfile.cmake — тесты регистрируются в module/build/linux-gcc). **Проверено исполнением в этом чекауте**: `ctest --preset linux-gcc --test-dir module` из корня → вывод `Test project …/module` + `No tests were found!!!`, реальный exit code — 0 (без `--no-tests=error` отсутствие тестов — успех). В module.yml тот же вызов сделан правильно: `ctest --preset linux-gcc --output-on-failure` с working-directory: module (module.yml:26-30) — ctest берёт binaryDir пресета (module/build/linux-gcc). Итог: release-gate, который задуман как повторная проверка тестов модуля, — no-op, всегда зелёный.
- change: release.yml:62 → `working-directory: module` + `ctest --preset linux-gcc --output-on-failure --no-tests=error` (как в module.yml, плюс защита от будущих «нул тестов»). Если шаг задумывался как повтор гейта — можно вообще удалить (тесты уже прошли в gate → module.yml:25-30), но тогда честно удалить и шаг, а не оставлять фиктивный.
- reason: Фиктивный зелёный шаг в release-гейте опаснее его отсутствия: он создаёт видимость повторной валидации пакета перед публикацией ZIP (release.yml:63-68).
- risk: После исправления release станет реально запускать ctest (~время тестов модуля); если тесты модуля красные на теге — release честно падает (это и есть требование гейта).
- verification: Локально: `ctest --preset linux-gcc --test-dir module` → `No tests were found!!!` exit 0 (воспроизведено); после фикса — лог release содержит перечень выполненных тестов; `ctest --no-tests=error` на пустом наборе возвращает ошибку.

## O-004c — release.yml без concurrency-группы

- severity: low
- verdict: FIX
- current: ci.yml сериализует прогоны по ref с cancel-in-progress (`ci.yml:17-19`), release.yml группы не имеет (по файлу — 0 упоминаний, grep `concurrency` нашёл только ci.yml:17). Два тега, запушенных подряд, запускают два полных гейта параллельно (каждый ~полный CI) и два publish-потока образов + два GH release.
- change: `concurrency: { group: release-${{ github.ref_name }}, cancel-in-progress: false }` (последовательность релизов, не отмена).
- reason: Релизный publish — единственная зона с contents/packages: write; параллельные релизы одного репозитория — лишний риск гонки за свежий тег в gh-release.
- risk: Очередь релизов затормозит параллельные теги (это и нужно); cancel-in-progress здесь вреден (не отменять полужен релиз).
- verification: Пуш двух тегов подряд — второй job в состоянии expected/queued до завершения первого.

---

# Производительность (R-001/R-002/R-003)

## R-001a — Статический baseline bundle-size можно снимать уже сейчас — CI его собирает и выбрасывает

- severity: low
- verdict: FIX
- current: `next build` выполняется в каждом гейте (site.yml:52-55) и печатает по-роутные размеры (First Load JS) в лог, но артефакт не сохраняется и порогов нет; next.config.ts не содержит analyzer/настроек бюджета (проверено чтением файла — только reactStrictMode, transpilePackages, output: standalone, rewrites). Зависимости web — компактный набор (site/web/package.json:12-21: react-query, zustand, lucide-react, tailwind; next 15.5.24) — перегруза на первый взгляд нет, но и измерения нет.
- change: В site.yml после `next build`: `actions/upload-artifact` с `.next` route-sizes (или текстом из лога step-summary) + лёгкий порог-гейт (скрипт сравнивает суммарный First Load JS с базой в documents/, fail при +X%). Порог — не микроменеджмент, а фиксация R-001 «bundle size» как числа, а не мнения.
- reason: Это единственная часть R-001, доказуемая без стенда: размеры бандлов детерминированы сборкой, которая уже идёт в CI.
- risk: Порог начнёт флапать между минорными версиями next — хранить базу рядом с lock-обновлениями, обновлять осознанно.
- verification: Артефакт в PR с числами по роутам; намеренное добавление тяжёлого импорта красит порог-гейт.

## R-001b — 261 unbounded `.all()` в routes; листинговые эндпоинты без limit

- severity: medium
- verdict: FIX
- current: grep `\.all()` по `site/server/src/routes` — 261 вхождение (таблиц БД-«ORM»: `db.orm.public.*.where(...).all()`). Явные листинги без limit: sellers.ts:36-40 — все PUBLISHED-карточки продавца (`where({ sellerId, status: "PUBLISHED" }).orderBy(...).all()`), resources.ts:165, 226, 270 и др. Контраст в том же дереве: updates.ts:78-82 честно делает `.limit(limit).offset(skip)`. Типа `findMany` в этом стеке нет (grep findMany по src — 0), весь доступ через orm-postgres runtime, поэтому «findMany без limit» из задания соответствует именно unbounded `.all()`.
- change: Инвентаризация 261 вызова с классификацией: point-lookup по id/уникальному ключу (безопасно), внутренняя агрегация по bounded-набору (приемлемо), публичный листинг (исправить на limit/offset по образцу updates.ts:78-82). Затем — пагинация листинговых эндпоинтов (sellers.ts:36-40 и аналоги) + индексный чек по EXPLAIN.
- reason: Это статически доказуемая часть R-001/R-002 (DB usage) — до нагрузочного стенда; каждый unbounded листинг — потенциальная деградация p95 при росте таблицы.
- risk: Добавление limit меняет клиентские контракты (D-004 плана отдельно аудитует пагинацию API) — изменения только по согласованному списку эндпоинтов, не разом.
- verification: `grep -c "\.all()" site/server/src/routes/*.ts` до/после; для каждого исправленного — тест с >limit строками (шаблон: pagination-тесты в integration-наборе).

## R-001c — Динамические замеры (p50/p95/p99, LCP, DB latency, mem/CPU) — DEFER до стенда

- severity: low
- verdict: DEFER
- current: В коде уже есть реальный источник метрик: lib/metrics.ts:1-12 — dependency-free Prometheus-реестр с заявленным набором `http_requests_total, http_5xx_total, http_latency, db_latency, redis_latency, payment_webhook_lag, payment_success_rate, …` (in-process counters/histograms). Ничего из R-001 (p50/p95/p99 API, Home latency, DB latency, memory, CPU) и R-002 (профилирование топ-эндпоинтов) не снимается статически — это живые величины.
- change: DEFER с методикой: (1) стенд: compose-поднятие postgres+redis+api+web (состав уже описан e2e-окружением e2e.yml:38-51); (2) нагрузка k6/autocannon по топ-маршрутам из логов `http_requests_total` (реальный traffic-список, не выдуманный); (3) p50/p95/p99 — из гистограммы `http_latency` (metrics.ts уже пишет count/sum/max по бакетам) либо выгрузка за окно; (4) DB latency — `db_latency` series + pg_stat_statements на стенде; (5) LCP Home — Lighthouse CI против web-сборки (сборка уже в CI); (6) mem/CPU — `docker stats`/cgroup за время прогона. Результаты зафиксировать как baseline-документ рядом с планом.
- reason: Честная граница аудита: эти числа нельзя получить чтением кода, а выдумывать их нельзя.
- risk: In-process метрики (metrics.ts:3 «kept in process memory») — без агрегации между репликами; на однопоцессной топологии (задокументированной worker/index.ts:25) приемлемо.
- verification: Существование baseline-документа + графика/выгрузки, а не «на глаз»; повторяемость прогона ±N%.

## R-003a — Конкурентные инварианты checkout/webhook/refund/ledger/disputes покрыты; publish/heartbeat — частично

- severity: low
- verdict: KEEP (с двумя FIX-хвостами, они в S-004a и O-003a)
- current: tests/concurrency — 7 файлов ровно по списку R-003: checkout (parallel-checkout.test.ts:72+ — exactly-one license под Promise.all), webhook (duplicate-webhook.test.ts — повторная и параллельная доставка, инвариант «эффект ровно один раз» в шапке), payout/settlement (ledger/parallel-settlement, ledger/balance-race), disputes (parallel-transition), idempotency (idempotency-key.test.ts — same-key replay/conflict/parallel 409). License activation и resource publish — на API-уровне: management.test.ts:202-209 покрывает деградацию heartbeat в UNKNOWN через runMonitoringSweep; publication-pipeline.test.ts покрывает publish-пайплайн.
- change: Оставить как есть; хвосты: (1) публикация ресурса под параллельной нагрузкой — покрыта only-функционально (см. E-002 в аудите 04 о гонке dedup-уведомлений), (2) provider outage под конкурентностью — FIX в S-004a.
- reason: Набор уже целенаправленно соответствует R-003; дублировать нечего.
- risk: Concurrency-тесты выполняются в общем CI только потому, что vitest.config.ts:24 включает tests/concurrency — при любом разделе suite'а (см. O-003b) их нельзя выронить без потери гейта exactly-once.
- verification: `pnpm exec vitest run tests/concurrency` зелёный; список файлов соответствует матрице R-003 (checkout/webhook/payout/activation/publish/heartbeat/notifications — закрыто 7 тестами + management).

---

# Отказоустойчивость (S-001..S-004)

## S-001a — Worker crash: claim/backoff/dead-letter/CAS покрыты тестами; reclaim PROCESSING-сирот и graceful requeue — нет

- severity: medium
- verdict: FIX
- current: Покрыто (tests/integration/api/platform/outbox.test.ts): транзакционный emit — откат события вместе с доменным действием (`:95-106`), claim → PROCESSING/attempts+1/payload (`:127-156`), claim limit + oldest-first (`:158-177`), fail → backoff 2^n×30s с будущим availableAt, скрытие от claim, повторный claim (`:181-218`; кривая — lib/events.ts:50-59), dead-letter после maxAttempts и навсегда-скип (`:220-246`), CAS duplicate-claim (`:249-275`). Не покрыто: (1) **восстановление после жёсткого крэша** — `reclaimOrphanedProcessing()` (worker/index.ts:195-216) возвращает PROCESSING-сироты в PENDING при буте, но это локальная функция worker'а (не экспортирована) и ни один тест её не вызывает (grep `reclaim|orphan` по tests/ — 0 релевантных); (2) graceful requeue mid-batch — requeueClaimed (`:219-228`) и цикл `if (stopping) { await requeueClaimed(event); continue; }` (`:335-342`) — без тестов. Крэш между `claimBatch` (CAS PENDING→PROCESSING, events.ts:176-178) и `completeEvent` оставляет строку PROCESSING навсегда — ровно это чинит бут-reclaim, и ровно это не проверено.
- change: Вынести `reclaimOrphanedProcessing`/`requeueClaimed` из worker/index.ts в lib/events.ts (там уже живут claim/complete/fail — events.ts:153-298) и добавить интеграционные тесты: (а) вручную оставить строку PROCESSING → вызвать reclaim → статус PENDING, attempts сохранён, logSystem-след; (b) идемпотентность reclaim (второй прогон — 0); (c) graceful path: вызов requeueClaimed для CLAIMED-строки → PENDING. Изменение — только перенос кода, не поведение.
- reason: S-001 требует «Kill worker during claim/processing/completion/retry — verify recovery»; сегодня recovery после processing-крэша реализован, но не доказан ни одним тестом, а reclaim — главная защита от навсегда застрявших PROCESSING.
- risk: Перенос функций трогает worker-бут — регрессия закрыта тем, что логика не меняется; тест (a) требует уметь инжектировать PROCESSING-строку — прямой update через db.orm доступен в тестах (уже используется в outbox.test.ts:206-208, 231-233).
- verification: Новый тест в tests/integration/api/platform/outbox.test.ts или отдельном файле; `pnpm exec vitest run tests/integration/api/platform/outbox` зелёный; сценарий «kill -9 воркера между claim и complete» на стенде — после бута строка уходит в PENDING и обрабатывается.

## S-001b — Настоящая двух-воркерная гонка claim не симулирована

- severity: low
- verdict: FIX
- current: Тест честно оговаривает: «a true two-worker race is not simulated here — see lib/events.ts» (outbox.test.ts:9-11); CAS-защита доказана на уровне «вторая партия claimBatch не видит PROCESSING-строку» (`:249-275`) и `updateAndCount` с устаревшим where = 0 строк (`:269-272`, механизм events.ts:175-177). Реальной параллельности (два одновременных claimBatch через Promise.all) нет.
- change: Один тест в tests/concurrency/platform/: `Promise.all([claimBatch(db), claimBatch(db)])` по N PENDING-строкам → сумма уникальных id = N, ни одна не задвоена, attempts у каждой = 1.
- reason: Дешёвый тест закрывает единственное честно заявленное ограничение покрытия outbox-консюммера; место — существующая concurrency-директория (vitest.config.ts:24).
- risk: Тест на реальной параллельности может флапать при плохом CAS — это и есть его ценность (CAS в claimBatch построчный, events.ts:173-179).
- verification: Новый тест зелёный многократно (`--repeat`), суммарная уникальность claimed id.

## S-002a — DB restart: worker-цикл устойчив конструкцией (проверяемо кодом), API-путь и реальный рестарт не покрыты

- severity: medium
- verdict: DEFER
- current: Worker: catch вокруг всего poll-цикла пишет `worker_outbox_poll_failed` и продолжает крутиться вечно (worker/index.ts:344); бут-reclaim терпит недоступную БД без падения (`:385-389` — catch → return -1). Т.е. рестарт БД воркер переживает на уровне кода — но теста нет: grep `ECONNREFUSED|P1001|connection error` по src/tests — 0 провокаций, все тесты скипаются при недоступной БД (шаблон `dbAvailable`, например outbox.test.ts:22-30) вместо того, чтобы её провоцировать. API: клиент — «голый» postgres() без политики переподключения (site/server/src/prisma/db.ts:6-9, весь файл — 9 строк); поведение requests при рестарте (500-шторм и восстановление пула) нигде не зафиксировано.
- change: DEFER с методикой (нужен живой/контейнерный стенд): (1) testcontainers-тест: поднять postgres, прогнать компактный набор (checkout + outbox), в середине `docker stop`/`start` контейнера БД, засечь: время до первого успешного запроса после возврата, отсутствие застрявших PROCESSING (их подхватит reclaim), отсутствие потерянных транзакций emit (инвариант outbox.test.ts:95-106); (2) на стенде с реальным compose — то же против API: череда запросов во время рестарта → все ошибки 5xx с корректным кодом, после возврата — 200 без рестарта процесса. Если методика покажет вечные 500 после рестарта — отдельный FIX на retry-политику пула.
- reason: R/S-сценарий «Restart DB during active workload» по определению динамический; статически можно утверждать только устойчивость worker-цикла (доказано кодом) и отсутствие какой-либо политики у API-клиента (доказано db.ts:6-9).
- risk: Тест с рестартом контейнера хрупок в hosted-CI (сервисы GitHub Actions — docker-контейнеры на том же хосте, restart возможен, но tie к конкретному механизму) — потому testcontainers, а не `docker restart` по имени сервиса.
- verification: Записанный в отчёт baseline «время до восстановления»; повторяемый testcontainers-тест в CI (опционально, помеченный как slow).

## S-003a — Redis restart: fail-open/fail-closed реализован и задокументирован, но не покрыт ни одним тестом

- severity: medium
- verdict: FIX
- current: Поверхность Redis: rate limiting (lib/rateLimit.ts:3), activity-кэш (lib/activity.ts:17), служебный disconnect в worker/index.ts:542 и index.ts:57; комментарий redis.ts:1 «rate limiting, sessions» устарел — сессии в БД (routes/auth.ts:314-316, `db.orm.public.Session`), очереди на Redis нет (outbox — DB-only, events.ts:107-298), блокировки — in-process (keyLock.ts:11-25, без Redis). Политика деградации реализована: bulk-лимитер fail-open, security-лимитеры fail-closed (rateLimit.ts:12-16), fail-closed путь — 503 «Rate limiter temporarily unavailable» (`:69-74,90,107,149-153`), глобальный лимитер — fail-open с опцией RATE_LIMIT_FAIL_CLOSED (`:99-100`), activity-кэш — fail-open с TTL-страховкой (activity.ts:118-146, `Redis outage must never break the read layer` `:125`). Тестов отказа нет: redis в tests/ используется только для чистки ключей (grep — activity.test.ts:33, thread-follow.test.ts:30, creator-follow.test.ts:39, articles.test.ts:40), vitest.config.ts:36-38 лишь занижает таймауты подключения.
- change: Один unit/integration-тест «Redis недоступен»: поднять app с REDIS_URL на заведомо мёртвом порту (REDIS_CONNECT_TIMEOUT/REDIS_MAX_RETRIES_PER_REQUEST/REDIS_ENABLE_OFFLINE_QUEUE уже настраиваются, redis.ts:8-12) и проверить три ветки: (1) bulk-эндпоинт отвечает 200 (fail-open, rateLimit.ts:69-74 else-ветка); (2) login/strict — 503 (fail-closed, `:107`); (3) activity-листинг отдаёт данные из БД без кэша (activity.ts:120-126). Опционально — флип RATE_LIMIT_FAIL_CLOSED=true → global тоже 503.
- reason: S-003 требует проверки деградации по каждому использованию (cache/rate limit/queue/lock); два из четырёх (queue, lock) безопасны конструктивно (DB-only/in-process), но реализованная политика rate-limit/кэша никем не защищена от регрессии — один рефакторинг молча превратит fail-closed в fail-open (или наоборот).
- risk: Тест фиксирует 503 на login при недоступном Redis — это заявленная политика (brute-force защита, rateLimit.ts:12-14); если продукт решит иначе — править тест и код одновременно.
- verification: Новый тест красный при подмене политики (поменять failClosed: false → true в strict-лимитере и увидеть падение), зелёный в CI.

## S-004a — Provider outage: verify-refetch/idempotency/webhook-dedup покрыты; failure-ветка createPayment не покрыта; у провайдерских fetch нет таймаута

- severity: high
- verdict: FIX
- current: Покрыто: (1) webhook-путь — persist-before-effect с уникальным [provider, providerEventId, eventType] и short-circuit на уже PROCESSING/PROCESSED (payments.ts:377-410), повторная и параллельная доставка доказаны (duplicate-webhook.test.ts, инвариант «ровно один раз» в шапке), транспортная аутентичность — три suite'а (payments-webhook-yookassa/tbank/crypto.test.ts через fetch-boundary harness payments-harness.ts:30-38); (2) no false purchase — Payment-строка создаётся только после успешного provider.createPayment (payments.ts:215-223 сервисный путь, `:270-277` ресурсный), двойной capture отсечён уникальными индексами (`:302-308` — payment_purchase_captured_uq/payment_orderitem_captured_uq); (3) retry покупателя — Idempotency-Key на create (`payments.ts:138` withIdempotency), при ошибке хендлера запись FAILED → повторное исполнение разрешено (idempotency.ts:77,120,170-172); (4) provider 404/расхождение сумм — reconciliation ловит MISSING_PROVIDER/AMOUNT_MISMATCH/STATUS_MISMATCH и переживает падение шага (reconciliation.test.ts:91-96, 179-181, 194-220). Не покрыто: (1) **failure-ветка createPayment** — ни одного теста с отклонённым createPayment (grep mockRejectedValue/mockRejected/createPayment.*reject по tests/ — 0); кодовая ветка существует (payments.ts:296-316: 500 «Failed to create payment», purchase остаётся PENDING) — но «no duplicate order / clear user status» при таймауте провайдера не доказаны; (2) **таймаут транспорта**: все 4 вызова провайдера — голый `fetch` без AbortSignal/timeout (lib/yookassa.ts:74, 117, 151, 189) — зависший провайдер держит HTTP-запрос и PROCESSING-запись idempotency (409 «in progress» для повторов, idempotency.ts:113-118) до внешнего таймаута среды.
- change: (1) Тест: `createYooKassaPayment.mockRejectedValue` (шаблон мока уже в payment-transitions.test.ts:12-19) → POST /payments/create → 500, Payment-строки нет, Purchase остаётся PENDING, повтор с тем же Idempotency-Key после FAILED — исполняется заново (idempotency.ts:77) и при успехе мока завершается; (2) добавить `signal: AbortSignal.timeout(N)` в 4 fetch yookassa.ts (+tbank/crypto-адаптеры тем же паттерном) и тест «fetch висит → ошибка таймаута, статус покупки не меняется».
- reason: S-004 требует именно таймаут/недоступность провайдера; сегодня недоступность не детерминирована вообще (висит до глобальных лимитов undici), а её наблюдаемые следствия не защищены тестом.
- risk: Таймаут на createPayment может резать медленные, но живые ответы провайдера — выбрать N по SLA провайдера (секунды десятков) и вынести в env; тест (1) фиксирует, что FAILED-покупка не тиражируется (уникальные индексы уже на страже).
- verification: Новый тест в tests/integration/api/commerce/; для таймаута — тест с vi.useFakeTimers или mock fetch, висящий на Promise; в release-gate ничего менять не нужно.

## S-004b — «Clear user status» при outage: статусы честные, но UI-путь не проверен

- severity: low
- verdict: DEFER
- current: Серверная часть статусов консистентна: покупка остаётся PENDING (payments.ts:247-250 — create отклоняет не-PENDING), терминальные FAILED-ветки проставляют purchase.status=FAILED с lastError (`:472-477, 504, 520, 533, 547, 577, 600-603`), провайдер никогда не «угадывается» в терминальное состояние (комментарий payment-yookassa.ts:44 «never guessed to a terminal state» — бизнес-истина только по re-fetch). Что не покрыто: E2E-сценарий «покупатель видит честный статус и может повторить» — 9 spec'ов (tests/e2e/**) не содержат outage-кейса (grep outage/timeout по spec — 0), но это осознанный уровень: E2E гоняет happy-path journeys.
- change: DEFER: после S-004a(1) добавить один e2e/интеграционный сценарий «create → провайдер недоступен → пользователь возвращается на страницу покупки → видит PENDING/ошибку → повтор успешен», если продукт подтверждит важность UI-пути.
- reason: Требование S-004 «clear user status» про UX-наблюдаемость; на HTTP-уровне статус уже проверяем тестом S-004a(1).
- risk: Минимальный; E2E-инфраструктура для фейкового отказа провайдера потребует мок-провайдера в dev-среде (YOOKASSA_ENABLED=false даёт 503 — payments.ts:286-294, что само по себе уже наблюдаемо).
- verification: Спека в tests/e2e/marketplace/ или integration-тест на 503-ветку (disabled provider), статус покупки после отказа.

---

# Сводка

| Severity | Количество | Находки |
|---|---|---|
| critical | 0 | — |
| high | 3 | O-004a (image validation отсутствует), O-004b (release ctest — no-op, всегда зелёный), S-004a (provider outage: нет таймаута транспорта, failure-ветка не покрыта) |
| medium | 7 | O-002a (6× install без кэша), O-002b (web build ×3), O-003a (нет path-фильтров), R-001b (261 unbounded .all()), S-001a (reclaim/requeue не покрыты), S-002a (DB restart не покрыт), S-003a (Redis fail-политика не покрыта) |
| low | 13 | O-001 (инвентарь KEEP), O-001c (module continue-on-error KEEP), O-001d (glob depth-2), O-001e (contracts MERGE), O-001f (SHA-пинки), O-002c (schema apply ×2 MERGE), O-003b (не шардировать тесты DEFER), O-004c (release concurrency), R-001a (bundle baseline), R-001c (динамика DEFER), R-003a (concurrency-набор KEEP), S-001b (two-worker race), S-004b (UI-статус DEFER) |

Итого 23 находки. По вердиктам: FIX — 14, DEFER — 4, MERGE — 2, KEEP — 3 (без действий), DELETE/TRIGGER_ONLY — 0. Быстрые победы: O-004b (одна строка в release.yml), O-002a (cache: pnpm ×4), O-001d (globstar), O-004c (concurrency-блок). Стратегические: O-004a (image smoke до push), S-001a (вынести reclaim в lib/events.ts + тест), S-003a/S-004a (тесты на деградацию).
