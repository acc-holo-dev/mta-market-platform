# Wave-5 module map (PLAN-019 B) — mechanical move plan

Prepared while Wave-6 domain agents run; execution starts only after they
land (they own several lib/ + routes/ files). The move is mechanical:
files keep their contents, imports update `../../lib/x.js` → module-local
or cross-module service imports. No behavior changes.

## Principles (PLAN-019 B-001..B-004)

- Modules own: routes/, service/, repository/ conventions, schemas, events.
- Dependency direction: HTTP → service → domain → data access.
- Cross-module access only via explicit service functions or events —
  never direct ORM access from a foreign module.
- Repository conventions: findById/findMany/count/create/update/delete/
  aggregate per module (introduced as code moves, not speculatively).

## Route files → modules (src/modules/<domain>/)

| Domain | Routes (files move as-is) |
|---|---|
| auth | auth.ts, (lib: identityProvider, tokenCrypto, tokenSecurity, cookies, jwt, auth middleware) |
| users | profiles.ts, dashboard.ts (personal aggregates) |
| marketplace | resources.ts, versions.ts, reviews.ts, upload.ts, media.ts, search.ts (market part) |
| services | services.ts |
| payments | payments.ts, purchases.ts, disputes.ts |
| ledger | (lib: ledger.ts, refunds.ts, reconciliation/*) |
| licenses | drm.ts, drm/v2.ts, (lib: drm/*, artifact/*) |
| servers | servers.ts, serverNews.ts, serverReviews.ts, integration.ts |
| community | community.ts, follows.ts, reports.ts, notifications.ts |
| content | news.ts, content.ts, activity.ts |
| moderation | admin.ts, adminCommunity.ts, adminContent.ts, adminPlatform.ts, adminContent parts |
| advertising | advertising.ts, adminAdvertising.ts, (lib: advertising.ts, adsBilling.ts) |
| subscriptions | subscriptions.ts, adminPremium.ts, (lib: entitlements.ts, subscriptions.ts) |
| deals | deals.ts, (lib: deals.ts) |
| commerce-finance | adminFinance.ts, sellerPayouts.ts, discounts.ts, (lib: payouts.ts) |
| trust | trust.ts, (lib: trust.ts) |
| personal | favorites.ts, alerts.ts, updates.ts, (lib: priceAlerts.ts) |
| demo | demo.ts, (lib: demo.ts) |
| feedback | feedback.ts |
| leak | leak.ts, (lib: artifact/fingerprint.ts) |
| platform | config.ts, (lib: config loader, permissions, systemLog, featureFlags, errors, metrics, logger, rateLimit, redis, events) |
| workers | worker/**, jobs/* |

## lib files without a module owner yet

- slug.ts, dbErrors.ts, keyLock.ts, s3.ts, storage.ts, upload.ts,
  email.ts, paymentProvider.ts, paymentErrors.ts, moderation.ts,
  serverAccess.ts, serverIntegration.ts, serverMonitoring.ts, sandbox/**
  → owners assigned during the move (servers/services/licenses/platform).

## Execution order (after Wave-6 lands)

1. Create src/modules/<domain>/ scaffolding + move routes (mechanical,
   app.ts mounts switch to module barrels).
2. Move owning lib files into module service/ dirs; keep platform libs in
   src/lib/ (cross-cutting).
3. Introduce repository interfaces per domain; migrate hottest domains
   first (marketplace, payments, community).
4. eslint import-boundaries rule: HTTP may import services; services may
   not import HTTP; foreign-module ORM access forbidden (error level).
5. Full type-check + vitest after each of steps 1–4 (aliases unchanged:
   @server → site/server/src keeps tests stable).
