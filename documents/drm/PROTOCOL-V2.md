status: mirror
version: 1.0
last_verified: 2026-09-11

# DRM Protocol v2

Суть замороженного контракта протокола DRM v2, перенесённая в структуру
документации платформы. **Замороженный эталон остаётся в
[development/reference/old_drm-protocol-v2.md](../development/reference/old_drm-protocol-v2.md)**
— при расхождении этой страницы и эталона приоритет у эталона, при
расхождении эталона и кода приоритет у кода
(`site/server/src/lib/drm/protocol.ts` + `site/server/src/lib/drm/types.ts`).

Source of truth по константам и эндпоинтам: `site/server/src/lib/drm/protocol.ts`
(`DRM_PROTOCOL_VERSION = 2`, supported `[2]`). Клиентская реализация:
`module/src/drm/` (инвентарь — [module/DRM-CLIENT.md](../module/DRM-CLIENT.md)).
Машиночитаемые схемы живут в `contracts/drm/v2/` — каталог назначен, но
файлы схем ещё не добавлены (честная пометка; wire-контракт сегодня
компиляторно зафиксирован типами `types.ts`).

Изменение любой константы или эндпоинта = версия протокола v3, никогда
не правка на месте (см. [development/reference/README.md](../development/reference/README.md)).

---

## Эндпоинты (machine API, mounted at `/drm`)

Из `DRM_ENDPOINTS` в `site/server/src/lib/drm/protocol.ts`, реализация —
`site/server/src/routes/drm/v2.ts`:

| Endpoint | Method | Auth | Назначение |
|---|---|---|---|
| `/drm/v2/public-keys` | GET | public | Доверенные серверные ключи: `{keys: [{keyId, publicKey, status}], algorithm: "EdDSA", keyType: "ED25519"}` (ACTIVE + PREVIOUS). |
| `/drm/v2/installations` | POST | browser-authenticated владелец лицензии (INV-007), strict rate limit | Регистрация установки: `{publicKey, licenseId, mtaVersion, moduleVersion, serverSerial?, serverName?}` → `{installationId, challenge}` |
| `/drm/v2/installations/:id/verify` | POST | machine, strict rate limit | Proof-of-possession: `{installationId, challengeResponse}` — Ed25519-подпись сырых байт challenge |
| `/drm/v2/activate` | POST | machine (verified installation), strict rate limit | `{licenseId, installationId, nonce}` → подписанный lease |
| `/drm/v2/heartbeat` | POST | machine (active installation), standard rate limit | `{installationId, resourceId, uptime, lastError?}` → `{acknowledged, leaseValid, shouldUpdate, updateVersionId?}` |
| `/drm/v2/leases/:installationId/:resourceId` | GET | machine | Последний неистёкший подписанный lease или `null` |
| `/drm/v2/versions/:versionId/dek` | POST | machine (lease holder), strict rate limit | `{installationId, nonce, signature}` → `{dekId, dek, algorithm}` |

Примечание (из эталона): `GET /drm/v2/public-key` (единственное число) тоже
существует в route-файле и возвращает только ACTIVE ключ; каноническая карта
протокола называет `/drm/v2/public-keys` (множественное, rotation-aware).
Клиенты должны использовать plural-эндпоинт; асимметрия записана как
кандидат на очистку, замороженная карта в `protocol.ts` авторитетна.

## Поток активации

```text
 Browser (owner)                     Server (site/server)                Module (module/src/drm)
 ───────────────                     ────────────────────                ───────────────────────
 login (INV-007: license
 → purchase → buyerId == user)
        │
 POST /drm/v2/installations ────────► license проверена (ACTIVE),
 {publicKey, licenseId, ...}          installation CREATED,
                                      challenge = 32B random (base64, single use)
        ◄──────────────────────────── {installationId, challenge}
                                                                        sign challenge (raw bytes)
                                     POST /drm/v2/installations/:id/verify
                                     verifyChallengeResponse() ──── установка ACTIVE
        │
                                                                        nonce = 32B random (hex-64)
                                     POST /drm/v2/activate
                                     {licenseId, installationId, nonce}
                                     checks: installation ACTIVE и не revoked,
                                     license ACTIVE == bound license (INV-011),
                                     releaseStatus != YANKED (ADR-001),
                                     версия имеет ArtifactSignature
                                     nonce single-use server-wide
                                     sign canonical lease payload ────► {SignedLease}
                                                                        verify lease signature
                                                                        (GET /drm/v2/public-keys)
        │
                                                                        POST /drm/v2/heartbeat
                                                                        {installationId, resourceId,
                                                                         uptime, lastError?}
                                     {acknowledged, leaseValid, shouldUpdate}
        │
                                                                        POST /drm/v2/versions/:id/dek
                                                                        {installationId, nonce,
                                                                         signature = Ed25519 over
                                                                         base64("dek:<versionId>:<nonce>")}
                                     lease неистёкший для ЭТОЙ версии,
                                     unwrap DEK под DRM_MASTER_KEY ───► {dekId, dek, algorithm}
                                                                        AES-256-GCM расшифровка payload
```

