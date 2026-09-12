// Shared stubbed-fetch OAuth harness for the identity suites
// (auth/identity-link.test.ts + auth/identity-providers.test.ts — both
// previously duplicated these helpers inline; see their header notes).
// The provider HTTP surfaces are exercised through a global fetch stub whose
// routes are declared per suite; this module factors the common pieces.
import { vi } from "vitest";
import request from "supertest";
import { db } from "@server/prisma/db";

/** One emulated provider endpoint: route predicate + responder. */
export interface OAuthFetchRoute {
  match: (url: string) => boolean;
  respond: (url: string, init?: { body?: unknown }) => unknown;
}

/** A successful JSON fetch response (the shape the providers read). */
export function fetchJsonOk(body: unknown): {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
  json: () => Promise<unknown>;
} {
  return {
    ok: true,
    status: 200,
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
}

/**
 * Build the global fetch stub: routes are matched in declaration order,
 * unmatched URLs get the honest 404 fallback the real providers never see.
 */
export function createOAuthFetchStub(routes: OAuthFetchRoute[]): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: unknown, init?: { body?: unknown }) => {
    const u = String(url);
    for (const route of routes) {
      if (route.match(u)) return await route.respond(u, init);
    }
    return { ok: false, status: 404, text: async () => "not found", json: async () => ({}) };
  });
}

/** The raw `set-cookie` entry for `name` (undefined when absent). */
export function fullCookie(res: request.Response, name: string): string | undefined {
  const setCookie = res.headers["set-cookie"] as unknown as string[] | undefined;
  if (!setCookie) return undefined;
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  return list.find((c) => c.startsWith(`${name}=`));
}

/** Name=value pair only (for chaining into a Cookie header). */
export function cookieHeader(res: request.Response, name: string): string | undefined {
  const raw = fullCookie(res, name);
  return raw ? raw.split(";")[0] : undefined;
}

/**
 * OAuth login creates users with random uuids (outside the fixed test range);
 * remove them by email in FK-safe order, then the caller resets the rest.
 */
export async function deleteOauthUsersByEmail(emails: Iterable<string>): Promise<void> {
  for (const email of emails) {
    const user = await db.orm.public.User.where({ email }).first().catch(() => null);
    if (user) {
      const sessions = await db.orm.public.Session.where({ userId: user.id }).all();
      for (const s of sessions) {
        await db.orm.public.Session.where({ id: s.id }).delete().catch(() => undefined);
      }
      const accounts = await db.orm.public.Account.where({ userId: user.id }).all();
      for (const a of accounts) {
        await db.orm.public.Account.where({ id: a.id }).delete().catch(() => undefined);
      }
      await db.orm.public.User.where({ id: user.id }).delete().catch(() => undefined);
    }
  }
}

/** Probe the test database; suites skip their DB-dependent tests when absent. */
export async function probeDatabaseAvailable(label: string): Promise<boolean> {
  try {
    await db.orm.public.User.where({ id: "00000000-0000-0000-0000-000000000000" }).first();
    return true;
  } catch {
    console.warn(`${label} DATABASE UNAVAILABLE — integration tests skipped.`);
    return false;
  }
}