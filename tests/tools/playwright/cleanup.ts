// PLAN-017 §32: canonical FK-safe cleanup for E2E-created entities on the
// dev database, executed through the direct-pg `psql()` helper (test workers
// must not spawn child processes).
//
// Delete ORDER (children with RESTRICT references first, then cascading
// parents; the same FK-safe order the journey spec's afterAll pioneered):
//   financialTransaction → purchase → order → servicePurchase →
//   discountCampaign → publisherKey → resource (with its version-bound
//   purchases/licenses) → server rows → user.
// OAuth/login-method tables (account, session) and profile tables cascade
// with the user row. e2e-admin is never touched.
import { psql } from "./helpers";

export interface CleanupSpec {
  /** Exact usernames to delete (with all their owned/fk-scoped rows). */
  usernames?: string[];
  /** Username prefixes, matched literally (underscore escaped). */
  usernamePrefixes?: string[];
  /** Exact resource slugs. */
  resources?: string[];
  /** Resource slug prefixes (e.g. "e2e-"). */
  resourceSlugPrefixes?: string[];
  /** Exact server slugs. */
  servers?: string[];
  /** Server slug prefixes. */
  serverSlugPrefixes?: string[];
  /** Article ids or slugs (created by seed users too — deleted explicitly). */
  articles?: string[];
  /** Forum thread ids created by the run (posts/reactions/follows go first). */
  threads?: string[];
  /** Server news ids. */
  news?: string[];
  /** Server update ids. */
  updates?: string[];
}

/** Quoted SQL literal list; single quotes are doubled. */
function sqlList(values: string[]): string {
  return values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");
}

/** Literal-prefix LIKE pattern (%/_/\ escaped, ESCAPE '\'). */
function likeEscaped(prefix: string): string {
  const escaped = prefix.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
  return `LIKE '${escaped}%' ESCAPE '\\'`;
}

/** One hygiene step: log and continue when a statement fails. */
async function safe(query: string, label: string): Promise<void> {
  try {
    await psql(query);
  } catch (e) {
    console.warn(`[cleanup] ${label} skipped:`, String(e).slice(0, 200));
  }
}

