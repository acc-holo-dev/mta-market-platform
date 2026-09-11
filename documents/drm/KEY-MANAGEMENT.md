status: mirror
version: 1.0
last_verified: 2026-09-11

# DRM — управление ключами

Жизненный цикл ключей DRM: какие ключи существуют, как генерируются, где
хранятся, как ротируются и что никогда не попадает в git. Замороженный
эталон —
[development/reference/old_drm-protocol-v2.md](../development/reference/old_drm-protocol-v2.md)
(раздел Keys); сопутствующие документы:
[CRYPTOGRAPHY.md](CRYPTOGRAPHY.md), [SECURITY.md](SECURITY.md).

## Какие ключи существуют

| Ключ | Переменная/хранилище | Владелец | Роль |
|---|---|---|---|
| Серверный ключ подписи lease | `DRM_SERVER_PRIVATE_KEY` (env) | Сервер | Ed25519-подпись lease; публичный ключ — в БД (`ServerSigningKey`, статус ACTIVE/PREVIOUS) |
| Мастер-ключ шифрования DEK | `DRM_MASTER_KEY` (env) | Сервер | AES-256-GCM-обёртка per-version DEK (`ArtifactEncryption`); клиентам никогда не выдаётся |
| Ключ подписи артефактов | `ARTIFACT_SIGNING_PRIVATE_KEY` (env) | Платформа | Ed25519-подпись артефактов от имени издателей (ArtifactSignature у версии) |
| Публичные ключи издателей/установок | БД (только публичные) | — | Верификация подписей клиентами |
| Ключ установки (installation keypair) | `~/.mta-market/installation.key` (клиент) | Машине покупателя | Ed25519 identity установки; proof-of-possession при verify/DEK |

Отдельно существуют ключи издателей (publisher keys): генератор
`generatePublisherKeypair()` в `site/server/src/lib/artifact/crypto.ts` —
единый Ed25519 DER-кодировкой; он же используется для ключей установок
(`generateInstallationKeypair()` в `site/server/src/lib/drm/crypto.ts`).

## Генерация

| Ключ | Команда |
|---|---|
| Серверный ключ подписи lease | `pnpm --filter @mta-market/server drm:keygen` (CLI `site/server/src/cli/drm.ts keygen` → `createServerSigningKey()`; ключ регистрируется в БД, приватная часть печатается в stdout/файл `.keys/`) |
| Ротация серверного ключа | `pnpm --filter @mta-market/server exec tsx src/cli/drm.ts rotate` — ACTIVE → PREVIOUS, новый приватный ключ пишется один раз в `.keys/drm-server-key-<keyId>.txt` (0600) |
| Мастер-ключ / прочие симметричные секреты | `openssl rand -base64 32` |
| Ключ подписи артефактов | Ed25519 keygen тем же способом (`generatePublisherKeypair()`); в dev удобно `pnpm --filter @mta-market/server drm:keygen` с последующей установкой в `ARTIFACT_SIGNING_PRIVATE_KEY` |
| Ключ установки | Генерируется **на клиенте** модулем; оператором не создаётся |

## Хранение

- **Сервер (site/server)** — только переменные окружения (`site/server/.env`
  в dev, `.env` контейнера в production): `DRM_SERVER_PRIVATE_KEY`,
  `DRM_MASTER_KEY`, `ARTIFACT_SIGNING_PRIVATE_KEY`. Ни один приватный ключ
  не хранится в БД; публичные ключи (`ServerSigningKey.publicKey`,
  `ArtifactSignature`, публичный ключ установки) — в БД.
- **Клиент (module)** — зашифрованный key store: каталог `$MTA_MARKET_HOME`
  (по умолчанию `~/.mta-market`), файл `installation.key` —
  AES-256-GCM(private_key) в формате `nonce(12)‖ciphertext‖tag`, права
  0600, каталог 0700; рядом `machine.salt` (16 случайных байт, 0600).
  Ключ шифрования файла = SHA-256(machine-id ‖ salt) на Linux / DPAPI
  (user-scoped) на Windows. Реализация: `module/src/drm/key_store.cpp`
  (угрозы и ограничения — в комментарии `key_store.hpp`: защита от
  копирования файла, **не** от локального root-атакующего; это
  документированный fallback, не KMS).

## Ротация

- **Серверный ключ подписи** (`rotateServerSigningKey()` в
  `site/server/src/lib/drm/service.ts`): текущий ACTIVE становится
  PREVIOUS (остаётся доверенным для уже выданных lease), создаётся новый
  ACTIVE; оператор устанавливает новый приватный ключ в
  `DRM_SERVER_PRIVATE_KEY` и перезапускает сервер. Ровно один PREVIOUS
  ключ сохраняет доверие — правило пересечения релизов сайта
  (G-007, правило 4 в
  [old_repository-contract.md](../development/reference/old_repository-contract.md)).
  Клиенты берут доверенный набор из `GET /drm/v2/public-keys`
  (ACTIVE + PREVIOUS); lease, проверяемый только отозванным ключом,
  отклоняется (`DRM_SERVER_KEY_REVOKED`).
- **Мастер-ключ**: ротация не предусмотрена протоколом — обёрнутые DEK
  привязаны к нему; замена = пере-обёртка всех DEK отдельной операцией
  (не реализовано; честная пометка). Компрометация = см.
  [INCIDENT-RESPONSE.md](../operations/INCIDENT-RESPONSE.md).
- **Ключ подписи артефактов**: смена → все новые ArtifactSignature
  выпускаются новым ключом; старые подписи верифицируются по сохранённому
  публичному ключу версии.
- **Ключ установки**: перегенерация = новая регистрация установки
  (старая установка отзывалась/удалялась владельцем через
  `DELETE /drm/installations/:id`).

## Backup

- `DRM_MASTER_KEY` живёт в `.env`; бэкап `.env` — только AES-256-шифрованный
  (`BACKUP_ENCRYPTION_KEY`), ключ бэкапов хранится вне сервера. **Потеря
  мастер-ключа без восстановления `.env` = все зашифрованные версии
  артефактов невосстановимы** — см.
  [BACKUP-RESTORE.md §5](../operations/BACKUP-RESTORE.md).
- `DRM_SERVER_PRIVATE_KEY` и `ARTIFACT_SIGNING_PRIVATE_KEY` — восстановимы
  перегенерацией (с потерей верифицируемости старых lease/подписей по
  текущему ACTIVE), поэтому для continuity их значения хранятся в том же
  зашифрованном `.env`-бэкапе.
- `.env` не коммитится никогда — только `.env.example` (см. ниже).

## Что НИКОГДА не коммитится

- `.env`, `.env.*` кроме `.env.example` — корневой `.gitignore`
  (секции «Environment & secrets» и `**/.env*`).
- Файлы ключей: `*.pem`, `*.key`, `*.crt`, `*.p12`, `*.pfx`, `*.der`,
  `*.jks`, `*.keystore` — `.gitignore`; каталоги `secrets/`,
  `backups/`, `artifacts/` тоже игнорируются.
- INV-правила из
  [old_repository-contract.md](../development/reference/old_repository-contract.md):
  **INV-010** — приватный ключ установки генерируется на клиенте и никогда
  не передаётся; сервер не владеет клиентскими приватными ключами и
  мастер-ключами модуля; `site/server/src/lib/drm/protocol.ts` —
  единственный источник констант, никаких «вторых копий для справки» в
  документации (правило «Must never own» репозитория документации).
