# DRM — машинный протокол v2 (контракт)

Статус: протокол v2 — **замороженный контракт**. При расхождении код и
замороженный документ выигрывают у этого файла; изменение любой константы
требует bump версии протокола (v3), не правки на месте.

Замороженный контракт: [old_drm-protocol-v2](../development/reference/old_drm-protocol-v2.md).
Внимание: в нём пути legacy-репозитория сайта (`apps/…`), исторические — в
монорепо им соответствуют `site/server/...` (таблица соответствия:
[SYSTEM](../architecture/SYSTEM.md)). Продуктовое обоснование:
[PROJECT](../product/PROJECT.md).
Revocation-политика: [ADR-001](../adr/ADR-001-drm-lease-revocation.md).

> Машиночитаемые wire-схемы протокола: `contracts/drm/v2/` (protocol.yaml,
> lease/challenge/installation/errors JSON Schema) — формализованы в PLAN-011
> и сверены с кодом (`site/server/src/lib/drm/{protocol,types}.ts`,
> `module/src/drm/license_client.{hpp,cpp}`). Этот файл — человекочитаемый
> компаньон к ним.

Реализация: `site/server/src/routes/drm/v2.ts` (роуты),
`site/server/src/lib/drm/{service,crypto,protocol,types}.ts` (логика),
CLI `site/server/src/cli/drm.ts` (`pnpm drm:keygen|drm:info|…`).

## Константы (`lib/drm/protocol.ts`)

| Константа | Значение |
|---|---|
| `DRM_PROTOCOL_VERSION` | `2`; поддерживается `[2]` |
| `LEASE_DURATION_SECONDS` | `604800` (7 дней; продление — новый nonce на `/drm/v2/activate`) |
| `CLOCK_SKEW_SECONDS` | `90` |
| Challenge | 32 случайных байта, base64, одноразовый |
| Nonce | 32 байта, hex (64 символа), одноразовый |
| DEK | `aes-256-gcm`, 32 байта, wrap-nonce 12 байт (GCM) |
| Мастер-ключ сервера | env `DRM_MASTER_KEY` (base64, 32 байта); клиенту никогда не отдаётся |
| Ключ подписи сервера | Ed25519; приватный — env `DRM_SERVER_PRIVATE_KEY`; публичный — в БД (`ServerSigningKey`, статус ACTIVE/PREVIOUS); генерация `createServerSigningKey()` (CLI `drm:keygen`), приватный показывается один раз |

## Endpoints (смонтированы на `/drm`, `app.ts`)

Лимиты: `strictRateLimit` (10/мин, fail-closed) на установку/verify/activate/dek;
`standardRateLimit` на heartbeat/leases. Таблица из
`DRM_ENDPOINTS` (`protocol.ts`) + фактические роуты (`v2.ts`):

| Endpoint | Метод | Auth | Назначение |
|---|---|---|---|
| `/drm/v2/public-keys` | GET | публичный | доверенные ключи сервера (ACTIVE + PREVIOUS) для ротации: `{keys:[{keyId,publicKey,status}], algorithm:"EdDSA", keyType:"ED25519"}` |
| `/drm/v2/public-key` | GET | публичный | только ACTIVE ключ (исторический маршрут; канонический — plural, см. примечание в замороженном контракте) |
| `/drm/v2/installations` | POST | браузерный владелец лицензии (`authenticate`; INV-007), strict | регистрация установки: `{publicKey, licenseId, mtaVersion, moduleVersion, serverSerial?, serverName?}` → `201 {installationId, challenge}` (challenge: base64, 32 байта, одноразовый) |
| `/drm/v2/installations/:id/verify` | POST | машина, strict | доказательство владения приватным ключом: `{challengeResponse}` (Ed25519-подпись сырых байт challenge) → `{verified:true, installationId}` |
| `/drm/v2/activate` | POST | машина (verified installation), strict | `{licenseId, installationId, nonce}` → подписанный lease |
| `/drm/v2/heartbeat` | POST | машина, standard | `{installationId, resourceId, uptime, lastError?}` → `{acknowledged, leaseValid, shouldUpdate, updateVersionId?}` |
| `/drm/v2/leases/:installationId/:resourceId` | GET | машина, standard | актуальный неистёкший lease или `404 {code:"LEASE_NOT_FOUND"}` |
| `/drm/v2/versions/:versionId/dek` | POST | машина (держатель lease), strict | `{installationId, nonce, signature}` — Ed25519 над ASCII `dek:<versionId>:<nonce>` → `{dekId, dek, algorithm}` |