export async function cleanupEntities(spec: CleanupSpec): Promise<void> {
  const userConds: string[] = ["username <> 'e2e-admin'"];
  if (spec.usernames?.length) userConds.push(`username IN (${sqlList(spec.usernames)})`);
  if (spec.usernamePrefixes?.length) {
    for (const prefix of spec.usernamePrefixes) {
      userConds.push(`username ${likeEscaped(prefix)}`);
    }
  }
  const ids = await psql(
    `SELECT COALESCE(string_agg('''' || id || '''', ','), '') FROM "user" WHERE ${userConds.join(" OR ")}`
  ).catch(() => "");

  if (ids) {
    // Purchases first (License/Installation/Lease cascade; Payment rows have
    // no FK but are swept for hygiene; Refund RESTRICTs Payment).
    await safe(
      `DELETE FROM refund WHERE "paymentId" IN (SELECT id FROM payment WHERE "purchaseId" IN (SELECT id FROM purchase WHERE "buyerId" IN (${ids})))`,
      "refunds(purchases)"
    );
    await safe(
      `DELETE FROM payment WHERE "purchaseId" IN (SELECT id FROM purchase WHERE "buyerId" IN (${ids}))`,
      "payments(purchases)"
    );
    await safe(`DELETE FROM purchase WHERE "buyerId" IN (${ids})`, "purchases");
    await safe(`DELETE FROM "order" WHERE "buyerId" IN (${ids})`, "orders");
    await safe(`DELETE FROM "servicePurchase" WHERE "buyerId" IN (${ids})`, "servicePurchases");
    await safe(
      `DELETE FROM "discountUsage" WHERE "campaignId" IN (SELECT id FROM "discountCampaign" WHERE "sellerId" IN (${ids}))`,
      "discountUsages"
    );
    await safe(`DELETE FROM "discountCampaign" WHERE "sellerId" IN (${ids})`, "discountCampaigns");
    // Publisher keys are RESTRICT-referenced by artifact signatures.
    await safe(
      `DELETE FROM "artifactSignature" WHERE "keyId" IN (SELECT id FROM "publisherKey" WHERE "sellerId" IN (${ids}))`,
      "artifactSignatures(publisherKeys)"
    );
    await safe(`DELETE FROM "publisherKey" WHERE "sellerId" IN (${ids})`, "publisherKeys");
    // Financial transactions RESTRICT user deletion.
    await safe(`DELETE FROM "financialTransaction" WHERE "userId" IN (${ids})`, "financialTransactions");
    // Append-only audit rows and idempotency records of the run.
    await safe(`DELETE FROM "auditLog" WHERE "actorId" IN (${ids})`, "auditLogs");
    await safe(
      `DELETE FROM "idempotencyRecord" WHERE "userId" IN (${ids}) OR "expiresAt" < now()`,
      "idempotencyRecords"
    );
    // User-scoped editorial rows (author cascade would handle them, but the
    // explicit sweep keeps the queue clean even if the user delete fails).
    await safe(`DELETE FROM article WHERE "authorId" IN (${ids})`, "articles(user)");
    await safe(`DELETE FROM "serverNews" WHERE "authorId" IN (${ids})`, "serverNews(user)");
    await safe(`DELETE FROM "serverUpdate" WHERE "authorId" IN (${ids})`, "serverUpdate(user)");
    await safe(`DELETE FROM "forumPost" WHERE "authorId" IN (${ids})`, "forumPosts(user)");
    await safe(`DELETE FROM "forumThread" WHERE "authorId" IN (${ids})`, "forumThreads(user)");
  }

  if (spec.articles?.length) {
    await safe(`DELETE FROM article WHERE id IN (${sqlList(spec.articles)}) OR slug IN (${sqlList(spec.articles)})`, "articles");
  }
  if (spec.news?.length) {
    await safe(`DELETE FROM "serverNews" WHERE id IN (${sqlList(spec.news)})`, "serverNews");
  }
  if (spec.updates?.length) {
    await safe(`DELETE FROM "serverUpdate" WHERE id IN (${sqlList(spec.updates)})`, "serverUpdate");
  }
  if (spec.threads?.length) {
    const tids = sqlList(spec.threads);
    await safe(
      `DELETE FROM "forumReaction" WHERE "postId" IN (SELECT id FROM "forumPost" WHERE "threadId" IN (${tids}))`,
      "forumReactions(threads)"
    );
    await safe(`DELETE FROM "forumPost" WHERE "threadId" IN (${tids})`, "forumPosts(threads)");
    await safe(`DELETE FROM "forumThreadFollow" WHERE "threadId" IN (${tids})`, "forumThreadFollows");
    await safe(`DELETE FROM "forumThread" WHERE id IN (${tids})`, "forumThreads");
  }

  // Resources: explicit slug match OR owned by the cleaned users (the user
  // delete would cascade them anyway). Version RESTRICT references from
  // purchases/licenses of ANY buyer are removed first.
  const resourceConds: string[] = [];
  if (spec.resources?.length) resourceConds.push(`slug IN (${sqlList(spec.resources)})`);
  if (spec.resourceSlugPrefixes?.length) {
    for (const prefix of spec.resourceSlugPrefixes) {
      resourceConds.push(`slug ${likeEscaped(prefix)}`);
    }
  }
  if (ids) resourceConds.push(`"sellerId" IN (${ids})`);
  if (resourceConds.length) {
    const resIds = await psql(
      `SELECT COALESCE(string_agg('''' || id || '''', ','), '') FROM resource WHERE ${resourceConds.join(" OR ")}`
    ).catch(() => "");
    if (resIds) {
      const versionIds = `(SELECT id FROM "resourceVersion" WHERE "resourceId" IN (${resIds}))`;
      await safe(
        `DELETE FROM refund WHERE "paymentId" IN (SELECT id FROM payment WHERE "purchaseId" IN (SELECT id FROM purchase WHERE "versionId" IN ${versionIds}))`,
        "refunds(resourceVersions)"
      );
      await safe(
        `DELETE FROM payment WHERE "purchaseId" IN (SELECT id FROM purchase WHERE "versionId" IN ${versionIds})`,
        "payments(resourceVersions)"
      );
      await safe(`DELETE FROM license WHERE "versionId" IN ${versionIds}`, "licenses(resourceVersions)");
      await safe(`DELETE FROM purchase WHERE "versionId" IN ${versionIds}`, "purchases(resourceVersions)");
      await safe(`DELETE FROM resource WHERE id IN (${resIds})`, "resources");
    }
  }

  // Servers: every child (news/updates/reviews/tokens/samples/follows/
  // members/serverResource/forum threads) cascades with the server row.
  const serverConds: string[] = [];
  if (spec.servers?.length) serverConds.push(`slug IN (${sqlList(spec.servers)})`);
  if (spec.serverSlugPrefixes?.length) {
    for (const prefix of spec.serverSlugPrefixes) {
      serverConds.push(`slug ${likeEscaped(prefix)}`);
    }
  }
  if (serverConds.length) {
    await safe(`DELETE FROM "server" WHERE ${serverConds.join(" OR ")}`, "servers");
  }

  // Users last: sessions/accounts/profiles/balances/follows/reviews cascade.
  if (ids) {
    await safe(`DELETE FROM "user" WHERE id IN (${ids})`, "users");
  }
}