status: mirror
version: 1.0
last_verified: 2026-09-11

# DRM — модель безопасности

Документ описывает, от чего защищает DRM, как работает revocation и что
**не** защищается. Основание: [ADR-001](../adr/ADR-001-drm-lease-revocation.md),
замороженный эталон
[development/reference/old_drm-protocol-v2.md](../development/reference/old_drm-protocol-v2.md),
код `site/server/src/lib/drm/` и `module/src/drm/`.

## Модель угроз

| Угроза | Контрмера | Остаточный риск |
|---|---|---|
| **Пиратство артефактов** — массовое копирование купленных платных версий | Артефакт версии зашифрован per-version DEK (AES-256-GCM); DEK обёрнут `DRM_MASTER_KEY` и выдаётся только по `/drm/v2/versions/:id/dek` при действующем lease для этой версии; скачивание — по entitlement-проверке с короткоживущими подписанными URL | Владелец валидной установки может расшифровать полученный артефакт и выложить его наружу — DRM делает утечку адресуемой (см. ниже), но не невозможной |
| **Шеринг лицензии/lease** — одна лицензия на «все серверы» | Установка привязана к лицензии навсегда (INV-011); Ed25519-ключ установки генерируется на клиенте и хранится в зашифрованном key store (INV-010 — приватный ключ не покидает машину); активация требует proof-of-possession (challenge) | Копия `~/.mta-market` вместе с машиной (клон VM/образ) переносит identity — детектируется heartbeat-телеметрией, но автоматически не блокируется |
| **Replay** — повтор запросов активации/DEK | Nonce 32 байта hex-64, single-use на весь сервер (`Lease.nonce` unique → `DRM_NONCE_ALREADY_USED`, HTTP 409); challenge single-use | — |
| **Подделка lease** | Lease подписан серверным ключом Ed25519; клиент проверяет подпись и TTL по доверенному набору `GET /drm/v2/public-keys` | Компрометация `DRM_SERVER_PRIVATE_KEY` — см. INCIDENT-RESPONSE (процедура revoke + rotate) |
| **Перехват трафика** | Machine API только по TLS (HTTPS client модуля: TLS 1.2+, валидация сертификата, bounded retries, лимит ответа 1 MiB) | — |

## Revocation (ADR-001): data plane vs management plane

Полное решение — [documents/adr/ADR-001-drm-lease-revocation.md](../adr/ADR-001-drm-lease-revocation.md)
(верифицировано тестами G-008/G-009 в `tests/integration/api/drm-g6.test.ts`).

- **Data plane — expire-at-lease-end.** Lease, подписанный до отзыва,
  остаётся криптографически валидным до естественного `expiresAt` (+90 s
  skew). Обоснование: lease подписан против действовавшего на момент
  выдачи entitlement; отзыв не должен ломать работающие MTA-серверы
  посреди сессии. Окно остаточного доступа ≤ оставшегося TTL (≤ 7 дней).
- **Management plane — немедленное отключение.** После
  `INSTALLATION_REVOKED`: новая активация → 403 `DRM_INSTALLATION_REVOKED`;
  challenge-верификация и heartbeat → 403.
- **Ускоренное отключение** (компрометация, злоупотребление): отозвать
  установку **и** ротировать/отозвать серверный ключ подписи — lease,
  проверяемый только отозванным ключом, отклоняется
  (`DRM_SERVER_KEY_REVOKED`).
- YANKED-версия (I-005): блокирует **новую** выдачу lease; существующие
  lease'ы дорабатывают до естественного истечения.

## Ротация серверного ключа ACTIVE → PREVIOUS

`rotateServerSigningKey()` (`site/server/src/lib/drm/service.ts`, CLI
`site/server/src/cli/drm.ts rotate`): текущий ACTIVE ключ становится
PREVIOUS (остаётся доверенным для уже выданных lease), новый ключ становится
ACTIVE, приватный ключ устанавливается оператором в `DRM_SERVER_PRIVATE_KEY`
и сервер перезапускается. Ровно один PREVIOUS ключ сохраняет доверие — это
правило совместимости релизов сайта (G-007; правило 4 в
[old_repository-contract.md](../development/reference/old_repository-contract.md)).

## Single-use secret'ы

- **Challenge** (32 B, base64) — выдаётся один раз при регистрации
  установки, подписывается приватным ключом установки, проверка
  переводит установку в ACTIVE. Повторная регистрация = новый challenge.
- **Nonce** (32 B, hex-64) — для каждого activate/DEK-запроса; уникален
  на уровне БД, повтор отклоняется (409).

## Привязка установки (installation identity binding)

- Приватный ключ Ed25519 генерируется **на клиенте** (модуль) и хранится
  только в зашифрованном key store: `~/.mta-market/installation.key` —
  AES-256-GCM, 0600, машинно-производный ключ на Linux / DPAPI на Windows
  (`module/src/drm/key_store.cpp`, [KEY-MANAGEMENT.md](KEY-MANAGEMENT.md)).
  INV-010: приватный ключ установки никогда не передаётся серверу —
  сервер хранит только публичный ключ.
- Установка навсегда привязана к лицензии при регистрации (INV-011).
- Lease дополнительно привязывает `resourceId`, `resourceVersionId` и
  `artifactHash` — один lease валиден ровно для одной версии артефакта.

## Что НЕ защищается (честный список)

- **Модели и ассеты (DFF/TXD)** — движок MTA читает их открыто; шифрование
  невозможно. Для моделей защита = водяные знаки + Leak Radar (идея,
  [ideas/TRUST.md](../ideas/TRUST.md), не реализовано).
- **Декомпиляция Lua-кода владельцем** — держатель валидной лицензии
  получает расшифрованный артефакт. DRM повышает стоимость *массового*
  копирования и делает лицензии атрибутируемыми, но не защищает от
  квалифицированного инсайдера-покупателя.
- **Полная компрометация машины клиента** — key store защищает от
  «скопировали файл бэкапа», но не от локального атакующего с root, который
  может прочитать и machine-id, и salt, и дождаться загрузки ключа модулем
  (документированное ограничение в `module/src/drm/key_store.hpp`; это
  fallback, а не KMS).
- **Компрометация серверных секретов** (`DRM_MASTER_KEY`,
  `DRM_SERVER_PRIVATE_KEY`, `ARTIFACT_SIGNING_PRIVATE_KEY`) — утечка ключей
  сервера снимает защиту всех соответствующих версий; процедуры реакции —
  [INCIDENT-RESPONSE.md](../operations/INCIDENT-RESPONSE.md).
- **Скриншоты/видео геймплея, ручное распространение единичных копий.**

## Связь с шифрованием артефактов (DEK на версию)

- Каждая версия получает уникальный 32-байтный DEK; payload шифруется
  AES-256-GCM со свежим 12-байтным nonce (`{algorithm, nonce, tag,
  ciphertext}`); tampering ломает расшифровку.
- DEK хранится обёрнутым AES-256-GCM под `DRM_MASTER_KEY`
  (`{wrappedDek, wrapNonce, wrapTag}`); unwrap — только на сервере.
- Потеря `DRM_MASTER_KEY` без бэкапа `.env` = все зашифрованные версии
  невосстановимы ([BACKUP-RESTORE.md §5](../operations/BACKUP-RESTORE.md)).
