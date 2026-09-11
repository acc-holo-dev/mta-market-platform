-- Cleanup E2E test artifacts so demo screenshots look realistic.
-- Keeps the e2e-admin account (useful for admin panel screenshots).
\set ON_ERROR_STOP on
BEGIN;

CREATE TEMP TABLE _er AS SELECT id FROM resource WHERE slug LIKE 'e2e-%';
CREATE TEMP TABLE _erv AS SELECT id FROM "resourceVersion" WHERE "resourceId" IN (SELECT id FROM _er);
CREATE TEMP TABLE _ep AS SELECT id FROM purchase WHERE "versionId" IN (SELECT id FROM _erv);
CREATE TEMP TABLE _el AS SELECT id FROM license WHERE "versionId" IN (SELECT id FROM _erv) OR "purchaseId" IN (SELECT id FROM _ep);

-- 1) rows hanging off e2e resource versions
DELETE FROM "artifactEncryption"   WHERE "versionId" IN (SELECT id FROM _erv);
DELETE FROM "artifactSignature"    WHERE "versionId" IN (SELECT id FROM _erv);
DELETE FROM "compatibilityReport"  WHERE "versionId" IN (SELECT id FROM _erv);
DELETE FROM "sandboxRun"           WHERE "versionId" IN (SELECT id FROM _erv);
DELETE FROM license                WHERE "versionId" IN (SELECT id FROM _erv) OR "purchaseId" IN (SELECT id FROM _ep);
DELETE FROM "installation"         WHERE "licenseId" IN (SELECT id FROM _el);
DELETE FROM dispute                WHERE "purchaseId" IN (SELECT id FROM _ep);
DELETE FROM purchase               WHERE id IN (SELECT id FROM _ep);

-- 2) rows hanging off e2e resources
DELETE FROM "moderationEvent"      WHERE "resourceId" IN (SELECT id FROM _er);
DELETE FROM "resourceDependency"   WHERE "resourceId" IN (SELECT id FROM _er) OR "dependsOnSlug" IN (SELECT slug FROM resource WHERE id IN (SELECT id FROM _er));
DELETE FROM "resourceVersion"      WHERE "resourceId" IN (SELECT id FROM _er);
DELETE FROM review                 WHERE "resourceId" IN (SELECT id FROM _er);
DELETE FROM "resourceMedia"        WHERE "resourceId" IN (SELECT id FROM _er);
DELETE FROM "serverResource"       WHERE "resourceId" IN (SELECT id FROM _er);
DELETE FROM "articleResourceLink"  WHERE "resourceId" IN (SELECT id FROM _er);
DELETE FROM "resourceFollow"       WHERE "resourceId" IN (SELECT id FROM _er);
DELETE FROM "resourceViewDaily"    WHERE "resourceId" IN (SELECT id FROM _er);
DELETE FROM resource               WHERE id IN (SELECT id FROM _er);

-- 3) e2e users (except e2e-admin) and their rows
CREATE TEMP TABLE _eu AS SELECT id FROM "user" WHERE (username LIKE 'e2e%' OR email LIKE '%e2e.local%') AND username <> 'e2e-admin';

DELETE FROM account            WHERE "userId" IN (SELECT id FROM _eu);
DELETE FROM "financialTransaction" WHERE "userId" IN (SELECT id FROM _eu);
DELETE FROM "sellerBalance"    WHERE "userId" IN (SELECT id FROM _eu);
DELETE FROM "sellerProfile"    WHERE "userId" IN (SELECT id FROM _eu);
DELETE FROM "userBalance"      WHERE "userId" IN (SELECT id FROM _eu);
DELETE FROM "session"          WHERE "userId" IN (SELECT id FROM _eu);
DELETE FROM "forumPost"        WHERE "authorId" IN (SELECT id FROM _eu);
DELETE FROM "forumReaction"    WHERE "userId" IN (SELECT id FROM _eu);
DELETE FROM "forumThreadFollow" WHERE "userId" IN (SELECT id FROM _eu);
DELETE FROM "forumThread"      WHERE "authorId" IN (SELECT id FROM _eu);
DELETE FROM notification       WHERE "recipientId" IN (SELECT id FROM _eu);
DELETE FROM report             WHERE "reporterId" IN (SELECT id FROM _eu);
DELETE FROM "serverFollow"     WHERE "userId" IN (SELECT id FROM _eu);
DELETE FROM "serverMember"     WHERE "userId" IN (SELECT id FROM _eu);
DELETE FROM "serverReview"     WHERE "userId" IN (SELECT id FROM _eu);
DELETE FROM "serverReviewEligibility" WHERE "userId" IN (SELECT id FROM _eu);
DELETE FROM "resourceFollow"   WHERE "userId" IN (SELECT id FROM _eu);
DELETE FROM "sellerFollow"     WHERE "followerId" IN (SELECT id FROM _eu) OR "sellerUserId" IN (SELECT id FROM _eu);
DELETE FROM "discountCampaign" WHERE "sellerId" IN (SELECT id FROM _eu);
DELETE FROM "publisherKey"     WHERE "sellerId" IN (SELECT id FROM _eu);
DELETE FROM "servicePurchase"  WHERE "buyerId" IN (SELECT id FROM _eu);
DELETE FROM "orderItem"        WHERE "orderId" IN (SELECT id FROM "order" WHERE "buyerId" IN (SELECT id FROM _eu));
DELETE FROM "order"            WHERE "buyerId" IN (SELECT id FROM _eu);
DELETE FROM purchase           WHERE "buyerId" IN (SELECT id FROM _eu);
DELETE FROM "user"             WHERE id IN (SELECT id FROM _eu);

COMMIT;