Кривые случаи в роутах: повторная верификация —
`409 {code:"INSTALLATION_ALREADY_VERIFIED"}`; дубликат установки —
`409 {code:"INSTALLATION_EXISTS"}`; плохой формат nonce —
`400 {code:"INVALID_NONCE"|"INVALID_REQUEST"}`; state-ошибки лицензии/подписи
версии — `409 {code:"LICENSE_STATE_ERROR"}`; `DRM_SERVER_PRIVATE_KEY` не
задан — `500 {code:"SERVER_MISCONFIGURED"}`; версия не зашифрована —
`404 {code:"NOT_ENCRYPTED"}`.

## Подписанный lease

Подпись — Ed25519 над каноническим JSON payload **без поля `signature`**
(ключи рекурсивно отсортированы, без пробелов, UTF-8, числовые токены дословно;
сервер `canonicalJSON()` в `lib/artifact/crypto.ts`, модуль —
`module/src/drm/json.cpp` — байт-совпадают).

```json
{
  "protocolVersion": 2,
  "licenseId": "<uuid>",
  "installationId": "<uuid>",
  "resourceId": "<uuid>",
  "resourceVersionId": "<uuid>",
  "artifactHash": "<64 hex (sha256 артефакта версии)>",
  "issuedAt": "<ISO 8601>",
  "expiresAt": "<issuedAt + 604800 s>",
  "nonce": "<64 hex, одноразовый>",
  "serverKeyId": "<uuid ACTIVE ServerSigningKey>",
  "capabilities": ["run", "update"],
  "signature": "<base64 Ed25519>"
}
```

Сервер выдаёт capabilities `["run","update"]`; полный словарь
`'run'|'update'|'debug'|'export'` (`types.ts`). Клиент проверяет подпись по
`serverKeyId` из набора `/drm/v2/public-keys`.

Привязки (инварианты):

- INV-011: установка навсегда привязана к лицензии при регистрации;
  активация с другой лицензией — `DRM_LICENSE_INSTALLATION_MISMATCH` (403).
- INV-010: приватный ключ установки никогда не покидает её key store
  (`module/src/drm/key_store.cpp`: AES-256-GCM файл, 0600); сервер видит
  только публичный ключ.
- Nonce одноразовый глобально (`Lease.nonce` уникальный; повтор —
  `DRM_NONCE_ALREADY_USED`, 409) — replay-защита.
- `artifactHash` привязывает lease к точной подписанной версии.

## Ownership и flow активации

1. Владелец аутентифицируется в браузере и регистрирует установку для своей
   лицензии (покупка → `buyerId` == пользователь; INV-007). Лицензия ACTIVE.
2. Сервер выдаёт одноразовый challenge.
3. Модуль подписывает сырые байты challenge; сервер проверяет → установка
   ACTIVE (доказано владение приватным ключом).
4. Модуль активирует с новым nonce; сервер проверяет: установка ACTIVE и не
   REVOKED, лицензия ACTIVE и совпадает с привязанной, версия не YANKED
   (YANKED блокирует **новые** lease, I-005), у версии есть валидная
   `ArtifactSignature` — подписывает и сохраняет lease.
5. Продление — повторная активация с новым nonce до истечения.
6. Heartbeat обновляет `lastHeartbeat` и отвечает о валидности lease и
   наличии обновления (`shouldUpdate`, `updateVersionId` — новый PUBLISHED
   релиз, не YANKED/DEPRECATED).
7. Выдача DEK (для зашифрованных версий): модуль доказывает владение ключом
   (`dek:<versionId>:<nonce>`) и держит неистёкший lease на эту версию;
   сервер разворачивает DEK под `DRM_MASTER_KEY` и отдаёт raw DEK по TLS.
   Мастер-ключ никогда не покидает сервер.

