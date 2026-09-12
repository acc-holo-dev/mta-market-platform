# PLAN-020 — Audit 07: Storage / Frontend Architecture / Next.js Performance

Scope: PLAN-020.md sections K (K-001..K-003), L (L-001..L-005), M (M-001..M-004), static-only pass.
Repo: `site/server/src/lib/{storage,s3,media}.ts`, `site/server/src/routes/{resources,media,upload,versions,leak}.ts`, `site/web/src` (app/, lib/, store/, components/, features/).

---

## K-001 — Storage boundary (abstraction respected)
- severity: low
- verdict: KEEP
- current: `lib/storage.ts` (27 lines) is the single artifact-bytes loader; all artifact readers call `loadArtifactBuffer` (`lib/demo.ts:150`, `routes/leak.ts:188`, `routes/versions.ts:122,300`). No `express.static`, no `sendFile` of `UPLOAD_DIR` outside the media route. Two sanctioned direct s3.ts uses outside storage.ts: `routes/media.ts:52` (`s3GetObject` for public media streaming) and `lib/media.ts:184` (`deleteFromS3` cleanup) — read/delete of *media* objects, not artifacts.
- change: none required; optionally document that `storage.ts` covers artifact reads while writes/deletes live in `s3.ts` (asymmetric but deliberate).
- reason: the abstraction is load-only by design (TASK A-009); bypasses found are media-scoped, not artifact-scoped.
- risk: a future route could import `s3GetObject` directly for artifact bytes — enforce via lint rule / comment.
- verification: `grep -rn "s3GetObject\|loadArtifactBuffer" site/server/src` shows only the callers listed above.

## K-002 — Signed URL policy (TTL, permissions, ownership)
- severity: low
- verdict: KEEP
- current: `lib/s3.ts:22` default TTL 300s, `:136` hard cap `Math.min(ttl, 900)` (15 min); URL built from `GetObjectCommand` (read-only, `s3.ts:128-143`). Issuance is gated in `routes/versions.ts`: authenticate → purchase exists → license `ACTIVE` (versions.ts:420-435, revoked/refunded denied) → exact version entitlement match (`:464-482`) → only then `getS3DownloadUrl` (`:478`).
- change: none. Path scope is implicit (object key from DB row, key generated as `resources/<32hex>.<ext>`, `s3.ts:75`).
- reason: TTL is short, capped, read-only, and ownership+entitlement are checked server-side before signing.
- risk: `expiresIn` argument is attacker-unreachable (not client-supplied); bucket ACL policy itself is a deploy-time concern (see DEFER).
- verification: request download without purchase → 403; revoked license → 403 ("License is no longer active").

## K-003 — Private artifact isolation (paid artifacts unreachable without auth)
- severity: low
- verdict: KEEP
- current: (1) no public URL: S3 mode stores the object **key**, never a URL (`routes/upload.ts:143-146` "store the OBJECT KEY, never a public URL"). (2) no static route: `grep express.static` over `site/server/src` → 0 hits; local artifacts stream only through the entitlement-checked endpoint (`versions.ts:496` `res.download` after all checks). (3) `/media/:name` accepts only `media-<64hex>.<ext>` (`lib/media.ts:111-134` regex + traversal guard); paid artifacts use plain random names and a different prefix, so the media route cannot serve them (routes/media.ts:21-27). (4) keys are `crypto.randomBytes(16/32)` hex — not predictable. Demo flow (`lib/demo.ts`) additionally gates on PUBLISHED status, active-session cap and TTL 1800s.
- change: none.
- reason: all four bypass vectors (public / predictable URL / cache / alternate endpoint) are closed; media route answers with 404 for non-`media-` names.
- risk: artifacts and media share one bucket (artifacts at `resources/*`, media at `media/*`) — the bucket must stay private even though media is public-by-prefix; `MEDIA_PUBLIC_BASE_URL` redirect (routes/media.ts:40-44) must point only at a host mirroring the `media/` prefix.
- verification: `GET /media/resources/<artifact-key>` → 404 (regex mismatch); `GET /uploads/<file>` without a route → 404.

