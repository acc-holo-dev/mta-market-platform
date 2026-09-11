# Сборка модуля

## Требования

- CMake **≥ 3.27** (жёсткий минимум: и `cmake_minimum_required`, и пресеты v6), Ninja.
- Компилятор C++20 (GCC/Clang/MSVC). Проверено: GCC 15.2 + OpenSSL 3.5 (Linux x64).
- Python 3.11+ для CLI `mta` (tomllib).
- OpenSSL development headers для DRM client (`libssl-dev`).

## Команды

```bash
# из module/
cmake --preset linux-gcc          # configure (Ninja, Release, build/linux-gcc)
cmake --build --preset linux-gcc  # base.so + sdk_tests + sdk_docgen
ctest --preset linux-gcc          # sdk_tests (Lua harness) + config-parser тесты

# или через CLI
mta doctor && mta build && mta test
```

Артефакт: `module/build/linux-gcc/module/linux-x64/base.so` →
`mods/deathmatch/modules/` сервера. Имя/версия модуля — единственный
источник `module/config/module.toml` (`base` / 2.1.0). CPack ZIP (бинарник +
README): `cmake --build` + `cpack` → `build/linux-gcc/package/`.

Standalone DRM-тесты (без MTA-сервера, g++ + OpenSSL):

```bash
make -f module/src/drm/Makefile test   # → ALL TESTS PASSED
```

Python-harness тесты CLI/server-harness: `python -m unittest discover -s tests/module`
(12 тестов, stdlib).

Windows-пресеты: `win-msvc` (cl), `win-mingw` (полностью статический рантайм).
Ограничение (честно): Windows-сборка на момент PLAN-011 не проверялась на этой
машине — см. Blockers в [../development/CURRENT.md](../development/CURRENT.md).

## Структура сборки

| Путь | Содержимое |
|---|---|
| `module/CMakeLists.txt` | корень компонента: таргеты `mta_lua`, `sdk_core`, `sdk_base` (= base.so), `sdk_tests`, `sdk_docgen`, `sdk_spike_luac` |
| `module/config/cmake/` | TOML-ридер конфига, baseline-флаги (-Werror -Wconversion…), платформенные модули, install/CPack |
| `module/third_party/` | vendored Lua 5.1.5 (+LICENSE, MTA-ABI), MTA SDK headers (cmp-gate идентичности заголовков в CI) |
| `module/tools/` | `docgen.cpp` (генератор справки), `mta/` (Python CLI), `mock-server/` (harness реального сервера) |

Опции: `SDK_BUILD_TESTS=ON`, `SDK_SANITIZE` (ASan/UBSan), `SDK_UNITY`/`SDK_LTO`
(из module.toml), фичи `SDK_FEATURE_{ASYNC,USERDATA,EVENTS,OBJECTS}` —
отключённая фича исключает её sample-функции из сборки.

Примечание PLAN-011: DRM-исходники (`module/src/drm/`) исключены из unity-билда
(`SKIP_UNITY_BUILD_INCLUSION`) — независимые TU с одноимёнными internals;
OpenSSL линкуется через `find_package(OpenSSL)` (обе проблемы были
существующими дефектами старого CMake-пайплайна).

## Направление зависимостей исходников

```
module/src/functions   ->   module/src/library   ->   module/src/sdk
```

- Функция может использовать library-код.
- Library-код может использовать SDK (`<mta/sdk.hpp>` или `sdk/...` headers).
- Library-код НЕ должен зависеть от `module/src/functions/` и не должен
  сам регистрировать Lua-функции.
- Новый `.cpp` подхватывается сборкой автоматически (рекурсивный glob
  `src/**/*.cpp`, `CONFIGURE_DEPENDS`).

`library/base/` — framework-adjacent хелперы; остальное организуется по
доменам: `library/http/`, `library/json/`, `library/crypto/` — одна папка на тему.
