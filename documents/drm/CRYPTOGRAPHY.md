status: mirror
version: 1.0
last_verified: 2026-09-11

# DRM — криптография

Инвентарь криптопримитивов DRM v2: сервер (`site/server/src/lib/drm/`,
`site/server/src/lib/artifact/`) и клиент (`module/src/drm/`). Замороженный
эталон —
[development/reference/old_drm-protocol-v2.md](../development/reference/old_drm-protocol-v2.md);
при расхождении кода и документа код выигрывает.

## Ed25519 подписи

**Генерация и верификация (сервер):**
`site/server/src/lib/drm/crypto.ts` + `site/server/src/lib/artifact/crypto.ts`.

- Keygen: `generateKeyPairSync('ed25519')` с DER-кодировками — приватный
  ключ PKCS8, публичный SPKI, обе строки base64
  (`generatePublisherKeypair()`; тот же генератор используется и для
  установок — `generateInstallationKeypair()`).
- Подпись/проверка — `crypto.sign(null, bytes, key)` / `crypto.verify(...)`:
  Ed25519 не использует дайджест, подписываются сырые байты payload.
- Challenge/response: подпись покрывает **сырые байты challenge**
  (base64-декодированные), не JSON.
- Lease: подпись покрывает canonical JSON payload минус поле `signature`
  (`leaseSigningBytes()` в `site/server/src/lib/drm/crypto.ts`).
- DEK possession proof: Ed25519-подпись над base64-кодировкой ASCII-строки
  `dek:<versionId>:<nonce>`.

**Клиент:** `module/src/drm/ed25519.cpp` (OpenSSL) — та же семантика;
canonical serializer байт-в-байт совпадает с серверным (см. ниже).

## Canonical JSON (вход подписи)

Сервер — `canonicalJSON()` в `site/server/src/lib/artifact/crypto.ts`;
клиент — `module/src/drm/json.cpp` (байт-совпадение проверено
тест-векторами). Правила:

- ключи отсортированы рекурсивно;
- без пробелов (compact);
- UTF-8 байты;
- поле `signature` удаляется из подписываемого payload;
- number-токены сохраняются дословно (без переформатирования) — клиентский
  сериализатор хранит числовой литерал как строку и выводит как есть.

Lease: подписываются canonical JSON байты lease payload (поле `signature`
исключено). Хэш lease для хранения/сравнения — SHA-256 того же canonical
представления (`hashLease()`).

## AES-256-GCM (AEAD)

Сервер — `site/server/src/lib/artifact/encryption.ts` (алгоритм
`aes-256-gcm`, имя заморожено как `DEK_ALGORITHM` в
`site/server/src/lib/drm/protocol.ts`).

- **Payload версии**: ключ = per-version DEK (32 байта), nonce = свежие
  **12 байт** на каждую операцию шифрования. Формат хранения (base64-поля):
  `{algorithm, nonce, tag, ciphertext}` — authenticated; любая порча
  ciphertext/nonce/tag ломает расшифровку.
- **Обёртка DEK**: DEK шифруется мастер-ключом `DRM_MASTER_KEY` (base64
  от 32 байт), хранится `{wrappedDek, wrapNonce, wrapTag}`; unwrap только
  на сервере.
- **Клиент**: `module/src/drm/aead.cpp` — blob-формат
  `nonce(12) ‖ ciphertext ‖ tag(16)` (используется и key store'ом).

## SHA-256 хэширование артефактов

- Хэш файла артефакта: SHA-256 над содержимым архива — считается при
  загрузке (`site/server/src/routes/upload.ts`, `hashFile()` /
  `createHash('sha256')` в `site/server/src/lib/artifact/crypto.ts`).
- `manifest.sha256` — 64 hex-символа; валидация формата в
  `site/server/src/lib/artifact/manifest.ts`.
- `artifactHash` в lease привязывает lease к точному артефакту версии;
  целостность манифеста связывается через `hashManifest(manifest)`
  (canonical JSON → SHA-256) внутри подписи артефакта
  (`createSigningPayload(): manifestHash + "|" + artifactHash`).

## Форматы ключей

| Ключ | Формат | Пример размера (base64) |
|---|---|---|
| Приватные серверные ключи (подпись lease, подпись артефактов) | Ed25519 **PKCS8 DER**, base64 | 88 символов |
| Публичные ключи (серверные, установок) | Ed25519 **SPKI DER**, base64 | 44 символа (32 байта) |
| `DRM_MASTER_KEY` | сырые 32 байта, base64 | 44 символа |
| DEK | сырые 32 байта (по TLS выдаётся base64) | — |

Валидация форматов: `isValidPublicKey()` (44 B SPKI), `isValidSignature()`
(64 B подпись) — `site/server/src/lib/artifact/crypto.ts`; формат nonce —
`isValidNonce()` (64 hex) — `site/server/src/lib/drm/crypto.ts`.

## Тест-векторы и тесты

- **Модуль (C++, byte-match canonical JSON):**
  `tests/module/drm/main.cpp` (запуск `make -f module/src/drm/Makefile
  test`) — canonical JSON byte-match с сервером, Ed25519, AEAD roundtrip,
  key store, HTTP client, верификация lease. ALL TESTS PASSED (Linux x64,
  2026-09-09).
- **Сервер (TypeScript):** `tests/unit/site/drm-crypto.test.ts` — keygen
  (44 B SPKI), challenge/lease roundtrip, nonce-формат, TTL/skew-функции;
  `tests/integration/api/drm-v2.test.ts` — полный цикл протокола;
  `tests/integration/api/drm-g6.test.ts` — rotation, DEK proof, revoke.
  Локальные зеркала с относительными импортами — в
  `site/server/tests/` (`drm-crypto.test.ts`, `drm-v2.test.ts`,
  `drm-g6.test.ts`).
