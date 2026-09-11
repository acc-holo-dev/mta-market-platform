# Модуль ↔ сервер маркета: интеграция

Интеграционный протокол (PLAN-005) — **не** DRM machine API. Клиентская часть:
`module/src/drm/market_client.{hpp,cpp}`; Lua-функции: `module/src/functions/drm/market.cpp`.

## Endpoints сервера

| Endpoint | Назначение | Данные |
|---|---|---|
| `POST /integration/heartbeat` | proof-of-control токеном владения; питание верификации/мониторинга/LIVE | `{token, state?, players?, maxPlayers?}` → `{status, monitoring, verification}` |
| `POST /integration/review-tokens` | одноразовый токен отзыва игрока | `{token, note?, ttlMinutes?}` → `{reviewToken, expiresAt}` |

Интеграционный токен (`smk_...`) доказывает управление сервером; данные —
только агрегаты (счётчики). Никаких player identity / IP / chat / телеметрии
(privacy-by-default, см. [../architecture/SECURITY.md](../architecture/SECURITY.md)).

## Lua API (market-функции)

| Функция | Действие |
|---|---|
| `mta_market_configure { api, token }` | задать endpoint и интеграционный токен |
| `mta_market_start()` | запустить фоновый heartbeat-цикл |
| `mta_market_stop()` | остановить цикл |
| `mta_market_report_players { players, maxPlayers }` | обновить счётчики онлайна |
| `mta_market_status()` | статус последнего heartbeat |
| `mta_market_review_token { note?, ttlMinutes? }` | запросить одноразовый токен отзыва |

## Реальный MTA-сервер (интеграционные тесты)

Инфраструктура реальных серверных прогонов — `module/tools/mock-server/`
(harness `mta_server.py`; запускается через `mta test integration`).

Каталог **намеренно не хранится в Git** целиком: бинарники сервера скачаны
и закреплены локально, никогда не коммитятся (см. корневой `.gitignore`).

Закреплённые сборки: **Windows** (MTA Server64.exe, распаковка локальным
7-Zip) и **Linux** (multitheftauto_linux_* tarball, распаковка `tar`);
`pinned_build()` выбирает сборку под текущий хост. На Windows harness
управляет консолью сервера (Win32 key injection); на Linux headless-сервер
управляется через stdin/stdout pipe.

Обязанности harness (реализованы CLI `mta server` + интеграционным прогоном):

- скачать конкретную закреплённую сборку MTA-сервера (платформа +
  архитектура + ревизия + URL + checksum в lock-файле);
- распаковать в локальный throwaway-каталог сервера;
- скопировать собранный модуль (`<module-name>.dll` / `.so`) в `x64/modules/`;
- установить минимальный тестовый ресурс и конфигурацию сервера;
- запустить сервер, дождаться готовности, снять консольный лог;
- остановить сервер и проверить ожидаемые результаты и коды выхода.

Lua-ресурсы интеграционного набора: `tests/module/integration/`
("sdkintegration" + "sdkintegration2"); сценарии сами печатают маркеры
`SCENARIO <name>: PASS|FAIL`, harness парсит их из лога сервера; маркеры
регрессий (`STALE_TASK_DELIVERED*`, …) обязаны отсутствовать. Прогон —
блокирующий CI-gate (Windows + Linux).
