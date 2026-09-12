# PLAN-014 — Dependency, Toolchain, CI & Platform Maintenance Modernization

## 0. ЦЕЛЬ

Работа выполняется в основном репозитории:

```text
acc-holo-dev/mta-market-platform
```

Цель PLAN-014 — провести **единый контролируемый технический overhaul зависимостей, toolchain, GitHub Actions, Dependabot и связанных инфраструктурных проверок**.

План должен решить весь накопившийся dependency/toolchain debt одним согласованным этапом.

Это НЕ задача:

```text
pnpm update --latest
```

и НЕ задача:

```text
обновить всё до максимально новой версии
```

Необходимо провести:

```text
audit
→ compatibility analysis
→ controlled updates
→ CI stabilization
→ E2E stabilization
→ toolchain verification
→ security verification
→ documentation sync
```

Главный результат:

```text
MTA Market Platform
=
актуальный
+
совместимый
+
воспроизводимый
+
проверяемый
+
поддерживаемый
```

---

# 1. ГЛАВНЫЙ ПРИНЦИП

Каждая зависимость рассматривается не сама по себе, а как часть ecosystem.

Например:

```text
Next.js
React
TypeScript
ESLint
eslint-config-next
typescript-eslint
```

рассматриваются как единый frontend toolchain.

А:

```text
Prisma CLI
Prisma Client
@prisma/orm-postgres
ORM adapters
database migrations
```

рассматриваются как единая database/ORM subsystem.

Не допускается ситуация:

```text
package A updated
package B incompatible
package C still old
```

только ради того, чтобы закрыть Dependabot PR.

---

# 2. ОБЯЗАТЕЛЬНО ПЕРЕД ИЗМЕНЕНИЯМИ

Сначала провести полный audit.

Изучить:

```text
package.json
pnpm-workspace.yaml
pnpm-lock.yaml
turbo.json

site/web/package.json
site/server/package.json

module/
CMakeLists.txt
CMakePresets.json

.github/workflows/

dependabot configuration
.gitignore
.gitattributes

documents/
contracts/
tests/
infrastructure/
scripts/
config/
```

Определить:

* фактические версии;
* версии в lockfile;
* transitive dependencies;
* peer dependencies;
* runtime dependencies;
* dev dependencies;
* packages, используемые только CI;
* packages, используемые только build;
* packages, связанные с security;
* packages, связанные с production runtime;
* packages, связанные с payments;
* packages, связанные с DRM;
* packages, связанные с database.

Не начинать upgrade до завершения inventory.

---

# 3. СОЗДАТЬ DEPENDENCY MATRIX

Создать технический dependency matrix.

Формат:

```text
Package
Current version
Locked version
Target version
Latest stable
Update type
Direct/Transitive
Used by
Peer dependencies
Breaking changes
Risk
Tests required
Rollback
Decision
```

Для каждой зависимости выбрать одно:

```text
UPDATE
HOLD
DEFER
IGNORE
REMOVE
REPLACE
```

---

# 4. КЛАССИФИКАЦИЯ

Использовать четыре класса.

## GREEN

Patch/minor updates с низким риском.

Примеры:

```text
lucide-react
nodemailer patch
zod minor/patch
типовые @types/*
мелкие utility dependencies
```

Они могут обновляться в рамках общей maintenance batch.

---

## YELLOW

Связанные ecosystem packages:

```text
React
ESLint
typescript-eslint
Turbo
Playwright
AWS SDK
testing libraries
```

Обновляются группой.

---

## RED

Major/toolchain migrations:

```text
Next.js major
React major
TypeScript major
Tailwind major
Prisma major
Node major
pnpm major
```

Требуют отдельного compatibility analysis внутри этого плана.

Нельзя автоматически переходить на major только потому, что версия новее.

---

## BLACK

Изменения, потенциально затрагивающие security/financial/DRM correctness:

```text
payment libraries
crypto libraries
DRM dependencies
database engine/adapters
storage semantics
authentication libraries
```

Требуют ручного technical review и обязательного полного regression pass.

---

# 5. DEPENDABOT

Текущую модель Dependabot пересмотреть полностью.

Цель:

```text
не десятки постоянных PR
а контролируемый maintenance flow
```

Целевая политика:

```text
Security updates
→ немедленно

Patch updates
→ grouped

Minor updates
→ grouped / periodic

Major updates
→ manual
```

Не держать бессмысленный поток отдельных PR по одной зависимости.

---

# 6. DEPENDABOT GROUPS

Создать логические группы.

Пример:

