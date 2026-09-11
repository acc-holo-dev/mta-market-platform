# DRM — защита артефактов маркетплейса

Область DRM объединяет серверную и клиентскую стороны защиты платных
артефактов: лицензии, установки, подписанные lease'ы и выдачу ключей
шифрования версий.

Статус: соответствует коду на 2026-09-11 (Protocol v2, PLAN-001..010).

## Что защищает DRM

- **Платные версии ресурсов** — артефакт версии шифруется per-version DEK
  (AES-256-GCM); DEK обёрнут серверным мастер-ключом и выдаётся только
  держателю действующего lease'а.
- **Лицензии и entitlement** — покупка → лицензия → установка → подписанный
  lease (7 дней, renewable). Lease привязывает установку, лицензию, ресурс
  и точную версию (`artifactHash`).
- **Атрибуция и контроль** — каждое использование машины проверяемо
  (challenge/verify, heartbeat, единый nonce). Честная формулировка: DRM
  повышает стоимость массового копирования, это не абсолютная защита от
  декомпиляции (см. [SECURITY.md](SECURITY.md), «что НЕ защищается»).

## Правило замороженного протокола

DRM Protocol **v2 заморожен**: изменение любого эндпоинта, формата или
константы требует bump версии протокола (v3) — никогда редактирования на
месте. Правило и матрица совместимости описаны в
[development/reference/README.md](../development/reference/README.md).
При расхождении кода и документа код выигрывает — документ корректируется.

## Карта документов

| Документ | Содержание |
|---|---|
| [PROTOCOL-V2.md](PROTOCOL-V2.md) | Эндпоинты, flow, lease payload, константы, коды ошибок, deprecation v1. |
| [SECURITY.md](SECURITY.md) | Модель угроз, revocation (data plane vs management plane), single-use nonce/challenge, ограничения. |
| [CRYPTOGRAPHY.md](CRYPTOGRAPHY.md) | Ed25519, canonical JSON, AES-256-GCM, SHA-256, форматы ключей, тест-векторы. |
| [KEY-MANAGEMENT.md](KEY-MANAGEMENT.md) | Какие ключи существуют, генерация, хранение, ротация, backup, что нельзя коммитить. |

## Код

| Путь | Роль |
|---|---|
| `site/server/src/lib/drm/protocol.ts` | Замороженные константы и эндпоинты протокола (source of truth). |
| `site/server/src/lib/drm/crypto.ts`, `service.ts`, `types.ts` | Подписи/верификация lease и challenge, логика активации, wire-типы. |
| `site/server/src/routes/drm/v2.ts` | HTTP-реализация machine API `/drm/v2/*`. |
| `site/server/src/routes/drm.ts` | v1: license management + 410 Gone на активацию. |
| `site/server/src/lib/artifact/encryption.ts` | DEK-конверт: генерация/wrap/unwrap под `DRM_MASTER_KEY`. |
| `module/src/drm/` | Клиентская подсистема: canonical JSON, Ed25519, AEAD, HTTPS client, key store, license lifecycle. |
| `contracts/drm/` | Машиночитаемые схемы протокола (`contracts/drm/v2/`) — назначенное место; каталог создан, схемы ещё не добавлены (см. PROTOCOL-V2.md). |

Клиентская документация: [module/DRM-CLIENT.md](../module/DRM-CLIENT.md),
Lua-функции — [module/LUA-API.md](../module/LUA-API.md).