1. Владелец аутентифицируется в браузере и регистрирует установку для
   лицензии, которой владеет (license → purchase → `buyerId` ==
   authenticated user; INV-007). Лицензия должна быть ACTIVE.
2. Сервер выдаёт single-use challenge (32 байта, base64).
3. Модуль подписывает сырые байты challenge; сервер проверяет → установка
   становится ACTIVE (доказано владение приватным ключом).
4. Модуль активируется со свежим nonce → сервер проверяет: установка ACTIVE
   и не revoked, лицензия ACTIVE и совпадает с привязанной (INV-011), релиз
   не YANKED (блокирует **новую** выдачу lease, ADR-001), у версии есть
   `ArtifactSignature` — затем подписывает и сохраняет lease.
5. Продление = повторная активация с новым nonce до истечения TTL.
6. Heartbeat обновляет `lastHeartbeat` и сообщает валидность lease.
7. Выдача DEK: для зашифрованной версии модуль доказывает владение
   (Ed25519 over `dek:<versionId>:<nonce>`) и обязан держать неистёкший
   lease именно для этой версии; сервер расшифровывает DEK под
   `DRM_MASTER_KEY` и отдаёт raw DEK по TLS. Мастер-ключ сервер не покидает.

## Структура lease payload

`SignedLease` / `LeasePayload` (`site/server/src/lib/drm/types.ts`) —
canonical JSON payload минус поле `signature`:

```json
{
  "protocolVersion": 2,
  "licenseId": "<uuid>",
  "installationId": "<uuid>",
  "resourceId": "<uuid>",
  "resourceVersionId": "<uuid>",
  "artifactHash": "<64 hex, sha256 артефакта версии>",
  "issuedAt": "<ISO 8601>",
  "expiresAt": "<ISO 8601, issuedAt + 604800 s>",
  "nonce": "<64 hex, single use>",
  "serverKeyId": "<uuid ACTIVE ServerSigningKey>",
  "capabilities": ["run", "update"],
  "signature": "<base64 Ed25519 над canonical payload выше>"
}
```

Правила связывания (инварианты):

- INV-011: lease связывает installation + license + resource/version.
  Установка навсегда привязана к своей лицензии при регистрации; активация
  с другой лицензией отклоняется (`DRM_LICENSE_INSTALLATION_MISMATCH`).
- Nonce single-use на весь сервер (`Lease.nonce` unique; повтор →
  `DRM_NONCE_ALREADY_USED`, HTTP 409) — replay-защита.
- `artifactHash` привязывает lease к точному подписанному артефакту.
- Capabilities: `'run' | 'update' | 'debug' | 'export'`; сервер сейчас
  выдаёт `['run', 'update']`.
- `serverKeyId`: клиенты проверяют подпись по доверенному набору ключей
  (`GET /drm/v2/public-keys` — ACTIVE + PREVIOUS); lease, проверяемый
  только отозванным ключом, отклоняется (`DRM_SERVER_KEY_REVOKED`).

Wire-типы: `InstallationRegistration`, `InstallationResponse`,
`ChallengeVerification`, `LeaseRequest`, `SignedLease`/`LeasePayload`,
`HeartbeatRequest/HeartbeatResponse` — `site/server/src/lib/drm/types.ts`.

## Константы (замороженные)