```yaml
groups:
  javascript-patch:
    update-types:
      - patch

  frontend-minor:
    patterns:
      - next
      - react
      - react-dom
      - eslint
      - eslint-*
      - typescript-eslint/*

  testing:
    patterns:
      - vitest
      - @vitest/*
      - playwright
      - @playwright/*

  tooling:
    patterns:
      - turbo
      - prettier
```

Но перед финальной конфигурацией проверить реальные package names.

Не использовать wildcard groups, которые могут неожиданно подтягивать major migrations.

---

# 7. IGNORE POLICY

Определить явную ручную политику для:

```text
Next major
Prisma major/RC
Tailwind major
TypeScript major
Node major
```

Пока migration не проверена, автоматический Dependabot не должен постоянно создавать новые PR для неё.

---

# 8. LOCKFILE

Обязательно проверить:

```text
pnpm-lock.yaml
```

Не использовать:

```bash
pnpm update --latest
```

без контроля.

После изменений dependency graph должен быть воспроизводимым.

Проверить:

```text
fresh install
frozen lockfile install
build
tests
```

---

# 9. PNPM

Root repository должен иметь единую версию pnpm.

Проверить:

```text
packageManager
corepack
GitHub Actions
Dockerfiles
startup.py
local development
```

Нельзя иметь:

```text
CI = pnpm X
Docker = pnpm latest
developer = pnpm Y
```

Установить одну поддерживаемую версию.

Docker должен использовать ту же версию.

GitHub Actions должен использовать ту же версию.

---

# 10. NODE

Определить официальную Node.js version matrix.

Например:

```text
development
CI
Docker
production
```

должны использовать совместимую версию.

Не использовать:

```text
Node latest
```

в production build.

---

# 11. NEXT.JS

Текущую Next.js ветку сначала зафиксировать как официально поддерживаемую для PLAN-014.

Затем определить:

```text
Current
Latest patch
Latest minor
Latest major
```

Если major migration выполняется:

```text
Next
+
React
+
eslint-config-next
+
related tooling
```

обновлять согласованно.

Проверить:

```text
SSR
routing
middleware
API usage
images
static assets
build
production start
E2E
```

---

# 12. REACT

Проверить:

```text
react
react-dom
@types/react
@types/react-dom
Next compatibility
```

Не обновлять React отдельно от Next compatibility matrix.

---

# 13. TYPESCRIPT

Провести compatibility analysis.

Проверить:

```text
typescript
typescript-eslint
Next.js
React types
Prisma generated types
Vitest
```

Если major upgrade потенциально требует большого количества fixes:

не растягивать случайные изменения по всему проекту.

Сделать контролируемую migration sequence:

```text
toolchain
→ compile
→ lint
→ tests
→ build
→ E2E
```

---

# 14. ESLINT

Привести в согласованное состояние:

```text
eslint
eslint-config-next
typescript-eslint
plugins
```

Проверить:

```text
web
server
shared
scripts
CI
```

Не оставлять один package на старой major ветке, если другой package уже перешёл на новую.

---

# 15. TAILWIND

Текущую Tailwind 3 design system учитывать как dependency of PLAN-013.

Не переходить на Tailwind 4 исключительно ради latest-version status.

Сначала определить:

```text
может ли текущий дизайн остаться на 3.x
```

или:

```text
есть ли обоснованная необходимость в 4.x
```

Если миграция на Tailwind 4 выполняется, она должна пройти как полноценная compatibility migration:

```text
tokens
theme
globals.css
utilities
components
responsive
build
visual QA
E2E
```

Не делать «частичный Tailwind 4».

---

# 16. PRISMA

Это критический этап.

Провести отдельный audit всей Prisma subsystem.

Проверить:

```text
@prisma/client
prisma
@prisma/orm-postgres
adapters
generated client
migrations
PostgreSQL
tests
```

Обнаруженное состояние:

```text
Prisma Client 7.x
+
Prisma ORM 8.x RC
+
Prisma CLI 8.x RC
```

нельзя оставить как случайную комбинацию.

Определить единую официальную supported state.

Возможные решения:

```text
A:
полностью перейти на стабильную Prisma ветку

B:
остаться на стабильной 7.x связке

C:
осознанно использовать 8.x после compatibility validation
```

Не выбирать RC только потому, что Dependabot предлагает более свежую RC.

---

# 17. PRISMA MIGRATION SAFETY

Если Prisma обновляется:

обязательно проверить:

```text
schema
generated client
migration engine
adapters
transactions
raw queries
relation behavior
enum behavior
indexes
constraints
```

Особенно:

```text
commerce
payments
ledger
licenses
disputes
```

После миграции:

