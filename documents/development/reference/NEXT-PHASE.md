# NEXT-PHASE — решение о следующей фазе

STATUS: DECISION ANALYSIS
DATE: 2026-09-11

Этот документ определяет состояние, которое необходимо получить следующим Development Plan. Он не является самим Plan.

## Метод

Следующая фаза выбирается сравнением:

- `documents/product/`
- `documents/architecture/`
- `documents/development/CURRENT.md`
- фактического состояния кода, тестов и CI
- открытого технического долга

Правило: не выбирать следующую фичу только потому, что она есть в списке идей. Сначала подтверждается разрыв между желаемым состоянием и реально работающей платформой.

## Текущее состояние

PLAN-011 завершил создание unified monorepo. Сейчас MTA Market уже содержит:

- identity/authentication и public profiles;
- marketplace/resources/sellers/commerce;
- payments, ledger и licensing;
- DRM v2;
- server registration/verification/monitoring;
- global community/forum;
- server news/updates и reviews;
- follows и notifications;
- live/activity Home;
- articles/content;
- creator/resource/thread follow;
- creator analytics;
- centralized tests, contracts, config, infrastructure и startup.py.

Фактический критерий завершения этих областей подтверждается записями PLAN-005…PLAN-011 и текущими CI/E2E результатами.

## Главные остаточные разрывы

### 1. Production verification

Продукт неоднократно проходил локальную/CI проверку, но полноценная production verification остаётся отдельным этапом. Нужны реальные staging/production smoke checks, rollback verification, backup/restore и проверка runtime image.

### 2. Financial correctness under concurrency

Ledger и settlement требуют multi-instance exactly-once guarantees и формальных database invariants/unique constraints. Application-level key locking недостаточно как единственный механизм при нескольких инстансах.

Checkout/payment flows также должны иметь формальную idempotency model.

### 3. Runtime architecture hardening

Backend пока сохраняет route-heavy legacy structure. Следующий refactor должен идти по bounded contexts и application/domain boundaries без массового переписывания behavior.

### 4. Contract completeness

`contracts/` уже формализует существующие API/DRM/module/event contracts, но OpenAPI покрытие ещё не полное. Нужно постепенно переводить публичный API в machine-readable contract и проверять его в CI.

### 5. Cross-platform module support

Linux/GCC — рабочий release path. Windows и Clang остаются report-only и требуют отдельного hardening этапа.

## Что НЕ является следующим автоматическим шагом

- Guarantee/Deals не должны начинаться только потому, что они есть в Vision/Ideas.
- Новые content/community features не выбираются без анализа их фактического product gap.
- Dependabot PR не являются development phase.

## Правило выбора следующего Plan

Следующий Plan должен переводить платформу из текущего состояния в новое проверяемое рабочее состояние. Перед созданием Plan необходимо выбрать один primary outcome из:

1. Production Ready Platform;
2. Transactionally Correct Commerce;
3. Modular Backend Architecture;
4. Contract-Driven Platform;
5. Cross-Platform Module.

Decision должен опираться на фактический риск и product value, а не на количество доступных задач.