DEK-конверт (G-005): на версию — уникальный DEK (`ArtifactEncryption`),
payload AES-256-GCM `{algorithm, nonce, tag, ciphertext}`, wrap DEK тем же
`DRM_MASTER_KEY` (`{wrappedDek, wrapNonce, wrapTag}`), unwrap только на
сервере (`lib/artifact/encryption.ts`).

## Отзыв (ADR-001)

- Data-plane: lease, подписанный до отзыва, остаётся криптографически валидным
  до естественного `expiresAt` (+90 c skew).
- Management-plane: после `INSTALLATION_REVOKED` новые активация/verify/
  heartbeat — 403 `DRM_INSTALLATION_REVOKED`.
- Быстрый срез: отозвать установку **и** revoke/rotate серверный ключ
  (lease, проверяемый только отозванным ключом, отбивается
  `DRM_SERVER_KEY_REVOKED`).
- Ротация ключа: `rotateServerSigningKey()` — ACTIVE → PREVIOUS (остаётся
  доверенным), новая пара ACTIVE; покрытие перехода — `/drm/v2/public-keys`.

## Коды ошибок (`DRM_ERROR_CODES`, `lib/drm/types.ts`)

Обёртка: `{"error":{"code":"<DRM_…>","message":"…"}}`.

| Код | HTTP (маппинг `v2.ts`) |
|---|---|
| `DRM_INVALID_LICENSE` | 404 |
| `DRM_LICENSE_NOT_OWNED` (INV-007) | 403 |
| `DRM_LICENSE_INSTALLATION_MISMATCH` (INV-011) | 403 |
| `DRM_INSTALLATION_NOT_FOUND` | 404 |
| `DRM_INSTALLATION_NOT_VERIFIED` | 403 |
| `DRM_INSTALLATION_REVOKED` | 403 |
| `DRM_INVALID_CHALLENGE_RESPONSE` | 401 |
| `DRM_NONCE_ALREADY_USED` | 409 |
| `DRM_INVALID_SIGNATURE` | 401 |
| `DRM_ARTIFACT_HASH_MISMATCH` | 404 |
| `DRM_INSUFFICIENT_CAPABILITIES` | 403 |
| `DRM_NONCE_EXPIRED`, `DRM_LEASE_EXPIRED`, `DRM_PROTOCOL_VERSION_MISMATCH`, `DRM_SERVER_KEY_REVOKED` | зарезервированы (клиентская/обратная проверка; в HTTP-маппинге отсутствуют) |

Неизвестная ошибка сервиса → `500 {code:"SERVER_ERROR"}`.

## Deprecation v1 (`routes/drm.ts`)

- `POST /drm/activate` и `POST /drm/verify` — **410 Gone**, без
  dual-активации и моста совместимости; тело объясняет и указывает на
  `/drm/v2/*`.
- Управление лицензиями осталось: `GET /drm/my-licenses` (`authenticate`) —
  лицензии завершённых покупок с установками; `DELETE /drm/revoke/:licenseId`
  (`authenticate`, владелец) — ревокация лицензии и её установок
  (`REVOKED`). (В замороженном документе указан `DELETE
  /drm/installations/:id`; фактически реализован revoke по лицензии — код
  выигрывает у документа.)
- Ревокация отдельной установки (`revokeInstallation` в сервисе) доступна на
  уровне `lib/drm/service.ts`; отдельного роута для неё нет.

## Тесты-свидетельства

- `tests/integration/api/drm-v2.test.ts` — серверный цикл протокола,
  INV-007/INV-011, реюз nonce, v1 410.
- `tests/integration/api/drm-g6.test.ts` — clock skew, окно ротации ключа,
  DEK с possession-proof, revoke-цикл (ADR-001).
- `tests/unit/site/drm-crypto.test.ts` — challenge/lease криптография,
  канонические байты.
- Модуль: `make -f module/src/drm/Makefile test` — канонический JSON
  (байт-матч), Ed25519, AEAD, key store, HTTP client, проверка lease.