| Константа | Значение | Имя в `protocol.ts` |
|---|---|---|
| Версия протокола | `2` (supported: `[2]`) | `DRM_PROTOCOL_VERSION`, `DRM_SUPPORTED_PROTOCOL_VERSIONS` |
| Lease TTL | `604800` s (7 дней, продление через свежий nonce на `/drm/v2/activate`) | `LEASE_DURATION_SECONDS` |
| Допуск расхождения часов | `90` s (валидация expiry и issuance) | `CLOCK_SKEW_SECONDS` |
| Challenge | 32 случайных байта, base64, single use | `CHALLENGE_BYTES` |
| Nonce | 32 случайных байта, hex (64 символа), single use | `NONCE_BYTES`, `NONCE_HEX_LENGTH` |
| Алгоритм DEK | `aes-256-gcm` | `DEK_ALGORITHM` |
| Размер DEK | 32 байта | `DEK_KEY_BYTES` |
| GCM nonce обёртки DEK | 12 байт | `DEK_WRAP_NONCE_BYTES` |
| Мастер-ключ сервера (env) | `DRM_MASTER_KEY` (base64, 32 байта; клиентам не выдаётся) | `DRM_MASTER_KEY_ENV` |

## Коды ошибок (`DRM_ERROR_CODES` в `types.ts`)

| Код | Значение | HTTP (route mapping) |
|---|---|---|
| `DRM_INVALID_LICENSE` | лицензия отсутствует/невалидна | 404 |
| `DRM_LICENSE_NOT_OWNED` | аутентифицированный пользователь не владеет лицензией (INV-007) | 403 |
| `DRM_LICENSE_INSTALLATION_MISMATCH` | активация с лицензией, к которой установка не привязана (INV-011) | 403 |
| `DRM_INSTALLATION_NOT_FOUND` | неизвестная установка | 404 |
| `DRM_INSTALLATION_NOT_VERIFIED` | challenge не верифицирован / не ACTIVE | 403 |
| `DRM_INSTALLATION_REVOKED` | установка отозвана | 403 |
| `DRM_INVALID_CHALLENGE_RESPONSE` | challenge подписан не тем ключом | 401 |
| `DRM_NONCE_ALREADY_USED` | replay nonce | 409 |
| `DRM_NONCE_EXPIRED` | nonce вне окна валидности | — (reserved) |
| `DRM_LEASE_EXPIRED` | lease старше `expiresAt` + skew | — (client verification) |
| `DRM_INVALID_SIGNATURE` | подпись lease/DEK-proof невалидна | 401 |
| `DRM_PROTOCOL_VERSION_MISMATCH` | неподдерживаемая версия протокола | — (reserved) |
| `DRM_ARTIFACT_HASH_MISMATCH` | рассинхронизация версия/артефакт | 404 |
| `DRM_INSUFFICIENT_CAPABILITIES` | lease не покрывает запрошенную версию (включая YANKED-gate) | 403 |
| `DRM_SERVER_KEY_REVOKED` | ключ подписи отозван/истёк | — (client verification) |

Error envelope: `{"error": {"code": "<DRM_...>", "message": "..."}}`.

## DEK envelope (G-005)

- На каждую версию ресурса — уникальный 32-байтный DEK
  (`ArtifactEncryption.dekId`).
- Шифрование payload: AES-256-GCM, свежий 12-байтный nonce, хранится как
  `{algorithm, nonce, tag, ciphertext}`; authenticated — любая порча
  payload ломает расшифровку.
- Обёртка DEK: AES-256-GCM под `DRM_MASTER_KEY`, хранится как
  `{wrappedDek, wrapNonce, wrapTag}`; unwrap только на сервере
  (`site/server/src/lib/artifact/encryption.ts`).

## Deprecation v1 (A-007)

`POST /drm/activate` и `POST /drm/verify` возвращают **410 Gone**
(`site/server/src/routes/drm.ts`). Эндпоинты управления лицензиями
(`GET /drm/my-licenses`, `DELETE /drm/installations/:id`) остаются.
Двойного окна активации и compatibility-моста нет.

## Тесты

Централизованное дерево `tests/` — единственное место тестов (PLAN-010
Rule 002, прогон `pnpm test` из корня); в `site/server/tests/` остались
те же наборы с относительными импортами.

- `tests/integration/api/drm-v2.test.ts` — полный серверный цикл протокола
  по реальному HTTP: register → verify → activate → heartbeat → lease
  lookup, негативы INV-007, отказ при повторном nonce, 410 на v1.
- `tests/integration/api/drm-g6.test.ts` — clock skew, окно ротации
  серверного ключа, выдача DEK с proof-of-possession, цикл revoke
  (поведение ADR-001).
- `tests/unit/site/drm-crypto.test.ts` — challenge/lease криптография,
  canonical bytes.
- Модуль: `make -f module/src/drm/Makefile test` — byte-match canonical
  JSON, Ed25519, AEAD, key store, HTTP client, верификация lease
  (ALL TESTS PASSED, Linux x64, 2026-09-09).