## L-001 — Feature ownership (two homes for domain UI)
- severity: medium
- verdict: SIMPLIFY
- current: `site/web/src/components/` holds domain folders (`account/ admin/ auth/ community/ dashboard/ disputes/ feedback/ home/ market/ search/ seller/ servers/ trust/` + `ui/ layout/`) — 50 tsx files, 37 with `"use client"` — while `features/` holds the same kind of domain code (`features/admin/` with 17 subdirs, `23/23` files client). Loose `components/MessageThread.tsx` is imported by 3 app pages (disputes, services/orders, deals).
- change: merge `components/<domain>/` into `features/<domain>/` (keep `components/ui`, `components/layout`); fold `components/admin` (4 files: AdminReasonDialog, EntityPicker, chips, labels) into `features/admin/shared/`; move `MessageThread.tsx` to `features/`.
- reason: one canonical location per domain; today a new admin widget has two plausible homes.
- risk: pure move + import-path update; low behavioral risk.
- verification: `grep -rn "@/components/<domain>"` → 0 after migration; build passes.

## L-002 — Server/client boundary (every page is a client component)
- severity: high
- verdict: FIX
- current: **37/37** `site/web/src/app/**/page.tsx` have `"use client"` as line 1 — zero RSC pages. Largest: `servers/[slug]/manage/page.tsx` (1955 lines), `seller/page.tsx` (1592), `servers/[slug]/page.tsx` (1349), `resources/[slug]/page.tsx` (1014), `servers/create/page.tsx` (822). Plus 37/37 client in components (of 50) and 23/23 in features.
- change: split the top-5 pages into server shells (static heading, layout, metadata, server-fetched SEO content) + client islands (the interactive forms/tables already in features/). Start with `servers/[slug]/page.tsx` and `resources/[slug]/page.tsx` (public, SEO-relevant, mostly read-only rendering).
- reason: whole-page client rendering ships the full component tree + API-client code as JS and blocks RSC/streaming benefits; M-002 is the same finding from the route-rendering angle.
- risk: medium — hooks and query invalidations are pervasive (166 inline `useQuery` call sites); do it page-by-page, not a sweep.
- verification: `grep -rL '"use client"' src/app --include=page.tsx` grows from 0; first-load JS for `/servers/[slug]` drops.

## L-003 — React Query / Zustand boundary (clean)
- severity: low
- verdict: KEEP
- current: `store/` contains exactly one store, `auth.ts` (49 lines): `user` + in-memory `accessToken`, explicitly not persisted (no localStorage), no fetch/axios calls, no server-data caches. All server data flows through React Query (`useQuery` in pages; `lib/queries.ts`).
- change: none.
- reason: Zustand holds session/UI state only (access token must live in JS memory by the browser-token policy, A-001/D-006) — no duplicated data store exists.
- risk: none observed; keep the invariant "no fetch in store/" on review checklists.
- verification: `grep -n "fetch(\|axios" store/*.ts` → 0.

## L-004 — API request duplication (shim + domain modules, migration unfinished)
- severity: low
- verdict: MERGE
- current: `lib/api-ext.ts` is a 46-line pure re-export shim (PLAN-019 E-003) over 10 canonical domain modules in `lib/api/` (3954 lines total: resources 812, finance 541, advertising 430, admin 407, servers 422…). Endpoint implementations are deduplicated — only one duplicated export name across modules (`isFeatureDisabledError`, a re-export twin). But **75 files still import `api-ext`** (35 under `app/`, 20 import `@/lib/api` directly, 3 import `lib/api/...` domain paths).
- change: finish the planned importer migration to `@/lib/api/<domain>` (35 app/ files first), then delete `lib/api-ext.ts`.
- reason: the shim is zero-risk debt by its own comment ("importer migration happens opportunistically"); one import path = one canonical client.
- risk: mechanical path rewrite; compile-time verifiable.
- verification: `grep -rln "api-ext" site/web/src` → 0; tsc build green.

## L-005 — Query-key consistency (factory exists, mostly bypassed)
- severity: medium
- verdict: FIX
- current: `lib/queries.ts` (91 lines, 10 exports) exists but only **16 files** import it, while there are **166 inline `queryKey: [...]` string literals** in `app/ components/ features/`. Invalidation sites re-type keys by hand, e.g. `servers/[slug]/manage/page.tsx:424-425,742-745` (`"server-manage"`, `"server"`, `"server-resources"`, `"server-staff"`) — a typo there silently misses invalidation.
- change: extend `lib/queries.ts` with keys for the hot domains (servers/manage, profile, disputes) and replace inline literals in `app/` (grep above is the worklist); ban raw `queryKey: [` in ESLint where feasible.
- reason: string-literal keys break invalidation/type safety; the factory already exists so this is adoption, not new design.
- risk: low — keys are internal; a mechanical sed-per-pattern with compile check.
- verification: `grep -rn "queryKey: \[" src/app | grep -v "queries\."` → near 0; stale-data bugs regression-tested on manage page.

