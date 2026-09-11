# TOOLCHAIN — поддерживаемая toolchain-матрица

Статус: NORMATIVE (PLAN-014 §39).
Дата: 2026-09-12.

Правило: один repository, один lockfile, одна toolchain policy. Версии ниже —
официально поддерживаемое состояние; обновления — только через
[DEPENDENCY-POLICY.md](DEPENDENCY-POLICY.md).

## Node / pnpm

| Компонент | Версия | Где зафиксировано |
|---|---|---|
| Node.js | **22 LTS** (>=22, <23) | `engines.node` (root), CI `setup-node` (`node-version: '22'`), Docker `node:22-alpine`, локальная разработка |
| pnpm | **9.15.0** | `packageManager` (root), Docker `corepack prepare pnpm@9.15.0`, CI `pnpm/action-setup@v6` (читает `packageManager`), локальный corepack |

`package.json` `engines`: `node >=20` — минимальная совместимость; официальная
поддерживаемая ветка — 22 LTS. Node 20 удалён с GitHub-раннеров (2026-09-16)
и не используется ни в одном гейте. Node 24 не используется: Docker приведён
к той же ветке, что CI и локальная разработка (воспроизводимость, §43).

## Frontend toolchain (единый ecosystem, обновляется группой)

| Package | Поддерживаемая версия | Примечание |
|---|---|---|
| Next.js | 15.5.x | зафиксировано как official branch для PLAN-014; Next 16 + React/ecosystem pairing — отдельная контролируемая миграция |
| React / React-DOM | 19.x | не обновлять отдельно от Next compatibility |
| TypeScript | 5.9.x | TS 6/7 — RED-класс (см. DEPENDENCY-POLICY), миграция отдельным планом |
| Tailwind CSS | 3.4.x | dependency of PLAN-013 design system; Tailwind 4 — только как полная compatibility migration (§15) |
| ESLint / eslint-config-next | 8.57.1 / 15.1.3 | ESLint 9+ (flat config) мигрируется вместе с eslint-config-next 16 — одним согласованым шагом |

## Database / ORM subsystem

| Package | Версия | Примечание |
|---|---|---|
| @prisma/client | **7.10.0 (exact)** | клиентская ветка, спаренная с 8 RC toolchain; стабильного 8.x client не существует |
| prisma (CLI) | **8.0.0-rc.13** | официальный `latest` registry-канала; осознанный выбор PLAN-014 §16 (вариант C) — код уже зависит от 8.x API (contract emit, db update, orm-adapter'ы) |
| @prisma/orm-postgres | **8.0.0-rc.9** | driver adapter для PostgreSQL |
| @prisma/cli-engine | **0.3.0** | парная версия, заявленная rc.13 |
| PostgreSQL | 16 | services CI (postgres:16-alpine), Docker compose |

Унификация: `contract emit` даёт идентичный storageHash на старой и новой
линии; `db update` идемпотентен; полная vitest-система (392) зелёная.

## Testing / build tooling

| Package | Версия |
|---|---|
| Vitest | 5.0.x |
| Playwright | 1.63.x (браузеры ставятся `playwright install --with-deps chromium` в CI) |
| Turbo | 2.10.x |
| tsx | 4.x |

## Native module toolchains (подробности: [MODULE.md](MODULE.md) §8/§9)

| Toolchain | Статус |
|---|---|
| Linux GCC (Ubuntu, + Ninja + OpenSSL) | **SUPPORTED — release path**, блокирующий CI-гейт |
| Linux Clang | report-only (build probe, не блокирует) — самореференциальные члены `mta::drm::Json` не инстанцируются libstdc++-14 под clang; см. MODULE.md §8 |
| Windows MinGW / MSVC | NOT SUPPORTED (POSIX-слой без `_WIN32`-гвардов; CI win-* — build-probe) |
| CMake | >= 3.27 (presets `linux-gcc`) |

## GitHub Actions runtime

| Action | Версия |
|---|---|
| actions/checkout | v7 |
| actions/setup-node | v7 |
| actions/setup-python | v7 |
| actions/upload-artifact | v7 |
| pnpm/action-setup | v6 |
| gitleaks/gitleaks-action | v3 |
| docker/setup-buildx-action / login-action | v4 |
| docker/metadata-action | v6 |
| docker/build-push-action | v7 |
| msys2/setup-msys2 | v2 |
| ilammy/msvc-dev-cmd | v1 |
| softprops/action-gh-release | v2 |

Все actions на Node 24 runtime (Node 20 runtime удалён с GitHub-раннеров
16.09.2026 — PLAN-014 §26). Обновления отслеживает Dependabot
(github-actions, minor+patch группой; majors — отдельные PR, §41).