```text
fresh DB
existing DB
migration from previous version
rollback strategy
```

---

# 18. DATABASE

После dependency upgrades проверить:

```text
migrations
transaction semantics
connection pooling
Postgres adapter
health checks
```

Нельзя считать migration успешной только потому, что:

```bash
pnpm prisma migrate deploy
```

завершился без ошибок.

Проверить реальное приложение.

---

# 19. VITEST

Оставить Vitest в согласованном stable version.

Проверить:

```text
unit
integration
concurrency
coverage
CI
```

Не обновлять просто ради нового номера версии.

---

# 20. PLAYWRIGHT

Playwright должен быть синхронизирован:

```text
package
browser install
CI image
E2E config
```

После upgrades обязательно запускать:

```text
all E2E
```

---

# 21. TURBO

Проверить:

```text
turbo
workspace dependency graph
cache
build order
test order
```

После изменений убедиться, что:

```text
site/web
site/server
shared
```

корректно собираются в monorepo.

---

# 22. AWS / STORAGE DEPENDENCIES

Проверить SDK packages.

Особенно:

```text
S3
presigned URLs
multipart upload
artifact download
content storage
```

Не допустить behavioral regression.

---

# 23. PAYMENT DEPENDENCIES

Любое изменение payment dependency требует:

```text
unit
integration
webhook
amount validation
currency validation
idempotency
refund
failure
```

Полный payment regression.

---

# 24. DRM / CRYPTO

Dependency upgrade не должен менять:

```text
canonicalization
signatures
verification
challenge
lease
installation binding
encryption
key handling
```

После изменений:

```text
DRM integration tests
crypto tests
protocol tests
```

обязательны.

---

# 25. GITHUB ACTIONS

Провести полный audit:

```text
.github/workflows/
```

Проверить:

```text
actions versions
Node runtimes
pnpm versions
permissions
cache
artifacts
secrets
environment
concurrency
job dependencies
```

---

# 26. ACTION VERSIONS

Все actions должны быть на поддерживаемых stable versions.

Не оставлять старые Node 20 runtime actions там, где уже есть безопасная поддерживаемая версия.

Каждый upgrade action должен пройти workflow validation.

---

# 27. CI ARCHITECTURE

Сохранить единую модель:

```text
Validate
   ↓
Contracts
   ↓
Security
   ↓
Tests
   ↓
Module
   ↓
Site
   ↓
E2E
   ↓
Publish
```

Publish не должен запускаться, если blocking checks не прошли.

---

# 28. MODULE TOOLCHAINS

Текущие проблемы:

```text
Windows MinGW
Windows MSVC
Linux Clang
```

исследовать отдельно.

Не скрывать проблему за:

```yaml
continue-on-error: true
```

без документированной support policy.

Для каждого toolchain установить:

```text
SUPPORTED
BEST-EFFORT
UNSUPPORTED
```

---

# 29. LINUX GCC

Linux GCC должен оставаться canonical release toolchain, если по результатам audit это подтверждается.

Он должен быть:

```text
blocking
```

для release.

---

# 30. WINDOWS

Если Windows поддерживается:

необходимо исправить:

```text
netdb.h
timegm
POSIX assumptions
platform abstractions
```

Если Windows официально не поддерживается:

зафиксировать compatibility matrix и убрать ложное ожидание, что build должен быть green.

---

# 31. CLANG

Исследовать:

```text
recursive Json incomplete-type
```

Определить:

```text
source code issue
compiler issue
standard library issue
template issue
```

Затем:

```text
FIX
или
SUPPORTED TOOLCHAIN POLICY
```

---

# 32. E2E

Текущий E2E PLAN-013 не прошёл.

Поэтому PLAN-014 обязан включать:

```text
root cause analysis
fix
rerun
```

Не просто обновить Playwright.

Определить:

```text
какой selector/route/state сломался
почему
почему локально был green
почему CI был red
```

---

# 33. REPOSITORY VALIDATION

Исправить оставшиеся policy violations.

Проверить:

```text
.md only in documents/
tests only in tests/
logs only in logs/
standard naming
no duplicate directories
```

Добавить automated validation.

---

# 34. SECRET / SUPPLY CHAIN SECURITY

Проверить:

```text
dependency vulnerabilities
transitive dependencies
lockfile
GitHub secret scanning
Dependabot alerts
license issues
unreviewed dependencies
```

Особенно security-sensitive packages.

---

# 35. LICENSE AUDIT

Проверить dependency licenses.

Не принимать новую dependency без проверки:

```text
license
transitive licenses
compatibility with project policy
```

Если политика лицензий ещё не формализована:

создать соответствующий документ в:

```text
documents/
```

---

# 36. REMOVE UNUSED DEPENDENCIES

Во время audit найти:

```text
unused direct dependencies
duplicate libraries
obsolete polyfills
unused test packages
obsolete compatibility libraries
```

Удалять только после проверки реального usage.

---

# 37. PACKAGE BOUNDARIES

Проверить, что packages находятся в правильном месте:

```text
root dependencies
site/web dependencies
site/server dependencies
shared dependencies
test-only dependencies
```

Не держать backend dependency только потому, что она когда-то была добавлена в root.

---

# 38. LOCKED VERSIONS

Определить, какие зависимости должны быть:

```text
exact
minor-pinned
caret
tilde
```

Для critical runtime dependencies не использовать слишком свободные ranges без причины.

---

# 39. VERSION COMPATIBILITY MATRIX

Создать:

```text
documents/architecture/TOOLCHAIN.md
```

В нём зафиксировать:

```text
Node
pnpm
Next
React
TypeScript
ESLint
Prisma
Tailwind
Vitest
Playwright
Turbo
CMake
GCC
Clang
MSVC
```

с поддерживаемыми версиями.

Документ находится только в `documents/`.

---

# 40. DEPENDENCY POLICY

Создать:

```text
documents/architecture/DEPENDENCY-POLICY.md
```

Определить:

```text
patch policy
minor policy
major policy
security updates
Dependabot policy
manual review
lockfile policy
critical dependencies
```

---

# 41. NO AUTO-MERGE FOR MAJOR

Dependabot major updates не должны автоматически merge'иться.

Для major нужен:

```text
technical review
compatibility check
full CI
browser verification
```

---

# 42. PERFORMANCE

После dependency updates проверить:

```text
Next build
bundle sizes
client JS
server bundle
Docker image sizes
build time
E2E time
```

Не допускать существенной деградации без причины.

---

# 43. BUILD REPRODUCIBILITY

Проверить:

```text
fresh clone
fresh install
fresh build
fresh tests
Docker build
Docker runtime
```

на clean environment.

Цель:

```text
один repository
один lockfile
один toolchain policy
воспроизводимый build
```

---

# 44. DOCUMENTATION SYNC

После завершения обновить только необходимые документы:

```text
documents/architecture/TOOLCHAIN.md
documents/architecture/DEPENDENCY-POLICY.md
documents/architecture/TESTING.md
documents/architecture/DEPLOYMENT.md
documents/development/CURRENT.md
documents/development/reference/NEXT-PHASE.md
```

Не создавать `.md` вне `documents/`.

---

# 45. NO PRODUCT CHANGES

PLAN-014 не должен добавлять:

```text
new marketplace functionality
new community features
new server features
new trust features
new UI surfaces
```

Фокус только:

```text
dependencies
toolchain
CI
build
security
testing
maintenance
```

---

# 46. MIGRATION STRATEGY

Обновления проводить пакетными волнами.

### Wave 1

Low-risk:

```text
patch/minor
utility packages
types
icons
small fixes
```

### Wave 2

Testing/tooling:

```text
Vitest
Playwright
Turbo
ESLint
```

### Wave 3

Frontend toolchain:

```text
React
Next
TypeScript
Tailwind
```

только если совместимость подтверждена.

### Wave 4

Database:

```text
Prisma
ORM
adapters
```

отдельно.

### Wave 5

Native tooling:

```text
GCC
Clang
MSVC
MinGW
CMake
```

### Wave 6

Final integration:

```text
full CI
full E2E
security
Docker
production runtime
```

---

# 47. COMMIT STRATEGY

Не создавать один огромный commit на несколько десятков несвязанных изменений.

Использовать логические commits:

```text
chore(deps): update low-risk dependencies
chore(test): modernize test toolchain
chore(ci): update github actions
chore(toolchain): align node and pnpm
chore(prisma): normalize prisma toolchain
chore(module): normalize native toolchains
chore(dependabot): refine dependency policy
fix(e2e): resolve plan-013 browser regressions
```

---

# 48. ACCEPTANCE — DEPENDENCIES

* [ ] dependency inventory создан;
* [ ] dependency matrix создан;
* [ ] outdated dependencies классифицированы;
* [ ] security updates обработаны;
* [ ] low-risk updates применены;
* [ ] major upgrades осознанно рассмотрены;
* [ ] unused dependencies проверены;
* [ ] lockfile актуален;
* [ ] fresh install проходит.

---

# 49. ACCEPTANCE — TOOLCHAIN