## M-001 — Bundle audit (dependencies already minimal)
- severity: low
- verdict: KEEP
- current: `site/web/package.json` runtime deps: exactly 9 (`@tanstack/react-query`, `clsx`, `lucide-react`, `next`, `react`, `react-dom`, `tailwind-merge`, `zustand`, workspace `shared`). **No** recharts/moment/lodash/editor/chart/three/antd — nothing heavy to remove. `lucide-react` used in 80 files (tree-shaken ESM). devDeps are toolchain only.
- change: none (no duplicate/unused packages found at static level; runtime bundle-size measurement deferred).
- reason: the dependency surface is already lean; risk lies in client-component volume, not libraries (see L-002).
- risk: none.
- verification: `next build` output per-route "First Load JS" once L-002 lands.

## M-002 — Route rendering audit (static evidence only)
- severity: medium
- verdict: FIX
- current: static facts: 37/37 pages client-rendered (see L-002), so no route uses RSC; prefetch/revalidate strategy is therefore moot client-side and `export const revalidate` was found on no page. Data arrives via client `useQuery` against the Express API.
- change: same remediation as L-002; for public detail pages (`servers/[slug]`, `resources/[slug]`, `deals/[id]`, `profile/[username]`) prefer server-rendered shells with `revalidate` for SEO/LCP.
- reason: route-rendering choices should be justified per route; today the default is uniformly "client", which is unjustified for public read pages.
- risk: runtime behavior (prefetch, revalidate) needs verification after refactor.
- verification: after split, check dev-tools: HTML contains primary content on first byte for the four public pages.

## M-003 — Image/media audit (no next/image anywhere)
- severity: medium
- verdict: FIX
- current: **28 `<img>` usages in 17 files**; **0 imports of `next/image`** in `src/`. Server serves original uploads (≤5MB cap, `MEDIA_MAX_BYTES`) with no resize/format negotiation; `routes/media.ts` sets `Cache-Control: immutable` (good) but delivers full-size originals.
- change: migrate covers/screenshots to `next/image` (default lazy loading + responsive `sizes`; the immutable media route supports the loader), or minimally add `loading="lazy"` + `decoding="async"` to remaining `<img>`.
- reason: covers/screenshots are above-the-fold media on listing pages; unoptimized originals cost LCP and bandwidth.
- risk: low-medium — Next image optimization needs the media host in `images.remotePatterns` if `MEDIA_PUBLIC_BASE_URL` (external CDN) is used in S3 mode.
- verification: no raw `<img>` for resource covers after migration; `next/image` audit in build output.

## M-004 — Home performance (measurement required)
- severity: low
- verdict: DEFER
- current: static only: `app/page.tsx` is 378 lines, `"use client"`; no runtime TTFB/LCP/JS/request-count data collected in this pass.
- change: n/a here — measure `next build` route sizes + Lighthouse on `/` before/after L-002/M-003.
- reason: no measurements taken; do not fabricate numbers.
- risk: —
- verification: before/after table in a follow-up audit.

---

## DEFER — не проверено
- **M-004**: runtime TTFB/LCP/JS/request-count на `/` — требуется запуск сборки/Lighthouse.
- **M-002 runtime-часть**: фактические prefetch/revalidate/streaming после рефакторинга L-002 (проверено только статически).
- **S3 bucket policy / MEDIA_PUBLIC_BASE_URL host**: ACL приватного бакета и CDN-хост не проверены (deploy-time конфигурация, не код).
- **routes/demo.ts end-to-end**: `lib/demo.ts` имеет TTL/capacity/PUBLISHED-гейты, но полный auth-путь демо-скачивания не прослежен до HTTP-слоя.
- **Полный перечень 166 inline query keys** — проверена выборка (manage/servers/profile/disputes), полный список не нормализован.
- **Bundle-size через `next build`** (per-route First Load JS) — не собирался, чтобы не менять артефакты репозитория.
- **`lucide-react@^1.45.0`** — версия выглядит нетипичной (публичные версии линейки 0.x); не проверял registry.

## Итоги
| verdict | count |
|---|---|
| KEEP | 5 (K-001, K-002, K-003, L-003, M-001) |
| FIX | 4 (L-002, L-005, M-002, M-003) |
| MERGE | 1 (L-004) |
| SIMPLIFY | 1 (L-001) |
| REMOVE / REPLACE | 0 |
| DEFER | 1 (M-004) |

Storage (K) — самая чистая часть: границы абстракции и изоляция платных артефактов выдержаны. Основной долг — frontend: 100% client-страниц (37/37) и обход key-factory (166 строковых ключей).