* [ ] Node policy определена;
* [ ] pnpm policy определена;
* [ ] TypeScript policy определена;
* [ ] ESLint compatibility подтверждена;
* [ ] Next compatibility подтверждена;
* [ ] React compatibility подтверждена;
* [ ] Prisma stack унифицирован;
* [ ] Tailwind strategy определена;
* [ ] Vitest актуален;
* [ ] Playwright актуален;
* [ ] Turbo актуален.

---

# 50. ACCEPTANCE — CI

* [ ] GitHub Actions используют поддерживаемые action versions;
* [ ] единый Platform CI работает;
* [ ] Validate проходит;
* [ ] Contracts проходит;
* [ ] Security проходит;
* [ ] Tests проходит;
* [ ] Module Linux проходит;
* [ ] Site проходит;
* [ ] E2E проходит;
* [ ] Publish блокируется при blocking failure;
* [ ] concurrency policy работает.

---

# 51. ACCEPTANCE — NATIVE MODULE

* [ ] Linux GCC проходит;
* [ ] Windows policy определена;
* [ ] MinGW policy определена;
* [ ] MSVC policy определена;
* [ ] Clang policy определена;
* [ ] CMake работает;
* [ ] module integration проходит.

---

# 52. ACCEPTANCE — SECURITY

* [ ] vulnerability audit проходит;
* [ ] secret scan проходит;
* [ ] lockfile проверен;
* [ ] critical dependency changes reviewed;
* [ ] payment dependencies reviewed;
* [ ] DRM dependencies reviewed;
* [ ] no accidental credentials tracked.

---

# 53. ACCEPTANCE — E2E

* [ ] PLAN-013 E2E regression найдена;
* [ ] root cause установлена;
* [ ] fix реализован;
* [ ] E2E запускается из clean environment;
* [ ] все обязательные E2E проходят.

---

# 54. ACCEPTANCE — PRODUCTION

* [ ] production build проходит;
* [ ] Docker build проходит;
* [ ] production container starts;
* [ ] backend runtime работает;
* [ ] frontend runtime работает;
* [ ] migrations работают;
* [ ] health работает;
* [ ] readiness работает;
* [ ] graceful shutdown работает.

---

# 55. DEPENDABOT RESULT

В конце не должно быть бессмысленного потока:

```text
PR #1
PR #2
PR #3
PR #4
PR #5
...
```

Цель:

```text
security PRs
+
grouped maintenance PRs
+
manual major migrations
```

Dependabot должен помогать поддерживать проект, а не диктовать архитектуру.

---

# 56. ФИНАЛЬНАЯ ПРОВЕРКА

Выполнить:

```text
fresh checkout
↓
install
↓
lint
↓
typecheck
↓
unit tests
↓
integration tests
↓
concurrency tests
↓
contract tests
↓
security tests
↓
module build
↓
site build
↓
E2E
↓
Docker build
↓
production runtime verification
```

Только после успешной цепочки считать PLAN-014 завершённым.

---

# 57. FINAL REPORT

Агент обязан предоставить:

```text
1. Dependency inventory
2. Dependency matrix
3. Updated packages
4. Held packages
5. Deferred major migrations
6. Removed dependencies
7. Prisma decision
8. Next decision
9. TypeScript decision
10. Tailwind decision
11. Node/pnpm decision
12. CI changes
13. Dependabot changes
14. E2E root cause and fix
15. Native toolchain status
16. Security audit
17. Performance impact
18. Production build result
19. Full test result
20. Remaining technical debt
21. Exact commits
22. Final supported toolchain matrix
```

Для каждой зависимости обязательно указывать:

```text
CURRENT
TARGET
REASON
RISK
RESULT
```

---

# 58. КРИТИЧЕСКОЕ ПРАВИЛО

Запрещено считать план завершённым только потому, что:

```text
package.json обновлён
```

или:

```text
Dependabot PR merged
```

PLAN-014 завершён только когда:

```text
Dependencies
    ↓
Toolchain
    ↓
CI
    ↓
Tests
    ↓
E2E
    ↓
Module
    ↓
Security
    ↓
Production
```

прошли одну согласованную проверочную цепочку.

---

# 59. ФИНАЛЬНОЕ СОСТОЯНИЕ

После PLAN-014 MTA Market Platform должен иметь:

```text
единый dependency policy
+
контролируемые обновления
+
воспроизводимый toolchain
+
чистый lockfile
+
нормальный Dependabot
+
стабильный GitHub Actions
+
рабочий E2E
+
определённую native compatibility matrix
+
актуальную security policy
+
актуальную documentation
```

И только после этого возвращаться к следующему крупному продуктово-архитектурному этапу MTA Market.
